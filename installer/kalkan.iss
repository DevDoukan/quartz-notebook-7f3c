#ifndef StageDir
  #error StageDir must be provided
#endif
#ifndef ProductVersion
  #define ProductVersion "1.1.0-rc.1"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif
#ifndef Publisher
  #define Publisher "MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN"
#endif
#ifndef SupportEmail
  #define SupportEmail "destek@dkavis.com.tr"
#endif

[Setup]
#ifdef MachineInstall
AppId={{0EF061A5-309F-4A4E-AB66-56FF87BCA348}
#else
AppId={{99C4C3DE-090B-4DB5-9B6F-0AFD1B0C64A1}
#endif
AppName=Kalkan DLP
AppVersion={#ProductVersion}
AppVerName=Kalkan DLP {#ProductVersion} (Sürüm adayı)
AppPublisher={#Publisher}
AppSupportURL=mailto:{#SupportEmail}
#ifdef MachineInstall
DefaultDirName={autopf}\KalkanDLP
PrivilegesRequired=admin
SetupLogging=yes
DisableDirPage=yes
#ifdef SignRelease
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Agent-Setup-signed
#else
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Agent-Setup-unsigned
#endif
#else
DefaultDirName={localappdata}\Programs\KalkanDLP
PrivilegesRequired=lowest
#ifdef SignRelease
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Setup-signed
#else
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Setup-unsigned
#endif
#endif
DefaultGroupName=Kalkan DLP
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
SetupMutex=KalkanDlpSetup
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=Kalkan DLP
UninstallDisplayIcon={app}\versions\{#ProductVersion}\runtime\node.exe
DisableProgramGroupPage=yes
#ifdef SignRelease
SignTool=MTBSign
SignedUninstaller=yes
#endif

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; Flags: unchecked
#ifndef MachineInstall
Name: "startup"; Description: "Windows oturumu açıldığında arka planda başlat"; Flags: unchecked
#endif

[Files]
#ifdef MachineInstall
Source: "{#StageDir}\scripts\Manage-Service.ps1"; DestName: "Kalkan-Agent-Repair.ps1"; Flags: dontcopy
#endif
Source: "{#StageDir}\*"; DestDir: "{app}\versions\{#ProductVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
#ifdef MachineInstall
Name: "{group}\Kalkan DLP Client kayıt yardımcısı"; Filename: "{app}\versions\{#ProductVersion}\agent\KalkanDlpEnrollment.exe"; WorkingDir: "{app}\versions\{#ProductVersion}"
#endif
Name: "{group}\Kalkan DLP"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Start.ps1"""; WorkingDir: "{app}\versions\{#ProductVersion}"
Name: "{group}\Kalkan DLP'yi kaldır"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Kalkan DLP"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Start.ps1"""; Tasks: desktopicon
#ifndef MachineInstall
Name: "{userstartup}\Kalkan DLP"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Start.ps1"" -NoBrowser"; Tasks: startup
#endif

[Registry]
#ifndef MachineInstall
Root: HKCU; Subkey: "Software\KalkanDLP"; ValueType: string; ValueName: "CurrentPath"; ValueData: "{app}\versions\{#ProductVersion}"; Flags: uninsdeletevalue
#endif

[Run]
#ifdef MachineInstall
Filename: "{app}\versions\{#ProductVersion}\agent\KalkanDlpEnrollment.exe"; Description: "Client'ı şirket merkezine kaydet"; Flags: postinstall skipifsilent nowait runascurrentuser; Check: NeedsEnrollment
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Start.ps1"""; Description: "Yerel Client panelini aç"; Flags: postinstall skipifsilent unchecked nowait; Check: ClientServiceReady
#else
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Start.ps1"""; Description: "Kalkan DLP'yi aç"; Flags: postinstall skipifsilent nowait
#endif

[UninstallRun]
#ifdef MachineInstall
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Manage-Service.ps1"" -Action Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveKalkanAgent"
#else
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\versions\{#ProductVersion}\scripts\Stop.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopKalkan"
#endif

[Code]
#ifdef MachineInstall
var ClientServiceInstalled: Boolean;
function ClientServiceReady(): Boolean;
begin
  Result := ClientServiceInstalled;
end;
function NeedsEnrollment(): Boolean;
begin
  Result := ClientServiceReady() and not FileExists(ExpandConstant('{commonappdata}\KalkanDLP\central-connection.json'));
end;
#endif
#ifndef MachineInstall
function PrepareToInstall(var NeedsRestart: Boolean): String;
var CurrentPath: String; ResultCode: Integer;
begin
  Result := '';
  if RegQueryStringValue(HKCU, 'Software\KalkanDLP', 'CurrentPath', CurrentPath) then
    if FileExists(CurrentPath + '\scripts\Stop.ps1') then
      if not ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + CurrentPath + '\scripts\Stop.ps1"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
        Result := 'Çalışan Kalkan DLP durdurulamadı. Uygulamayı kapatıp kurulumu tekrar deneyin.';
end;

#endif

#ifdef MachineInstall
var ServiceInstallFailed, AgentStoppedForRepair: Boolean;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer; Current, Target: String;
begin
  Result := '';
  Target := ExpandConstant('{app}\versions\{#ProductVersion}');
  if RegQueryStringValue(HKLM, 'Software\KalkanDLP', 'CurrentPath', Current) and
     (CompareText(Current, Target) = 0) then
  begin
    { The installed script may predate the repair actions. Extract the new
      script before copying files that the running agent holds open. }
    if not FileExists(ExpandConstant('{tmp}\Kalkan-Agent-Repair.ps1')) then
      ExtractTemporaryFile('Kalkan-Agent-Repair.ps1');
    if not ExecAndLogOutputWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{tmp}\Kalkan-Agent-Repair.ps1" -Action StopForRepair -AppRoot "{app}\versions\{#ProductVersion}"'), '', SW_HIDE, ewWaitUntilTerminated, Code, nil) or
       ((Code <> 0) and (Code <> 3)) then
      Result := 'Windows ajani onarim icin durdurulamadi.'
    else if Code = 0 then
      AgentStoppedForRepair := True;
  end;
end;
procedure DeinitializeSetup();
var Code: Integer;
begin
  if AgentStoppedForRepair and not ClientServiceInstalled then
    if not ExecAndLogOutputWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{tmp}\Kalkan-Agent-Repair.ps1" -Action ResumeAfterRepair -AppRoot "{app}\versions\{#ProductVersion}"'), '', SW_HIDE, ewWaitUntilTerminated, Code, nil) or (Code <> 0) then
      Log('Windows ajani onarim iptalinden sonra yeniden baslatilamadi.');
end;
function GetCustomSetupExitCode(): Integer;
begin
  if ServiceInstallFailed then Result := 1 else Result := 0;
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer; Started: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    ServiceInstallFailed := True;
    Started := ExecAndLogOutputWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{app}\versions\{#ProductVersion}\scripts\Manage-Service.ps1" -Action Install -AppRoot "{app}\versions\{#ProductVersion}"'), '', SW_HIDE, ewWaitUntilTerminated, Code, nil);
    if not Started or (Code <> 0) then
      RaiseException('Windows ajanı kurulamadı. Ayrıntılar kurulum günlüğünde: ' + ExpandConstant('{log}'));
    ClientServiceInstalled := True;
    ServiceInstallFailed := False;
  end;
end;
#endif
