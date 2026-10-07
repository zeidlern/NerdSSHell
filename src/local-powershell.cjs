'use strict';
// Process-local interactive input colors. No profile, module installation, PATH
// lookup or execution-policy change; only the shell bundle and Windows' fixed
// Program Files module folder are considered. Absence leaves an ordinary shell.
function syntaxBootstrap() {
  return `& {
    try {
      $nerdsshellModule = [System.IO.Path]::Combine($PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1')
      if (-not [System.IO.File]::Exists($nerdsshellModule) -and $PSVersionTable.PSVersion.Major -le 5) {
        $nerdsshellRoot = [System.IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), 'WindowsPowerShell', 'Modules', 'PSReadLine')
        if ([System.IO.Directory]::Exists($nerdsshellRoot)) {
          if (([System.IO.File]::GetAttributes($nerdsshellRoot) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsupported PSReadLine link' }
          $nerdsshellModule = [System.IO.Path]::Combine($nerdsshellRoot, 'PSReadLine.psd1')
          if (-not [System.IO.File]::Exists($nerdsshellModule)) {
            $nerdsshellBest = [Version]'0.0'; $nerdsshellCount = 0
            foreach ($nerdsshellFolder in [System.IO.Directory]::EnumerateDirectories($nerdsshellRoot)) {
              $nerdsshellCount++; if ($nerdsshellCount -gt 32) { throw 'Too many PSReadLine versions' }
              $nerdsshellVersion = [System.IO.Path]::GetFileName($nerdsshellFolder)
              if ($nerdsshellVersion -match '^\\d+\\.\\d+(\\.\\d+){0,2}$') {
                $nerdsshellCandidate = [System.IO.Path]::Combine($nerdsshellFolder, 'PSReadLine.psd1')
                if ([Version]$nerdsshellVersion -gt $nerdsshellBest -and [System.IO.File]::Exists($nerdsshellCandidate) -and ([System.IO.File]::GetAttributes($nerdsshellFolder) -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
                  $nerdsshellBest = [Version]$nerdsshellVersion; $nerdsshellModule = $nerdsshellCandidate
                }
              }
            }
          }
        }
      }
      if ([System.IO.File]::Exists($nerdsshellModule)) {
        if (([System.IO.File]::GetAttributes($nerdsshellModule) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsupported PSReadLine link' }
        Microsoft.PowerShell.Core\\Import-Module -Name $nerdsshellModule -Force -ErrorAction Stop
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
