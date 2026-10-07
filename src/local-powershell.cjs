'use strict';
// Process-local interactive input colors. No profile, module installation, PATH
// lookup or execution-policy change; only the shell bundle and Windows' fixed
// Program Files module folder are considered. Absence leaves an ordinary shell.
function syntaxBootstrap() {
  return `& {
    try {
      $bettersshModule = [System.IO.Path]::Combine($PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1')
      if (-not [System.IO.File]::Exists($bettersshModule) -and $PSVersionTable.PSVersion.Major -le 5) {
        $bettersshRoot = [System.IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), 'WindowsPowerShell', 'Modules', 'PSReadLine')
        if ([System.IO.Directory]::Exists($bettersshRoot)) {
          if (([System.IO.File]::GetAttributes($bettersshRoot) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsupported PSReadLine link' }
          $bettersshModule = [System.IO.Path]::Combine($bettersshRoot, 'PSReadLine.psd1')
          if (-not [System.IO.File]::Exists($bettersshModule)) {
            $bettersshBest = [Version]'0.0'; $bettersshCount = 0
            foreach ($bettersshFolder in [System.IO.Directory]::EnumerateDirectories($bettersshRoot)) {
              $bettersshCount++; if ($bettersshCount -gt 32) { throw 'Too many PSReadLine versions' }
              $bettersshVersion = [System.IO.Path]::GetFileName($bettersshFolder)
              if ($bettersshVersion -match '^\\d+\\.\\d+(\\.\\d+){0,2}$') {
                $bettersshCandidate = [System.IO.Path]::Combine($bettersshFolder, 'PSReadLine.psd1')
                if ([Version]$bettersshVersion -gt $bettersshBest -and [System.IO.File]::Exists($bettersshCandidate) -and ([System.IO.File]::GetAttributes($bettersshFolder) -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
                  $bettersshBest = [Version]$bettersshVersion; $bettersshModule = $bettersshCandidate
                }
              }
            }
          }
        }
      }
      if ([System.IO.File]::Exists($bettersshModule)) {
        if (([System.IO.File]::GetAttributes($bettersshModule) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsupported PSReadLine link' }
        Microsoft.PowerShell.Core\\Import-Module -Name $bettersshModule -Force -ErrorAction Stop
        PSReadLine\\Set-PSReadLineOption -HistorySaveStyle SaveNothing -ErrorAction Stop
        # Older bundled PSReadLine versions lack -Colors. Keep history disabled
        # even when that optional color configuration is unavailable.
        PSReadLine\\Set-PSReadLineOption -Colors @{
          Command='Cyan'; Comment='DarkGray'; Keyword='Magenta'; String='Green';
          Variable='Cyan'; Number='Yellow'; Operator='White'; Parameter='Blue'; Type='Yellow'
        } -ErrorAction Stop
      }
    } catch { }
  }\n`;
}
module.exports = { syntaxBootstrap };
