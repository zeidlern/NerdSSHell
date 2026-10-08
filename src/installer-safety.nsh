; All installer/uninstaller paths must let work close through the app itself.
; Never use NSIS's default process-name termination, even in silent mode.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "NerdSSHell.exe" $R0
  ${If} $R0 != 603
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Close NerdSSHell normally before installing or removing it. Handle unsaved notes and Standard SSH work in the app first."
    ${EndIf}
    SetErrorLevel 1618
    Quit
  ${EndIf}
  ${nsProcess::FindProcess} "BetterSSH.exe" $R0
  ${If} $R0 != 603
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Close the existing BetterSSH application normally first."
    ${EndIf}
    SetErrorLevel 1618
    Quit
  ${EndIf}
!macroend
