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

; Default installation folder. makensis always emits a 32-bit installer
; stub, so $PROGRAMFILES resolves to "Program Files (x86)" even on 64-bit
; Windows - the x64 build must ask for the 64-bit folder explicitly (and
; use the 64-bit registry view, see SetRegView in .onInit / un.onInit).
!if "${ARCH}" == "x64"
InstallDir "$PROGRAMFILES64\gmgmt"
!else
InstallDir "$PROGRAMFILES\gmgmt"
!endif

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

  ; On a reinstall/upgrade the service may be running, holding write locks
  ; on node.exe and node_modules\**\*.node - extraction would then hit
  ; "Can't write" Abort/Retry/Ignore and ship a half-old half-new install.
  ; Stop it first (harmless "service name is invalid"/"not started" error
  ; when this is a fresh install). NET accepts the display name; the SCM
  ; key name node-windows registers is "gmgmt.exe".
  DetailPrint "Stopping GMgmt service if it is running..."
  nsExec::ExecToLog 'net stop GMgmt'
  Sleep 2000

  ; On a reinstall/upgrade, remove the previous install tree before
  ; extracting new files so files removed/renamed since the old build
  ; (stale scripts\*.js, old native .node binaries, etc.) don't survive
  ; alongside the new ones.
  RMDir /r "$INSTDIR"

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

  ; deploy-models.js copies these two directories (LITERT_WASM_SRC /
  ; MEDIAPIPE_WASM_SRC) into public/models/ at deploy time - full
  ; client/node_modules is a dev-only, multi-hundred-MB build dependency
  ; never otherwise shipped, so only these two wasm subfolders are bundled,
  ; at the exact relative path deploy-models.js already expects (no code
  ; change needed there). Confirmed missing on a real installed service:
  ; checkPrerequisites() reported "prerequisites not met" for exactly these
  ; two paths, the same class of bug as tools/ below.
  SetOutPath "$INSTDIR\client\node_modules\@litertjs\core\wasm"
  File /r "client\node_modules\@litertjs\core\wasm\*"

  SetOutPath "$INSTDIR\client\node_modules\@mediapipe\tasks-vision\wasm"
  File /r "client\node_modules\@mediapipe\tasks-vision\wasm\*"

  ; Only the three files src/app.js actually requires at boot to deploy face
  ; check-in model assets (tools/face-model/deploy-models.js's own header
  ; comment documents the require chain) - NOT the rest of tools/, which is
  ; multiple GB of gitignored maintainer-only build output (build/,
  ; spike/node_modules/) and a Python/TensorFlow conversion pipeline
  ; (convert.py, evaluate.py, requirements.txt) that never runs on a
  ; deployment target. Shipping all of tools/ was tried and produced a
  ; multi-GB installer; this app.js boot path was also completely broken
  ; without this - `require('../tools/face-model/predeploy-models')` threw
  ; MODULE_NOT_FOUND on every installed service, since tools/ wasn't bundled
  ; at all before this fix.
  SetOutPath "$INSTDIR\tools\face-model"
  File "tools\face-model\deploy-models.js"
  File "tools\face-model\predeploy-models.js"

  SetOutPath "$INSTDIR\tools\face-model\lib"
  File "tools\face-model\lib\fetchVerify.js"

  SetOutPath "$INSTDIR"
  File "package.json"
  File "package-lock.json"
  File "README.md"
  File "LICENSE.txt"
  ; serviceEnv.js seeds %ProgramData%\gmgmt\.env from env.sample when no
  ; .env exists yet - without shipping it, a service install from a copy
  ; where the "Windows Service" section was deselected has no seed source
  ; and the service crash-loops on a missing .env.
  File "env.sample"

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

  ; NOTE: $%ProgramData% would be expanded at COMPILE time from the build
  ; machine's environment (makensis warns "unknown variable/constant,
  ; ignoring" when it's unset - verified by compiling this script). With
  ; SetShellVarContext all (set in .onInit), $APPDATA resolves at RUN time
  ; to the machine-wide application data folder, i.e. C:\ProgramData -
  ; the same value scripts/lib/serviceEnv.js reads from process.env.ProgramData.

  ; Create the data root and lock it down before any secrets are written
  ; into it: C:\ProgramData's default DACL gives ordinary users read access
  ; (and CreateSubdirectory), which would expose .env secrets and the
  ; member/biometric database. Strip inheritance and grant only SYSTEM and
  ; Administrators (SID form avoids localized group names).
  ; scripts/lib/serviceEnv.js (run below via service-install.js, and also
  ; the enforcement point for the finish-page/manual `service:install`
  ; paths that don't go through this NSIS section at all) applies the same
  ; icacls lockdown before writing any secrets. This early call is
  ; defense-in-depth for the .env write immediately below, in case that
  ; ever changes to include real values.
  ;
  ; Two separate icacls calls, not one with /T - confirmed on real
  ; hardware that granting "SID:(OI)(CI)F" (container-inherit flags)
  ; directly to every object a /T walk touches breaks pre-existing leaf
  ; FILES (e.g. gmgmt.sqlite from an install predating this fix): Windows
  ; doesn't accept container-inherit flags on a non-container object, so
  ; the grant silently fails to attach and the file is left with an empty
  ; DACL that denies even SYSTEM. Set the inheritable grant on the
  ; directory itself first, then /reset /T so every descendant - old or
  ; new - re-inherits cleanly from it instead of being granted directly.
  CreateDirectory "$APPDATA\gmgmt"
  nsExec::ExecToLog 'icacls "$APPDATA\gmgmt" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to lock down $APPDATA\gmgmt permissions (icacls exit code $0). Secrets in this folder may be readable by other local users."
  ${EndIf}
  ; Reset $APPDATA\gmgmt\* (contents only), not $APPDATA\gmgmt itself - /reset
  ; on the folder itself would revert the explicit grant set above back to
  ; inheriting from $APPDATA's own (unsecured) default DACL, undoing the
  ; lockdown before it ever takes effect.
  nsExec::ExecToLog 'icacls "$APPDATA\gmgmt\*" /reset /T'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to finish locking down $APPDATA\gmgmt permissions (icacls exit code $0). Secrets in this folder may be readable by other local users."
  ${EndIf}
  CreateDirectory "$APPDATA\gmgmt\data"
  CreateDirectory "$APPDATA\gmgmt\logs"

  ; Seed a default .env only when none exists yet - matching serviceEnv.js's
  ; never-overwrite contract, so a reinstall/upgrade cannot clobber a gym's
  ; real configuration. JWT_SECRET, DEVICE_SHARED_SECRET and the initial
  ; admin credentials are deliberately NOT written here: a value hardcoded
  ; in this script would ship the same publicly-known secret to every
  ; install. service-install.js (run below) generates per-install random
  ; values for anything missing.
  IfFileExists "$APPDATA\gmgmt\.env" SkipEnvWrite
  FileOpen $0 "$APPDATA\gmgmt\.env" w
  FileWrite $0 "PORT=3001$\r$\n"
  FileWrite $0 "NODE_ENV=production$\r$\n"
  FileWrite $0 "EMAIL_USER=your_email@gmail.com$\r$\n"
  FileWrite $0 "EMAIL_PASS=your_app_password$\r$\n"
  FileWrite $0 "ENABLE_BIOMETRIC=true$\r$\n"
  FileWrite $0 "BIOMETRIC_PORT=8080$\r$\n"
  FileWrite $0 "BIOMETRIC_HOST=0.0.0.0$\r$\n"
  FileClose $0
  SkipEnvWrite:


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
    MessageBox MB_ICONEXCLAMATION "Failed to install Windows Service (exit code $0). See $INSTDIR\install-service.log for details." /SD IDOK
  ${EndIf}

SectionEnd

Section "Firewall Rule" SecFirewall

  ; Add firewall rule for the API/web port
  DetailPrint "Adding Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GMgmt API"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt API" dir=in action=allow protocol=TCP localport=3001'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to add firewall rule. You may need to run as Administrator." /SD IDOK
  ${EndIf}

  ; Add firewall rule for the biometric TCP listener (ESP32 door locks)
  DetailPrint "Adding Windows Firewall rule for biometric integration..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="GMgmt Biometric"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt Biometric" dir=in action=allow protocol=TCP localport=8080'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "Failed to add biometric firewall rule. You may need to run as Administrator." /SD IDOK
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

  ; Remove Start Menu entries. This must run BEFORE the DeleteRegKey below:
  ; MUI_STARTMENU_GETFOLDER reads the user's chosen folder name from
  ; HKLM Software\${COMPANY} - deleting that key first would make it fall
  ; back to the default folder name and orphan a custom-named folder.
  !insertmacro MUI_STARTMENU_GETFOLDER "Application" $StartMenuFolder
  Delete "$SMPROGRAMS\$StartMenuFolder\GMgmt.url"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"

  ; Remove registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${COMPANY}"
  DeleteRegKey HKLM "Software\${COMPANY}"

  ; Ask about preserving data (silent uninstall preserves it - /SD IDYES)
  MessageBox MB_YESNO "Do you want to preserve your GMgmt data?" /SD IDYES IDYES PreserveData IDNO DeleteData

  PreserveData:
    MessageBox MB_OK "Your GMgmt data has been preserved." /SD IDOK
    Goto EndUninstall

  DeleteData:
    RMDir /r "$APPDATA\gmgmt"
    MessageBox MB_OK "Your GMgmt data has been removed." /SD IDOK

  EndUninstall:

SectionEnd

;--------------------------------
; Functions

Function .onInit

  ; Machine-wide install: shell folders ($SMPROGRAMS for shortcuts, $APPDATA
  ; for the ProgramData-equivalent data root) must resolve to the all-users
  ; locations, not the (possibly different) elevating admin's profile.
  SetShellVarContext all

  ; This build only bundles the ${ARCH} Node.js runtime (decided at compile
  ; time, see Section "GMgmt Core"). Refuse to run the x64 build on a 32-bit
  ; OS, since a 64-bit node.exe can't execute there.
  !if "${ARCH}" == "x64"
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This is the 64-bit installer, but your Windows is 32-bit. Please download the x86 installer instead." /SD IDOK
    Abort
  ${EndIf}
  ; The installer stub itself is 32-bit; without this every HKLM write lands
  ; in the WOW6432Node view. InstallDirRegKey was already evaluated in the
  ; 32-bit view before .onInit ran, so re-read Install_Dir from the 64-bit
  ; view below.
  SetRegView 64
  ReadRegStr $0 HKLM "Software\${COMPANY}" "Install_Dir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  !endif

  ; Check if already installed (silent reinstall proceeds - /SD IDYES)
  ReadRegStr $0 HKLM "Software\${COMPANY}" "Install_Dir"
  ${If} $0 != ""
    MessageBox MB_YESNO "GMgmt is already installed. Do you want to reinstall?" /SD IDYES IDYES ContinueInstall IDNO AbortInstall
    ContinueInstall:
    Goto EndInit
    AbortInstall:
    Abort
  ${EndIf}

  EndInit:

FunctionEnd

Function un.onInit

  ; Mirror .onInit: all-users shell folders and (for x64) the 64-bit
  ; registry view, so the uninstaller sees the same paths/keys the
  ; installer wrote.
  SetShellVarContext all
  !if "${ARCH}" == "x64"
  SetRegView 64
  !endif

FunctionEnd

Function .onInstSuccess

  ; Create Start Menu entries
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
  
  CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
  ; CreateShortCut builds .lnk files whose target must be a filesystem path;
  ; an http:// target is unreliable across Windows versions. An Internet
  ; Shortcut (.url) is the proper artifact for opening a URL.
  WriteINIStr "$SMPROGRAMS\$StartMenuFolder\GMgmt.url" "InternetShortcut" "URL" "http://localhost:3001"
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
