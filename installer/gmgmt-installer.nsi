; GMgmt Windows Installer Script (NSIS)
; This script creates a Windows installer for GMgmt Gym Management Software

;--------------------------------
; Include Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"

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
Var Architecture

;--------------------------------
; Interface Settings

!define MUI_ABORTWARNING
!define MUI_ICON "public\uploads\logo.png"
!define MUI_UNICON "public\uploads\logo.png"

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
!define MUI_FINISHPAGE_RUN "$INSTDIR\scripts\service-install.js"
!define MUI_FINISHPAGE_RUN_TEXT "Install as Windows Service"
!define MUI_FINISHPAGE_RUN_PARAMETERS ""
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
  
  ; Set output path to the installation directory
  SetOutPath "$INSTDIR"
  
  ; Copy application files
  File /r "src\*"
  File /r "node_modules\*"
  File /r "public\*"
  File /r "scripts\*"
  File /r "client\build\*"
  File "package.json"
  File "package-lock.json"
  File "README.md"
  File "LICENSE.txt"
  
  ; Copy Node.js runtime based on architecture
  ${If} $Architecture == "x64"
    File "vendor\node-win-x64\node.exe"
    Rename "$INSTDIR\node.exe" "$INSTDIR\vendor\node-win-x64\node.exe"
  ${Else}
    File "vendor\node-win-ia32\node.exe"
    Rename "$INSTDIR\node.exe" "$INSTDIR\vendor\node-win-ia32\node.exe"
  ${EndIf}
  
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
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}" "DisplayIcon" "$INSTDIR\public\uploads\logo.png"
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
  
  ; Install Windows Service
  DetailPrint "Installing GMgmt Windows Service..."
  nsExec::ExecToLog 'node "$INSTDIR\scripts\service-install.js"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to install Windows Service. You may need to run as Administrator."
  ${EndIf}

SectionEnd

Section "Firewall Rule" SecFirewall

  ; Add firewall rule
  DetailPrint "Adding Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt API" dir=in action=allow protocol=TCP localport=3001'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to add firewall rule. You may need to run as Administrator."
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

  ; Stop and remove Windows Service
  DetailPrint "Stopping GMgmt Windows Service..."
  nsExec::ExecToLog 'net stop GMgmt'
  nsExec::ExecToLog 'node "$INSTDIR\scripts\service-uninstall.js"'
  
  ; Remove firewall rule
  DetailPrint "Removing Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GMgmt API"'
  
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
  MessageBox MB_YESNO "Do you want to preserve GMgmt data in %ProgramData%\gmgmt?" IDYES PreserveData IDNO DeleteData
  
  PreserveData:
    MessageBox MB_OK "GMgmt data preserved in %ProgramData%\gmgmt"
    Goto EndUninstall
  
  DeleteData:
    RMDir /r "$%ProgramData%\gmgmt"
    MessageBox MB_OK "GMgmt data removed from %ProgramData%\gmgmt"
  
  EndUninstall:

SectionEnd

;--------------------------------
; Functions

Function .onInit
  
  ; Detect system architecture
  ${If} ${RunningX64}
    StrCpy $Architecture "x64"
  ${Else}
    StrCpy $Architecture "x86"
  ${EndIf}
  
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
