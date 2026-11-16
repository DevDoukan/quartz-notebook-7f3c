#ifndef StageDir
 #error StageDir is required
#endif
#ifndef ProductVersion
 #error ProductVersion is required
#endif
#ifndef OutputDir
 #define OutputDir "..\release"
#endif
#ifndef Publisher
 #define Publisher "MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN"
#endif
[Setup]
AppId={{E5169684-BB41-40DA-9CE9-124FAD079B17}
AppName=Kalkan DLP Server
AppVersion={#ProductVersion}
AppPublisher={#Publisher}
AppSupportURL=mailto:destek@dkavis.com.tr
DefaultDirName={autopf}\KalkanDLPCentral
DisableDirPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
#ifdef SignRelease
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Server-Setup-signed
#else
OutputBaseFilename=Kalkan-DLP-{#ProductVersion}-Server-Setup-unsigned
#endif
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
SetupMutex=KalkanDlpCentralSetup
#ifdef SignRelease
SignTool=MTBSign
SignedUninstaller=yes
#endif
UninstallDisplayName=Kalkan DLP Server
InfoAfterFile={#StageDir}\KURULUM-README.md
[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Files]
Source: "{#StageDir}\*"; DestDir: "{app}\versions\{#ProductVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{commonprograms}\Kalkan DLP Server\Kurulum kilavuzu"; Filename: "{app}\versions\{#ProductVersion}\KURULUM-README.md"
[Registry]
Root: HKLM; Subkey: "Software\KalkanDLPCentral"; ValueType: string; ValueName: "CurrentPath"; ValueData: "{app}\versions\{#ProductVersion}"; Flags: uninsdeletevalue; Check: FirstRegistration
[Code]
var ServerPreparationFailed: Boolean;
function FirstRegistration(): Boolean;
var Current: String;
begin
 Result := not RegQueryStringValue(HKLM, 'Software\KalkanDLPCentral', 'CurrentPath', Current);
end;
function GetCustomSetupExitCode(): Integer;
begin
 if ServerPreparationFailed then Result := 1 else Result := 0;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer; Current: String;
begin
 Result := '';
 { Different version folders can be staged while the old service runs.
   Install validates the new package/TLS first, then switches the service and
   retains its original running state for rollback. Stop early only on repair
   of the same version, where files may otherwise still be in use. }
 if RegQueryStringValue(HKLM, 'Software\KalkanDLPCentral', 'CurrentPath', Current) then
  if (CompareText(Current, ExpandConstant('{app}\versions\{#ProductVersion}')) = 0) and FileExists(Current + '\scripts\Manage-CentralService.ps1') then
   if not ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Current + '\scripts\Manage-CentralService.ps1" -Action Stop', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    Result := 'Merkez hizmeti durdurulamadi. Kurulum iptal edildi.';
end;
procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer;
begin
 if CurStep = ssPostInstall then
 begin
  ServerPreparationFailed := True;
  if not DirExists(ExpandConstant('{commonappdata}\KalkanDLPCentral')) then
   if not ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{app}\versions\{#ProductVersion}\scripts\Manage-CentralService.ps1" -Action Initialize'), '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    RaiseException('Korunan sunucu veri klasoru hazirlanamadi. Kurulum kilavuzunu kontrol edin.');
  if FileExists(ExpandConstant('{commonappdata}\KalkanDLPCentral\server-config.json')) then
   if not ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{app}\versions\{#ProductVersion}\scripts\Manage-CentralService.ps1" -Action Install -AppRoot "{app}\versions\{#ProductVersion}"'), '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    RaiseException('Server hizmeti yeni surumle baslatilamadi. Korunan hizmet gunluklerini kontrol edin.');
  if not RegWriteStringValue(HKLM, 'Software\KalkanDLPCentral', 'CurrentPath', ExpandConstant('{app}\versions\{#ProductVersion}')) then
   RaiseException('Server surum kaydi guncellenemedi. Windows kayit defteri izinlerini kontrol edin.');
  ServerPreparationFailed := False;
 end;
end;
function InitializeUninstall(): Boolean;
var Code: Integer; Current: String;
begin
 Result := ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), ExpandConstant('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{app}\versions\{#ProductVersion}\scripts\Manage-CentralService.ps1" -Action Remove'), '', SW_HIDE, ewWaitUntilTerminated, Code);
 if Result then Result := Code = 0;
 if Result and RegQueryStringValue(HKLM, 'Software\KalkanDLPCentral', 'CurrentPath', Current) then
  if CompareText(Current, ExpandConstant('{app}\versions\{#ProductVersion}')) = 0 then
   RegDeleteValue(HKLM, 'Software\KalkanDLPCentral', 'CurrentPath');
 if not Result then MsgBox('Merkez hizmeti kaldirilamadi. Program dosyalari korunuyor.', mbError, MB_OK);
end;
