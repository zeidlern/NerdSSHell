'use strict';
// Test-only local inspection. Never reads a history file or changes a module,
// profile, environment variable, execution policy, or machine configuration.
const PSREADLINE_ASSERTION = String.raw`
$fixtureAvailable=$false; $fixtureSyntax=$false;
try {
  $fixtureExpected=[IO.Path]::Combine($PSHOME,'Modules','PSReadLine','PSReadLine.psd1');
  if (-not [IO.File]::Exists($fixtureExpected) -and $PSVersionTable.PSVersion.Major -le 5) {
    $fixtureRoot=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),'WindowsPowerShell','Modules','PSReadLine');
    if ([IO.Directory]::Exists($fixtureRoot)) {
      if (([IO.File]::GetAttributes($fixtureRoot) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unexpected linked PSReadLine root' };
      $fixtureExpected=[IO.Path]::Combine($fixtureRoot,'PSReadLine.psd1');
      if (-not [IO.File]::Exists($fixtureExpected)) {
        $fixtureBest=[version]'0.0'; $fixtureSeen=0;
        foreach($fixtureFolder in [IO.Directory]::EnumerateDirectories($fixtureRoot)) {
          $fixtureSeen++; if($fixtureSeen -gt 32){throw 'Unexpected PSReadLine version count'};
          $fixtureVersion=[IO.Path]::GetFileName($fixtureFolder);
          if($fixtureVersion -match '^\d+\.\d+(\.\d+){0,2}$' -and ([IO.File]::GetAttributes($fixtureFolder) -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            $fixtureCandidate=[IO.Path]::Combine($fixtureFolder,'PSReadLine.psd1');
            if([IO.File]::Exists($fixtureCandidate) -and [version]$fixtureVersion -gt $fixtureBest) {
              $fixtureBest=[version]$fixtureVersion; $fixtureExpected=$fixtureCandidate
            }
          }
        }
      }
    }
  };
  $fixtureAvailable=[IO.File]::Exists($fixtureExpected);
  $fixtureLoaded=@(Microsoft.PowerShell.Core\Get-Module PSReadLine);
  if ($fixtureAvailable) {
    if (([IO.File]::GetAttributes($fixtureExpected) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unexpected linked PSReadLine manifest' };
    $fixtureSyntax=$fixtureLoaded.Count -eq 1 -and [string]::Equals([IO.Path]::GetFullPath($fixtureLoaded[0].ModuleBase),[IO.Path]::GetDirectoryName($fixtureExpected),[StringComparison]::OrdinalIgnoreCase) -and (PSReadLine\Get-PSReadLineOption).HistorySaveStyle.ToString() -eq 'SaveNothing'
  } else {
    $fixtureSyntax=$fixtureLoaded.Count -eq 0
  }
} catch { $fixtureSyntax=$false };
`;
// Complete bounded input statements avoid making this inspection itself one
// multi-screen PSReadLine editing operation. Each statement is acknowledged
// before the next is entered; the same final path and history gates remain.
const guarded = body => `try { ${body} } catch { $fixtureValid=$false }; `;
const PSREADLINE_ASSERTION_COMMANDS = [
  "$fixtureAvailable=$false; $fixtureSyntax=$false; $fixtureValid=$true; $fixtureScan=$false; $fixtureFolders=@(); $fixtureExpected=[IO.Path]::Combine($PSHOME,'Modules','PSReadLine','PSReadLine.psd1'); ",
  guarded("$fixtureFallback=-not [IO.File]::Exists($fixtureExpected) -and $PSVersionTable.PSVersion.Major -le 5; $fixtureRoot=[IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),'WindowsPowerShell','Modules','PSReadLine');"),
  guarded("if($fixtureFallback -and [IO.Directory]::Exists($fixtureRoot)){if(([IO.File]::GetAttributes($fixtureRoot) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked root'}; $fixtureExpected=[IO.Path]::Combine($fixtureRoot,'PSReadLine.psd1'); $fixtureScan=-not [IO.File]::Exists($fixtureExpected)};"),
  guarded("if($fixtureValid -and $fixtureScan){$fixtureSeen=0; foreach($fixtureFolder in [IO.Directory]::EnumerateDirectories($fixtureRoot)){$fixtureSeen++; if($fixtureSeen -gt 32){throw 'Version count'}; $fixtureFolders+=,$fixtureFolder}; $fixtureBest=[version]'0.0'};"),
  guarded(String.raw`if($fixtureValid -and $fixtureScan){foreach($fixtureFolder in $fixtureFolders){$fixtureVersion=[IO.Path]::GetFileName($fixtureFolder); if($fixtureVersion -match '^\d+\.\d+(\.\d+){0,2}$' -and ([IO.File]::GetAttributes($fixtureFolder) -band [IO.FileAttributes]::ReparsePoint) -eq 0){$fixtureCandidate=[IO.Path]::Combine($fixtureFolder,'PSReadLine.psd1'); if([IO.File]::Exists($fixtureCandidate) -and [version]$fixtureVersion -gt $fixtureBest){$fixtureBest=[version]$fixtureVersion; $fixtureExpected=$fixtureCandidate}}}};`),
  guarded("$fixtureAvailable=[IO.File]::Exists($fixtureExpected); $fixtureLoaded=@(Microsoft.PowerShell.Core\\Get-Module PSReadLine); if($fixtureAvailable -and ([IO.File]::GetAttributes($fixtureExpected) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked manifest'};"),
  guarded("if($fixtureValid -and $fixtureAvailable){$fixtureSyntax=$fixtureLoaded.Count -eq 1 -and [string]::Equals([IO.Path]::GetFullPath($fixtureLoaded[0].ModuleBase),[IO.Path]::GetDirectoryName($fixtureExpected),[StringComparison]::OrdinalIgnoreCase)} elseif($fixtureValid){$fixtureSyntax=$fixtureLoaded.Count -eq 0};"),
  "if($fixtureSyntax -and $fixtureAvailable){try{$fixtureSyntax=(PSReadLine\\Get-PSReadLineOption).HistorySaveStyle.ToString() -eq 'SaveNothing'}catch{$fixtureSyntax=$false}}; $fixtureSyntax=$fixtureValid -and $fixtureSyntax; "
];
module.exports = { PSREADLINE_ASSERTION: PSREADLINE_ASSERTION.replace(/\r?\n/g, '; '), PSREADLINE_ASSERTION_COMMANDS };
