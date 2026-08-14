; GMgmt Windows Installer Script (NSIS)
; This script creates a Windows installer for GMgmt Gym Management Software

;--------------------------------
; Include Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
; ${RunningX64} (used by .onInit's architecture guard) lives in x64.nsh, not
; WinVer.nsh - without this include it stays unexpanded and LogicLib's ${If}
; fails with: macro "_If" requires 4 parameter(s), passed 2!
!include "x64.nsh"

;--------------------------------
; General

; Name and file
Name "GMgmt"
OutFile "GMgmt-Setup-${ARCH}.exe"
Unicode True

; Request application privileges for Windows Vista
RequestExecutionLevel admin

; Build information
!define VERSION "1.0.0"
!define COMPANY "GMgmt"
!define PRODUCT "Gym Management Software"
!define DESCRIPTION "Comprehensive Gym Management Software with Biometric Integration"

; Default installation folder
InstallDir "$PROGRAMFILES\gmgmt"

; Get installation folder from registry if available
InstallDirRegKey HKLM "Software\${COMPANY}" "Install_Dir"

;--------------------------------
; Variables

Var StartMenuFolder

;--------------------------------
; Interface Settings

!define MUI_ABORTWARNING
!define MUI_ICON "installer\gmgmt.ico"
!define MUI_UNICON "installer\gmgmt.ico"

;--------------------------------
; Pages

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY

; Start Menu Folder Page Configuration
!define MUI_STARTMENUPAGE_REGISTRY_ROOT "HKLM"
!define MUI_STARTMENUPAGE_REGISTRY_KEY "Software\${COMPANY}"
!define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "Start Menu Folder"

!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder

!insertmacro MUI_PAGE_INSTFILES

; Finish page
;
; MUI_FINISHPAGE_RUN is meant for a single standalone executable - pairing it
; with MUI_FINISHPAGE_RUN_PARAMETERS to invoke "node.exe <script>" runs into
; MUI2's internal Exec call being built from a single quoted string, and the
; PARAMETERS value's own embedded quotes closing that string early ("Exec
; expects 1 parameters, got 2" at compile time). RUN_FUNCTION (defined below,
; near the other Functions) sidesteps this entirely by making the Exec call
; ourselves.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION "RunServiceInstall"
!define MUI_FINISHPAGE_RUN_TEXT "Install as Windows Service"
!define MUI_FINISHPAGE_LINK "Open GMgmt in browser"
!define MUI_FINISHPAGE_LINK_LOCATION "http://localhost:3001"

!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

;--------------------------------
; Languages

!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Installer Sections

Section "GMgmt Core" SecCore

  SectionIn RO
  
  ; Copy application files. Each `File /r "dir\*"` extracts relative to the
  ; CURRENT SetOutPath, flattening the source dir's own name away - so
  ; SetOutPath must be pointed at the matching $INSTDIR subfolder before
  ; each call, or src/node_modules/public/scripts all merge into one flat
  ; directory (which is what happened before this fix: scripts\*.js ended up
  ; sitting directly in $INSTDIR, so "$INSTDIR\scripts\service-install.js"
  ; didn't exist and the service install step failed with MODULE_NOT_FOUND).
  SetOutPath "$INSTDIR\src"
  File /r "src\*"

  SetOutPath "$INSTDIR\node_modules"
  File /r "node_modules\*"

  SetOutPath "$INSTDIR\public"
  File /r "public\*"

  SetOutPath "$INSTDIR\scripts"
  File /r "scripts\*"

  SetOutPath "$INSTDIR\client\build"
  File /r "client\build\*"

  SetOutPath "$INSTDIR"
  File "package.json"
  File "package-lock.json"
  File "README.md"
  File "LICENSE.txt"

  ; Copy the bundled Node.js runtime for this build's architecture.
  ; ${ARCH} is substituted with a literal "x64"/"x86" by build-installer.js
  ; before makensis ever sees this file, so only the matching runtime's
  ; File instruction is compiled into each installer (the other branch
  ; is discarded at compile time, not chosen at install time).
  !if "${ARCH}" == "x64"
  File "vendor\node-win-x64\node.exe"
  !else
  File "vendor\node-win-ia32\node.exe"
  !endif
  
  ; Store installation folder
  WriteRegStr HKLM "Software\${COMPANY}" "Install_Dir" "$INSTDIR"
  
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  
  ; Add to Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "DisplayIcon" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "NoRepair" 1

SectionEnd

Section "Windows Service" SecService

  ; Create data directories
  CreateDirectory "$%ProgramData%\gmgmt\data"
  CreateDirectory "$%ProgramData%\gmgmt\logs"
  
  ; Create .env file
  FileOpen $0 "$%ProgramData%\gmgmt\.env" w
  FileWrite $0 "PORT=3001$\r$\n"
  FileWrite $0 "NODE_ENV=production$\r$\n"
  FileWrite $0 "EMAIL_USER=your_email@gmail.com$\r$\n"
  FileWrite $0 "EMAIL_PASS=your_app_password$\r$\n"
  FileWrite $0 "JWT_SECRET=your_super_secret_jwt_key$\r$\n"
  FileWrite $0 "ENABLE_BIOMETRIC=true$\r$\n"
  FileWrite $0 "BIOMETRIC_PORT=8080$\r$\n"
  FileWrite $0 "BIOMETRIC_HOST=0.0.0.0$\r$\n"
  FileClose $0
  
  ; Install Windows Service (using the bundled node.exe, not a system PATH
  ; lookup, so this works on a machine with no Node.js installed)
  DetailPrint "Installing GMgmt Windows Service..."
  nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\scripts\service-install.js"'
  Pop $0
  Pop $1
  DetailPrint "$1"
  FileOpen $2 "$INSTDIR\install-service.log" w
  FileWrite $2 "$1"
  FileClose $2
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to install Windows Service (exit code $0). See $INSTDIR\install-service.log for details."
  ${EndIf}

SectionEnd

Section "Firewall Rule" SecFirewall

  ; Add firewall rule for the API/web port
  DetailPrint "Adding Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt API" dir=in action=allow protocol=TCP localport=3001'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to add firewall rule. You may need to run as Administrator."
  ${EndIf}

  ; Add firewall rule for the biometric TCP listener (ESP32 door locks)
  DetailPrint "Adding Windows Firewall rule for biometric integration..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt Biometric" dir=in action=allow protocol=TCP localport=8080'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to add biometric firewall rule. You may need to run as Administrator."
  ${EndIf}

SectionEnd

;--------------------------------
; Descriptions

; Language strings
LangString DESC_SecCore ${LANG_ENGLISH} "Core GMgmt application files and dependencies."
LangString DESC_SecService ${LANG_ENGLISH} "Install GMgmt as a Windows Service for automatic startup."
LangString DESC_SecFirewall ${LANG_ENGLISH} "Add Windows Firewall rule to allow GMgmt API access."

; Assign language strings to sections
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecCore} $(DESC_SecCore)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecService} $(DESC_SecService)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFirewall} $(DESC_SecFirewall)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

