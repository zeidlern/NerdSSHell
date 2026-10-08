param([string]$ManifestPath,[string]$ManifestSha256)
$script:UpdateCleanupOwner=$null
$script:UpdateCleanupFiles=@()
$script:UpdateControlDirectory=$null
$script:UpdateControlOwners=New-Object 'System.Collections.Generic.List[object]'
$script:UpdateControlLeases=@{}
$script:UpdateControlStage=$null
$script:UpdateFileTransport=$false
$script:UpdateBrokerLease=$null
$script:UpdateParentLease=$null
$script:UpdateRetainStop=$false
# Fixed, locally bundled code only. Downloaded releases provide an EXE, never a script.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('NerdSSHell.UpdatePath' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Threading;
using System.Threading.Tasks;
namespace NerdSSHell {
 public static class UpdateControl {
  // Console.In.ReadLineAsync can block synchronously on .NET Framework.
  public static Task<string> ReadCommand() { return Task.Factory.StartNew(()=>Console.In.ReadLine(),CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default); }
 }
 public sealed class UpdatePath : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct Info { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME C,A,W; public uint Volume,High,Low,Links,IndexHigh,IndexLow; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder b,uint n,uint f);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle h,int c,ref byte i,uint n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  public readonly string Path; public readonly string Identity; public readonly FileStream Stream; readonly SafeFileHandle handle;
  public UpdatePath(string path,bool directory) : this(path,directory,false) {}
  public UpdatePath(string path,bool directory,bool deleteAccess) {
   if(String.IsNullOrEmpty(path)||path.Length>1024||!System.IO.Path.IsPathRooted(path)||path.IndexOfAny(new char[]{'\r','\n','\0'})>=0)throw new IOException("Invalid path");
   string full=System.IO.Path.GetFullPath(path);
   if(full.Length<3||full[1]!=':'||full[2]!='\\')throw new IOException("Local drive required");
   for(string p=full;;p=System.IO.Path.GetDirectoryName(p)) { if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new IOException("Reparse path"); if(p==System.IO.Path.GetPathRoot(p))break; }
   handle=CreateFile(full,(directory?0u:0x80000000u)|(deleteAccess?0x00010000u:0u),1,IntPtr.Zero,3,0x02200000u,IntPtr.Zero);
   if(handle.IsInvalid)throw new IOException("Cannot hold path");
   try { Info i; if(!GetFileInformationByHandle(handle,out i)||(i.Attributes&0x400)!=0||(((i.Attributes&0x10)!=0)!=directory)||(!directory&&i.Links!=1))throw new IOException("Invalid ordinary path");
    var b=new StringBuilder(2048); uint n=GetFinalPathNameByHandle(handle,b,(uint)b.Capacity,0); if(n==0||n>=b.Capacity)throw new IOException("Cannot identify path");
    string actual=b.ToString(); if(!actual.StartsWith(@"\\?\",StringComparison.Ordinal))throw new IOException("Invalid final path"); actual=actual.Substring(4);
    if(actual.Length<3||actual[1]!=':')throw new IOException("Local path required");
    Path=String.Equals(actual,System.IO.Path.GetPathRoot(actual),StringComparison.OrdinalIgnoreCase)?actual:actual.TrimEnd('\\'); Identity=i.Volume.ToString()+":"+i.IndexHigh.ToString()+":"+i.IndexLow.ToString();
    if(!directory)Stream=new FileStream(handle,FileAccess.Read);
   } catch {handle.Dispose();throw;}
  }
  public static string FileIdentity(SafeFileHandle h){Info i;if(!GetFileInformationByHandle(h,out i))throw new IOException("Cannot identify file");return i.Volume.ToString()+":"+i.IndexHigh.ToString()+":"+i.IndexLow.ToString();}
  public void MarkDelete(){byte remove=1;if(!SetFileInformationByHandle(handle,4,ref remove,1))throw new IOException("Cannot delete owned path");}
  public void Dispose(){if(Stream!=null)Stream.Dispose();else handle.Dispose();}
 }
}
"@
}
function Same-UpdatePath([string]$A,[string]$B) { return [string]::Equals($A.TrimEnd('\'),$B.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase) }
function Within-UpdatePath([string]$Parent,[string]$Child) { return (Same-UpdatePath $Parent $Child) -or $Child.StartsWith($Parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) }
function Get-UpdateHash($Stream) { $Stream.Position=0; $hash=[Security.Cryptography.SHA256]::Create(); try { return [BitConverter]::ToString($hash.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() } finally {$hash.Dispose();$Stream.Position=0} }
function Get-UpdateRegistrations {
  $entries=@()
  foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry64)
    try {
      $key=$root.OpenSubKey('Software\48ee049e-c2f6-57b2-ab6e-7f5df516dcc0',$false)
      if($null -ne $key) {
        try {
          $value=$key.GetValue('InstallLocation',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          if($value -is [string] -and $value.Length) {
            $entries+=@{directory=$value;scope=$(if($hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser){'currentuser'}else{'allusers'})}
          }
        }finally{$key.Dispose()}
      }
    }finally{$root.Dispose()}
  }
  return $entries
}
function Get-UpdateScope([string]$Directory) {
  $matches=@();$entries=@(Get-UpdateRegistrations)
  # NSIS upgrades consult both hives; a second registration may uninstall a
  # different copy even when /D names the current one. Refuse coexistence.
  if($entries.Count -ne 1){throw 'Conflicting registration'}
  foreach($entry in $entries) {
    if($entry.scope -notin @('currentuser','allusers')) {throw 'Invalid registration'}
    $held=$null
    try {$held=New-Object NerdSSHell.UpdatePath($entry.directory,$true); if(Same-UpdatePath $held.Path $Directory){$matches+=$entry.scope}}finally{if($null -ne $held){$held.Dispose()}}
  }
  if($matches.Count -ne 1){throw 'Registration mismatch'}
  return $matches[0]
}
function Get-UpdateVersion([string]$Executable) {
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($Executable)
  if($version.ProductName -cne 'NerdSSHell' -or $version.ProductVersion -notmatch '^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(\.0)?$'){throw 'Invalid application version'}
  $parts=$version.ProductVersion.Split('.'); if(@($parts | Where-Object {[int]$_ -gt 65535}).Count){throw 'Invalid application version'}
  return ($parts[0..2] -join '.')
}
function Assert-NoUpdateInstances {
  foreach($name in @('NerdSSHell','BetterSSH')) {
    $processes=@([Diagnostics.Process]::GetProcessesByName($name))
    try {if($processes.Count){throw 'Application still running'}} finally {foreach($item in $processes){$item.Dispose()}}
  }
}
function Get-UpdateRecoveryFiles([string]$Directory) {
  # Only known installed program files, never profiles, archives or credentials.
  return @('NerdSSHell.exe','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat',
    'resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll','locales\en-US.pak','resources\app.asar','resources\app.asar.unpacked\node_modules\ssh2\util\pagent.exe',
    'resources\app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\conpty.node',
    'resources\app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\conpty\conpty.dll',
    'resources\app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\conpty\OpenConsole.exe') | ForEach-Object {[IO.Path]::Combine($Directory,$_)}
}
function Get-UpdateRecoveryIdentity([string]$Directory) {
  $records=@(); foreach($file in @(Get-UpdateRecoveryFiles $Directory)) {$held=New-Object NerdSSHell.UpdatePath($file,$false);try{$records+=@{path=$held.Path;hash=(Get-UpdateHash $held.Stream)}}finally{$held.Dispose()}}
  return $records
}
function Test-UpdateRecoveryIdentity($Records) {
  try {foreach($record in $Records){$held=New-Object NerdSSHell.UpdatePath($record.path,$false);try{if((Get-UpdateHash $held.Stream) -cne $record.hash){return $false}}finally{$held.Dispose()}};return $true}catch{return $false}
}
function Start-UpdateInstaller([string]$Installer,[string]$Scope,[string]$Directory) {
  # NSIS /D is deliberately the final, unquoted remainder of the command line.
  $options=New-Object Diagnostics.ProcessStartInfo;$options.FileName=$Installer;$options.Arguments='/S /'+$Scope+' /D='+$Directory;$options.UseShellExecute=$true;$options.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
  return [Diagnostics.Process]::Start($options)
}
function Quote-UpdateArgument([string]$Value) { return '"'+[regex]::Replace([regex]::Replace($Value,'(\\*)"','$1$1\"'),'(\\+)$','$1$1')+'"' }
function Start-UpdatedApplication([string]$Executable,[string]$UserData) {
  $arguments=@(); if($UserData){$arguments+=('--user-data-dir='+$UserData)}
  $options=@{FilePath=$Executable;PassThru=$true;WorkingDirectory=[IO.Path]::GetDirectoryName($Executable)}
  if($arguments.Count){$options.ArgumentList=(@($arguments|ForEach-Object {Quote-UpdateArgument $_}) -join ' ')}
  $started=Start-Process @options; $started.Dispose()
}
function Write-UpdateConsoleProtocol([string]$Line) { [Console]::Out.WriteLine($Line);[Console]::Out.Flush() }
function Update-ControlPath([string]$Kind) {
  $names=@{READY='update-ready';GO='update-go';GOACK='update-go-ack';CANCEL='update-cancel';CANCELACK='update-cancel-ack';STOPPED='update-stopped';STOPREAD='update-stop-read'}
  if(-not $names.ContainsKey($Kind) -or -not $script:UpdateControlDirectory){throw 'Invalid control marker'}
  return [IO.Path]::Combine($script:UpdateControlDirectory,$names[$Kind])
}
function Read-UpdateMarker([string]$Kind,[string]$Nonce) {
  if($script:UpdateControlLeases.ContainsKey($Kind)){return $true}
  $path=Update-ControlPath $Kind
  if(-not [IO.File]::Exists($path)){return $false}
  $held=$null
  try {$held=New-Object NerdSSHell.UpdatePath($path,$false)}catch [IO.IOException]{return $false}
  try {
    if($held.Stream.Length -gt 128){throw 'Invalid control marker'}
    $reader=New-Object IO.StreamReader($held.Stream,[Text.Encoding]::ASCII,$false,128,$true)
    try {$text=$reader.ReadToEnd()}finally{$reader.Dispose()}
    if($text -cne ($Kind+' '+$Nonce+[char]10)){throw 'Invalid control marker'}
    $script:UpdateControlOwners.Add(@{path=$held.Path;identity=$held.Identity})
    $script:UpdateControlLeases[$Kind]=$held;$held=$null
    return $true
  }finally{if($null -ne $held){$held.Dispose()}}
}
function Write-UpdateMarker([string]$Kind,[string]$Nonce) {
  if($Nonce -notmatch '^[a-f0-9]{64}$'){throw 'Invalid control nonce'}
  $path=Update-ControlPath $Kind
  if([IO.File]::Exists($path)){if(Read-UpdateMarker $Kind $Nonce){return}else{throw 'Occupied control marker'}}
  $file=New-Object IO.FileStream($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try {$identity=[NerdSSHell.UpdatePath]::FileIdentity($file.SafeFileHandle);$bytes=[Text.Encoding]::ASCII.GetBytes($Kind+' '+$Nonce+[char]10);$file.Write($bytes,0,$bytes.Length);$file.Flush($true);$script:UpdateControlOwners.Add(@{path=$path;identity=$identity})}finally{$file.Dispose()}
}
function Close-UpdateControlLeases {foreach($held in $script:UpdateControlLeases.Values){$held.Dispose()};$script:UpdateControlLeases=@{}}
function Write-UpdateProtocol([string]$Line) {
  $parts=$Line.Split(' ');if($parts.Length -ne 2){throw 'Invalid control response'}
  $kind=$(if($parts[0] -ceq 'GO'){'GOACK'}elseif($parts[0] -ceq 'CANCEL'){'CANCELACK'}else{$parts[0]})
  Write-UpdateMarker $kind $parts[1]
}
function Read-UpdateCommand($Read,[int]$Milliseconds) { if(-not $Read.Wait($Milliseconds)){throw 'Command timed out'};return $Read.Result }
function Remove-UpdateOwnedStage($Owner,$Files) {
  if($null -eq $Owner){return}
  try {
    $held=New-Object NerdSSHell.UpdatePath($Owner.path,$true,$true)
    try {
      if($held.Identity -cne $Owner.identity -or -not (Same-UpdatePath $held.Path $Owner.path)){return}
      foreach($file in $Files){
        $check=$null
        try {
          $check=New-Object NerdSSHell.UpdatePath($file.path,$false,$true)
          if($check.Identity -ceq $file.identity -and (Same-UpdatePath ([IO.Path]::GetDirectoryName($check.Path)) $Owner.path)){$check.MarkDelete()}
        }catch{}finally{if($null -ne $check){$check.Dispose()}}
      }
      # Handle-based deletion affects the checked object, never a path swapped
      # after inspection. A nonempty directory (unknown files) cannot be deleted.
      $held.MarkDelete()
    }finally{$held.Dispose()}
  }catch{}
}
function Add-UpdateKnownCleanupFiles($Owner,$Manifest,$Files) {
  if($null -eq $Owner -or $null -eq $Manifest){return}
  # Adopt only original IDs bound by the immutable manifest, even on refusal.
  $known=@(@{name='update-runner.ps1';identity=$Manifest.runnerIdentity},@{name='update-manifest.json';identity=$Manifest.manifestIdentity},@{name=('NerdSSHell-'+$Manifest.targetVersion+'-x64-Setup.exe');identity=$Manifest.installerIdentity})
  foreach($file in $known){$held=$null;try{$held=New-Object NerdSSHell.UpdatePath([IO.Path]::Combine($Owner.path,$file.name),$false);if($held.Identity -ceq $file.identity -and (Same-UpdatePath ([IO.Path]::GetDirectoryName($held.Path)) $Owner.path)){$Files.Add(@{path=$held.Path;identity=$held.Identity})}}catch{}finally{if($held){$held.Dispose()}}}
}
function Complete-UpdateCleanup { $files=@($script:UpdateCleanupFiles)+@($script:UpdateControlOwners.ToArray());if($script:UpdateRetainStop){$files=@($files|Where-Object {[IO.Path]::GetFileName($_.path) -cne 'update-stopped'})};Remove-UpdateOwnedStage $script:UpdateCleanupOwner $files }
function Invoke-UpdateRunner([string]$Path,[string]$ManifestSha256,[int]$BrokerPid,[int]$CommandTimeoutMs=60000,[int]$ParentTimeoutMs=120000,[int]$InstallerTimeoutMs=600000) {
  $leases=New-Object 'System.Collections.Generic.List[IDisposable]';$owned=@();$owner=$null;$parent=$null;$broker=$null;$installerProcess=$null;$manifest=$null;$oldIdentity=$null;$oldVersion=$null;$scope=$null;$go=$false;$parentExited=$false;$installComplete=$false;$status='refused';$phase='prepare'
  try {
    $manifestLease=New-Object NerdSSHell.UpdatePath($Path,$false);$leases.Add($manifestLease)
    if($ManifestSha256 -notmatch '^[a-f0-9]{64}$' -or $manifestLease.Stream.Length -lt 1 -or $manifestLease.Stream.Length -gt 16384 -or (Get-UpdateHash $manifestLease.Stream) -cne $ManifestSha256){throw 'Invalid manifest'}
    $reader=New-Object IO.StreamReader($manifestLease.Stream,[Text.Encoding]::UTF8,$true,1024,$true);try{$manifest=ConvertFrom-Json $reader.ReadToEnd()}finally{$reader.Dispose()}
    $names=@($manifest.PSObject.Properties.Name)
    if(@($names|Where-Object {$_ -notin @('stageDirectory','installerPath','sha256','size','targetVersion','executablePath','userDataDirectory','parentPid','nonce','stageIdentity','installerIdentity','runnerIdentity','manifestIdentity')}).Count -or $names.Count -notin @(12,13) -or $manifest.nonce -notmatch '^[a-f0-9]{64}$' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.targetVersion -notmatch '^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$' -or @($manifest.targetVersion.Split('.')|Where-Object {[int]$_ -gt 65535}).Count -or $manifest.size -lt 2 -or $manifest.size -gt 536870912 -or $manifest.size -ne [long]$manifest.size -or $manifest.parentPid -lt 1 -or $manifest.parentPid -ne [int]$manifest.parentPid -or $manifest.parentPid -eq $PID){throw 'Invalid manifest'}
    $stage=New-Object NerdSSHell.UpdatePath($manifest.stageDirectory,$true);$leases.Add($stage)
    $temp=New-Object NerdSSHell.UpdatePath([IO.Path]::GetTempPath(),$true);try{if(-not (Same-UpdatePath ([IO.Path]::GetDirectoryName($stage.Path)) $temp.Path) -or [IO.Path]::GetFileName($stage.Path) -notmatch '^nerdsshell-update-[A-Za-z0-9_-]+$'){throw 'Invalid stage'}}finally{$temp.Dispose()}
    if($stage.Identity -cne $manifest.stageIdentity){throw 'Stage identity changed'}
    $owner=@{path=$stage.Path;identity=$stage.Identity};$script:UpdateControlDirectory=$stage.Path;$script:UpdateControlStage=$stage
    if(-not (Same-UpdatePath ([IO.Path]::GetDirectoryName($manifestLease.Path)) $stage.Path) -or [IO.Path]::GetFileName($manifestLease.Path) -cne 'update-manifest.json' -or $manifestLease.Identity -cne $manifest.manifestIdentity){throw 'Invalid manifest path'}
    $owned+=@{path=$manifestLease.Path;identity=$manifestLease.Identity}
    $runner=New-Object NerdSSHell.UpdatePath([IO.Path]::Combine($stage.Path,'update-runner.ps1'),$false);$leases.Add($runner);if($runner.Identity -cne $manifest.runnerIdentity){throw 'Runner identity changed'};$owned+=@{path=$runner.Path;identity=$runner.Identity}
    $installer=New-Object NerdSSHell.UpdatePath($manifest.installerPath,$false);$leases.Add($installer);if($installer.Identity -cne $manifest.installerIdentity){throw 'Installer identity changed'};$owned+=@{path=$installer.Path;identity=$installer.Identity}
    if(-not (Same-UpdatePath ([IO.Path]::GetDirectoryName($installer.Path)) $stage.Path) -or [IO.Path]::GetFileName($installer.Path) -cne ('NerdSSHell-'+$manifest.targetVersion+'-x64-Setup.exe') -or $installer.Stream.Length -ne $manifest.size -or (Get-UpdateHash $installer.Stream) -cne $manifest.sha256 -or $installer.Stream.ReadByte() -ne 77 -or $installer.Stream.ReadByte() -ne 90){throw 'Invalid installer'}
    $executable=New-Object NerdSSHell.UpdatePath($manifest.executablePath,$false)
    try {if([IO.Path]::GetFileName($executable.Path) -ine 'NerdSSHell.exe'){throw 'Invalid application'};$directory=[IO.Path]::GetDirectoryName($executable.Path);$oldVersion=Get-UpdateVersion $executable.Path;if([version]$manifest.targetVersion -le [version]$oldVersion){throw 'Version must increase'};if($directory.Length -gt 900){throw 'Install path too long'};$scope=Get-UpdateScope $directory}finally{$executable.Dispose()}
    if($names -contains 'userDataDirectory'){$data=New-Object NerdSSHell.UpdatePath($manifest.userDataDirectory,$true);try{if((Within-UpdatePath $directory $data.Path) -or (Within-UpdatePath $stage.Path $data.Path) -or (Within-UpdatePath $data.Path $stage.Path)){throw 'User data overlaps update paths'};$manifest.userDataDirectory=$data.Path}finally{$data.Dispose()}}
    $oldIdentity=Get-UpdateRecoveryIdentity $directory
    $parent=[Diagnostics.Process]::GetProcessById([int]$manifest.parentPid);$script:UpdateParentLease=$parent;$parentHandle=$parent.Handle;$parentStart=$parent.StartTime.ToUniversalTime().Ticks
    $parentFile=New-Object NerdSSHell.UpdatePath($parent.MainModule.FileName,$false);try{if($parent.HasExited -or -not (Same-UpdatePath $parentFile.Path $manifest.executablePath) -or $parent.StartTime.ToUniversalTime().Ticks -ne $parentStart){throw 'Wrong parent identity'}}finally{$parentFile.Dispose()}
    $broker=[Diagnostics.Process]::GetProcessById($BrokerPid);$brokerHandle=$broker.Handle;$brokerStart=$broker.StartTime.ToUniversalTime().Ticks
    $script:UpdateBrokerLease=$broker
    if($BrokerPid -eq $PID -or $broker.HasExited -or -not (Same-UpdatePath $broker.MainModule.FileName ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)) -or $broker.StartTime.ToUniversalTime().Ticks -ne $brokerStart){throw 'Wrong broker identity'}
    $phase='command';Write-UpdateProtocol ('READY '+$manifest.nonce)
    $deadline=[DateTime]::UtcNow.AddMilliseconds($CommandTimeoutMs)
    while($true){
      if(Read-UpdateMarker 'CANCEL' $manifest.nonce){Write-UpdateProtocol ('CANCEL '+$manifest.nonce);$status='cancelled';return $status}
      if($parent.HasExited -or $broker.HasExited){throw 'Unreleased handoff ended'}
      if(Read-UpdateMarker 'GO' $manifest.nonce){break}
      if([DateTime]::UtcNow -gt $deadline){throw 'Command timed out'}
      Start-Sleep -Milliseconds 25
    }
    if((Get-UpdateScope $directory) -cne $scope){throw 'Registration changed'}
    $go=$true;$phase='parent';Write-UpdateProtocol ('GO '+$manifest.nonce)
    $deadline=[DateTime]::UtcNow.AddMilliseconds($ParentTimeoutMs);$brokerExitDeadline=$null
    while($true){
      if(Read-UpdateMarker 'CANCEL' $manifest.nonce){Write-UpdateProtocol ('CANCEL '+$manifest.nonce);$status='cancelled';return $status}
      if($parent.HasExited){$parentExited=$true;break}
      # libuv's kill-job may close the broker a moment before orderly app exit.
      # A bounded grace cannot arm an update for an indefinitely later quit.
      if($broker.HasExited){if($null -eq $brokerExitDeadline){$brokerExitDeadline=[DateTime]::UtcNow.AddMilliseconds(5000)};if([DateTime]::UtcNow -gt $brokerExitDeadline){throw 'Broker ended while app remained alive'}}
      if([DateTime]::UtcNow -gt $deadline){throw 'Parent did not exit'}
      Start-Sleep -Milliseconds 25
    }
    $phase='install';Assert-NoUpdateInstances
    if((Get-UpdateScope $directory) -cne $scope -or -not (Test-UpdateRecoveryIdentity $oldIdentity) -or $installer.Stream.Length -ne $manifest.size -or (Get-UpdateHash $installer.Stream) -cne $manifest.sha256){throw 'Identity changed'}
    $installerProcess=Start-UpdateInstaller $installer.Path $scope $directory
    if(-not $installerProcess.WaitForExit($InstallerTimeoutMs)){throw 'Installer still running'}
    $installComplete=$true;if($installerProcess.ExitCode -ne 0){throw 'Installer failed'}
    $phase='restart';Assert-NoUpdateInstances
    $updated=New-Object NerdSSHell.UpdatePath($manifest.executablePath,$false);try{if((Get-UpdateScope $directory) -cne $scope -or (Get-UpdateVersion $updated.Path) -cne $manifest.targetVersion){throw 'Updated version mismatch'}}finally{$updated.Dispose()}
    if($names -contains 'userDataDirectory'){$data=New-Object NerdSSHell.UpdatePath($manifest.userDataDirectory,$true);$data.Dispose()}
    $userData=$(if($names -contains 'userDataDirectory'){$manifest.userDataDirectory}else{$null})
    Start-UpdatedApplication $manifest.executablePath $userData
    $status='updated';return $status
  }catch{
    # Never kill the application, installer, reopened instance or another process.
    # An unchanged known payload can be reopened; partially changed files cannot.
    if($go -and $parentExited -and ($null -eq $installerProcess -or $installComplete) -and $null -ne $oldIdentity -and (Test-UpdateRecoveryIdentity $oldIdentity)){
      try {Assert-NoUpdateInstances;if((Get-UpdateScope ([IO.Path]::GetDirectoryName($manifest.executablePath))) -cne $scope -or (Get-UpdateVersion $manifest.executablePath) -cne $oldVersion){throw 'Old identity changed'};$userData=$(if(@($manifest.PSObject.Properties.Name) -contains 'userDataDirectory'){$manifest.userDataDirectory}else{$null});if($userData){$data=New-Object NerdSSHell.UpdatePath($userData,$true);$data.Dispose()};Start-UpdatedApplication $manifest.executablePath $userData;$status='restored'}catch{$status='refused'}
    }
    return $status
  }finally{
    if($null -ne $installerProcess){$installerProcess.Dispose()};if($null -ne $parent -and -not [object]::ReferenceEquals($parent,$script:UpdateParentLease)){$parent.Dispose()};if($null -ne $broker -and -not [object]::ReferenceEquals($broker,$script:UpdateBrokerLease)){$broker.Dispose()};Close-UpdateControlLeases;for($i=$leases.Count-1;$i -ge 0;$i--){$lease=$leases[$i];if(-not [object]::ReferenceEquals($lease,$script:UpdateControlStage)){$lease.Dispose()}};$original=New-Object 'System.Collections.Generic.List[object]';foreach($record in $owned){$original.Add($record)};Add-UpdateKnownCleanupFiles $owner $manifest $original;$script:UpdateCleanupOwner=$owner;$script:UpdateCleanupFiles=$original.ToArray()
  }
}
function Quote-UpdatePowerShell([string]$Value) { return "'"+$Value.Replace("'","''")+"'" }
function New-UpdateWorkerBootstrap([string]$Runner,[string]$RunnerSha256,[string]$Path,[string]$ManifestSha256,[int]$BrokerPid,[string]$Nonce) {
  if($RunnerSha256 -notmatch '^[a-f0-9]{64}$' -or $ManifestSha256 -notmatch '^[a-f0-9]{64}$' -or $Nonce -notmatch '^[a-f0-9]{64}$' -or $BrokerPid -lt 1){throw 'Invalid worker bootstrap'}
  # Literal paths/hash/PID only; this is the fixed bundled source, never release code.
  $prefix='$ErrorActionPreference=''Stop'';$f=[IO.File]::Open('+(Quote-UpdatePowerShell $Runner)+',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{if($f.Length -lt 1 -or $f.Length -gt 131072){throw ''Invalid helper''};$b=New-Object byte[] ([int]$f.Length);$n=0;while($n -lt $b.Length){$r=$f.Read($b,$n,$b.Length-$n);if($r -le 0){throw ''Truncated helper''};$n+=$r};$h=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace(''-'','''').ToLowerInvariant();if($h -ne '+(Quote-UpdatePowerShell $RunnerSha256)+'){throw ''Invalid helper''};. ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b)));$script:UpdateFileTransport=$true;'
  $entry='$result=Invoke-UpdateRunner -Path '+(Quote-UpdatePowerShell $Path)+' -ManifestSha256 '+(Quote-UpdatePowerShell $ManifestSha256)+' -BrokerPid '+$BrokerPid+';if($script:UpdateControlStage){Write-UpdateMarker ''STOPPED'' '+(Quote-UpdatePowerShell $Nonce)+';$limit=[DateTime]::UtcNow.AddMilliseconds(10000);while(-not (Read-UpdateMarker ''STOPREAD'' '+(Quote-UpdatePowerShell $Nonce)+')){if($script:UpdateParentLease -and $script:UpdateParentLease.HasExited){break};if([DateTime]::UtcNow -gt $limit){$script:UpdateRetainStop=$true;break};Start-Sleep -Milliseconds 25}}'
  $suffix='}finally{$f.Dispose();Close-UpdateControlLeases;if($script:UpdateControlStage){$script:UpdateControlStage.Dispose()};if($script:UpdateParentLease){$script:UpdateParentLease.Dispose()};if($script:UpdateBrokerLease){try{$script:UpdateBrokerLease.WaitForExit(15000)|Out-Null}finally{$script:UpdateBrokerLease.Dispose()}};Complete-UpdateCleanup};if($result -in @(''updated'',''cancelled'',''restored'')){exit 0}else{exit 1}'
  return $prefix+$entry+$suffix
}
function Invoke-UpdateBroker([string]$RunnerPath,[string]$RunnerSha256,[string]$Path,[string]$ManifestSha256) {
  $stage=$null;$held=$null;$parent=$null;$worker=$null;$manifest=$null;$go=$false;$stopped=$false
  try {
    $held=New-Object NerdSSHell.UpdatePath($Path,$false)
    if($held.Stream.Length -gt 16384 -or (Get-UpdateHash $held.Stream) -cne $ManifestSha256){throw 'Invalid manifest'}
    $reader=New-Object IO.StreamReader($held.Stream,[Text.Encoding]::UTF8,$true,1024,$true);try{$manifest=ConvertFrom-Json $reader.ReadToEnd()}finally{$reader.Dispose()}
    if($manifest.nonce -notmatch '^[a-f0-9]{64}$' -or $held.Identity -cne $manifest.manifestIdentity){throw 'Invalid manifest'}
    $stage=New-Object NerdSSHell.UpdatePath($manifest.stageDirectory,$true)
    if($stage.Identity -cne $manifest.stageIdentity -or -not (Same-UpdatePath ([IO.Path]::GetDirectoryName($held.Path)) $stage.Path)){throw 'Invalid stage'}
    $script:UpdateControlDirectory=$stage.Path;$script:UpdateCleanupOwner=@{path=$stage.Path;identity=$stage.Identity}
    $parent=[Diagnostics.Process]::GetProcessById([int]$manifest.parentPid);$parentHandle=$parent.Handle
    $bootstrap=New-UpdateWorkerBootstrap $RunnerPath $RunnerSha256 $Path $ManifestSha256 $PID $manifest.nonce
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
    $powerShell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    # Node's non-detached Windows children are killed with its libuv job. A
    # hidden Start-Process grandchild has an independent console and lifetime.
    $worker=Start-Process -FilePath $powerShell -ArgumentList ('-NoLogo -NoProfile -NonInteractive -EncodedCommand '+$encoded) -WindowStyle Hidden -PassThru
    $workerHandle=$worker.Handle;$workerStart=$worker.StartTime.ToUniversalTime().Ticks
    $read=[NerdSSHell.UpdateControl]::ReadCommand();$deadline=[DateTime]::UtcNow.AddMilliseconds(15000)
    while(-not (Read-UpdateMarker 'READY' $manifest.nonce)) {
      if(Read-UpdateMarker 'STOPPED' $manifest.nonce){$stopped=$true;throw 'Worker refused preparation'}
      if($worker.HasExited -or $parent.HasExited -or $read.IsCompleted -or [DateTime]::UtcNow -gt $deadline){throw 'Worker could not prepare'}
      Start-Sleep -Milliseconds 25
    }
    Write-UpdateConsoleProtocol ('READY '+$manifest.nonce)
    $deadline=[DateTime]::UtcNow.AddMilliseconds(60000)
    while($true) {
      if(Read-UpdateMarker 'STOPPED' $manifest.nonce){$stopped=$true;if($go -and $parent.HasExited){return 'released'};throw 'Worker stopped'}
      if($worker.HasExited){throw 'Worker ended'}
      if($parent.HasExited){if($go){return 'released'}else{throw 'Parent ended without release'}}
      if([DateTime]::UtcNow -gt $deadline){throw 'Control timed out'}
      if(-not $read.IsCompleted){Start-Sleep -Milliseconds 25;continue}
      $command=$read.Result
      if($command -ceq ('CANCEL '+$manifest.nonce)) {
        Write-UpdateMarker 'CANCEL' $manifest.nonce
        $limit=[DateTime]::UtcNow.AddMilliseconds(10000)
        while(-not (Read-UpdateMarker 'STOPPED' $manifest.nonce)){if($worker.HasExited -or [DateTime]::UtcNow -gt $limit){throw 'Worker cancellation did not finish'};Start-Sleep -Milliseconds 25}
        $stopped=$true;Write-UpdateConsoleProtocol ('CANCEL '+$manifest.nonce);return 'cancelled'
      }
      if($command -cne ('GO '+$manifest.nonce) -or $go){throw 'Invalid command'}
      Write-UpdateMarker 'GO' $manifest.nonce
      $read=[NerdSSHell.UpdateControl]::ReadCommand();$limit=[DateTime]::UtcNow.AddMilliseconds(10000)
      while(-not (Read-UpdateMarker 'GOACK' $manifest.nonce)) {
        if(Read-UpdateMarker 'STOPPED' $manifest.nonce){$stopped=$true;throw 'Worker refused release'}
        if($read.IsCompleted){if($read.Result -ceq ('CANCEL '+$manifest.nonce)){break}else{throw 'Control ended'}}
        if($worker.HasExited -or [DateTime]::UtcNow -gt $limit){throw 'Worker release was not acknowledged'}
        Start-Sleep -Milliseconds 25
      }
      if($read.IsCompleted -and $read.Result -ceq ('CANCEL '+$manifest.nonce)){continue}
      $go=$true;Write-UpdateConsoleProtocol ('GO '+$manifest.nonce);$deadline=[DateTime]::UtcNow.AddMilliseconds(120000)
    }
  }catch{
    # Failure/EOF before parent exit cannot leave an armed worker for later quit.
    if(-not $stopped -and $stage -and $manifest -and $worker -and -not $worker.HasExited -and ($null -eq $parent -or -not $parent.HasExited)){
      try {Write-UpdateMarker 'CANCEL' $manifest.nonce;$limit=[DateTime]::UtcNow.AddMilliseconds(10000);while(-not (Read-UpdateMarker 'STOPPED' $manifest.nonce)){if($worker.HasExited -or [DateTime]::UtcNow -gt $limit){break};Start-Sleep -Milliseconds 25};$stopped=($worker.HasExited -or (Read-UpdateMarker 'STOPPED' $manifest.nonce))}catch{}
    }
    if($worker -and $worker.HasExited){$stopped=$true}
    if(($stopped -or $null -eq $worker) -and $manifest -and $manifest.nonce -match '^[a-f0-9]{64}$'){Write-UpdateConsoleProtocol ('STOPPED '+$manifest.nonce)}
    return 'refused'
  }finally{
    Close-UpdateControlLeases
    if($held){$held.Dispose()};if($stage){$stage.Dispose()};if($parent){$parent.Dispose()};if($worker){$worker.Dispose()}
    # A released worker owns GO/markers after app exit. Cleanup is safe only when
    # cancellation stopped it or no worker was created; never remove its GO.
    if($worker){$script:UpdateCleanupOwner=$null} # The independent worker alone owns marker cleanup.
  }
}
# Tests dot-source checksum-verified bytes to replace narrow fixture dependencies.
if($MyInvocation.InvocationName -ne '.') { throw 'Use the fixed verified update bootstrap.' }
