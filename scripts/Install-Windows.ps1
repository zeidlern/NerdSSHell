[CmdletBinding()]
param([switch]$NoLaunch, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer, then open a fresh terminal and run this script again.' }
    $major = [int]((& node --version).Trim().TrimStart('v').Split('.')[0])
    if ($major -lt 22) { throw 'Node.js 22 or newer is required.' }
    if (-not (Test-Path package-lock.json)) { throw 'The committed package-lock.json is required for a reproducible build.' }
    $metadata = Get-Content package.json -Raw | ConvertFrom-Json
    $productName = $metadata.build.productName
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $npm ci --omit=optional
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
    & $npm test
    if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
    & $npm run dist
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
    & $npm run verify:package
    if ($LASTEXITCODE -ne 0) { throw 'Packaged application verification failed.' }
    $installerPath = Join-Path $projectRoot ('dist\{0}-{1}-x64-Setup.exe' -f $productName, $metadata.version)
    if (-not (Test-Path $installerPath -PathType Leaf)) { throw 'The installer for the current source version was not produced.' }
    Get-FileHash $installerPath -Algorithm SHA256 | Format-List
    if ($BuildOnly) { Write-Host "Verified build: $installerPath"; return }
    $running = @(Get-Process -Name 'BetterSSH', 'NerdSSHell' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) { throw 'Close the existing application normally before installing so its local-session and unsaved-note prompts can be handled. The installer has not run. Re-run this script afterward.' }
    Write-Host "Installing $productName $($metadata.version) for the current Windows user."
    $process = Start-Process -FilePath $installerPath -ArgumentList @('/S', '/currentuser') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }
    if (-not $NoLaunch) {
        # NSIS stores InstallLocation under its app-ID-derived GUID, separately
        # from the Uninstall entry. This preserves custom/legacy install paths.
        $locations = @()
        $installerGuid = [string](& node -e "const m=require('./package.json'),{UUID}=require('builder-util-runtime');console.log(m.build.nsis.guid||UUID.v5(m.build.appId,UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')));")
        if ($LASTEXITCODE -eq 0 -and $installerGuid.Trim() -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
            $installation = Get-ItemProperty -LiteralPath ('HKCU:\Software\' + $installerGuid.Trim()) -Name InstallLocation -ErrorAction SilentlyContinue
            if ($installation -and $installation.PSObject.Properties['InstallLocation']) { $locations += $installation.InstallLocation }
        }
        $locations += @(Join-Path $env:LOCALAPPDATA 'Programs\NerdSSHell'; Join-Path $env:LOCALAPPDATA 'Programs\BetterSSH')
        $installedExe = $locations | Where-Object { $_ } | ForEach-Object { Join-Path $_ ($productName + '.exe') } |
            Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
        if ($installedExe) { Start-Process -FilePath $installedExe }
        else { Write-Host 'Use the NerdSSHell shortcut in the Start menu to launch the installed app.' }
    }
} finally { Pop-Location }