;--------------------------------
; Uninstaller Section

Section "Uninstall"

  ; Stop and remove Windows Service (before RMDir below removes node.exe
  ; and the uninstall script it needs to run)
  DetailPrint "Stopping GMgmt Windows Service..."
  nsExec::ExecToLog 'net stop GMgmt'
  nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\scripts\service-uninstall.js"'

  ; Remove firewall rules
  DetailPrint "Removing Windows Firewall rules..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GMgmt API"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GMgmt Biometric"'
  
  ; Remove files and directories
  RMDir /r "$INSTDIR"
  
  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}"
  DeleteRegKey HKLM "Software\${COMPANY}"
  
  ; Remove Start Menu entries
  !insertmacro MUI_STARTMENU_GETFOLDER "Application" $StartMenuFolder
  Delete "$SMPROGRAMS\$StartMenuFolder\GMgmt.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"
  
  ; Ask about preserving data
  MessageBox MB_YESNO "Do you want to preserve your GMgmt data?" IDYES PreserveData IDNO DeleteData

  PreserveData:
    MessageBox MB_OK "Your GMgmt data has been preserved."
    Goto EndUninstall

  DeleteData:
    RMDir /r "$%ProgramData%\gmgmt"
    MessageBox MB_OK "Your GMgmt data has been removed."
  
  EndUninstall:

SectionEnd

;--------------------------------
; Functions

Function .onInit

  ; This build only bundles the ${ARCH} Node.js runtime (decided at compile
  ; time, see Section "GMgmt Core"). Refuse to run the x64 build on a 32-bit
  ; OS, since a 64-bit node.exe can't execute there.
  !if "${ARCH}" == "x64"
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This is the 64-bit installer, but your Windows is 32-bit. Please download the x86 installer instead."
    Abort
  ${EndIf}
  !endif

  ; Check if already installed
  ReadRegStr $0 HKLM "Software\${COMPANY}" "Install_Dir"
  ${If} $0 != ""
    MessageBox MB_YESNO "GMgmt is already installed. Do you want to reinstall?" IDYES ContinueInstall IDNO AbortInstall
    ContinueInstall:
    Goto EndInit
    AbortInstall:
    Abort
  ${EndIf}
  
  EndInit:

FunctionEnd

Function .onInstSuccess

  ; Create Start Menu entries
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
  
  CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\GMgmt.lnk" "http://localhost:3001" "" "http://localhost:3001" 0
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\Uninstall.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  
  !insertmacro MUI_STARTMENU_WRITE_END

FunctionEnd

; Callback for the finish page's "Install as Windows Service" checkbox (see
; MUI_FINISHPAGE_RUN_FUNCTION above). Runs the bundled node.exe - SecCore's
; `File "vendor\node-win-${ARCH}\node.exe"` (no /r, no /oname) flattens to
; just the basename under $INSTDIR per NSIS's File instruction semantics, so
; the installed runtime is $INSTDIR\node.exe, not the source-tree subpath -
; against service-install.js, so the service doesn't depend on a
; system-wide Node.js install.
Function RunServiceInstall
  Exec '"$INSTDIR\node.exe" "$INSTDIR\scripts\service-install.js"'
FunctionEnd
