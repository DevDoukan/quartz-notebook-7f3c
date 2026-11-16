using System;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32;

internal sealed class EnrollmentHost
{
    internal string Root { get; private set; }
    internal string Common { get; private set; }
    internal bool HasIdentity { get { return File.Exists(Path.Combine(Common, "central-connection.json")); } }
    internal bool HasPending { get { return File.Exists(Path.Combine(Common, "central-connection.json.pending.json")); } }
    private const string SystemSid = "S-1-5-18", AdminSid = "S-1-5-32-544";
    private const string InstallerSid = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    private static readonly FileSystemRights Writes = FileSystemRights.Write | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
    private EnrollmentHost() { }

    internal static EnrollmentHost OpenInstalled()
    {
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("Windows yönetici yetkisi gerekir.");
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..")).TrimEnd('\\');
        string programRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "KalkanDLP");
        string current;
        using (RegistryKey machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
        using (RegistryKey product = machine.OpenSubKey(@"Software\KalkanDLP"))
            current = product == null ? null : product.GetValue("CurrentPath") as string;
        if (current == null || !root.StartsWith(programRoot + @"\versions\", StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(Path.GetFullPath(current).TrimEnd('\\'), root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Yardımcıyı kurulu Client'ın güncel Başlat menüsü kısayolundan açın.");
        var host = new EnrollmentHost { Root = root, Common = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KalkanDLP") };
        host.ValidateLayout(); return host;
    }

    private static bool Trusted(string sid, bool code) { return sid == SystemSid || sid == AdminSid || (code && sid == InstallerSid); }
    private static void CheckAccess(string path, bool code, bool secret)
    {
        FileAttributes attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Korunan yolda bağlantı noktası kabul edilmez.");
        FileSystemSecurity acl = (attributes & FileAttributes.Directory) != 0 ? (FileSystemSecurity)Directory.GetAccessControl(path) : File.GetAccessControl(path);
        if (!Trusted(((SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier))).Value, code)) throw new InvalidOperationException("Korunan yolun sahibi doğrulanamadı.");
        string serviceSid = secret ? ((SecurityIdentifier)new NTAccount("NT SERVICE", "KalkanDlpAgent").Translate(typeof(SecurityIdentifier))).Value : null;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow || (rule.PropagationFlags & PropagationFlags.InheritOnly) != 0) continue;
            string sid = ((SecurityIdentifier)rule.IdentityReference).Value;
            if ((rule.FileSystemRights & Writes) != 0 && !Trusted(sid, code)) throw new InvalidOperationException("Korunan yolda beklenmeyen yazma yetkisi var.");
            if (secret && (rule.FileSystemRights & (FileSystemRights.ReadData | FileSystemRights.ReadExtendedAttributes)) != 0 &&
                !Trusted(sid, false) && sid != serviceSid) throw new InvalidOperationException("Kayıt klasöründe beklenmeyen okuma yetkisi var.");
        }
    }

    private static void CheckAncestors(string path)
    {
        var directory = new DirectoryInfo(path);
        while (directory != null)
        {
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Korunan yolun üst klasörü bağlantı noktası olamaz.");
            FileSystemRights destructive = FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
            foreach (FileSystemAccessRule rule in directory.GetAccessControl().GetAccessRules(true, true, typeof(SecurityIdentifier)))
                if (rule.AccessControlType == AccessControlType.Allow && (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0 &&
                    (rule.FileSystemRights & destructive) != 0 && !Trusted(((SecurityIdentifier)rule.IdentityReference).Value, true))
                    throw new InvalidOperationException("Üst klasörün korunan yolu değiştirme yetkileri doğrulanamadı.");
            directory = directory.Parent;
        }
    }

    private void ValidateLayout()
    {
        CheckAncestors(Root); CheckAncestors(Common);
        CheckAccess(Root, true, false); CheckAccess(Common, false, true);
        foreach (string relative in new[] { @"scripts\Register-Agent.ps1", @"scripts\EnrollmentRequest.ps1" }) CheckAccess(Path.Combine(Root, relative), true, false);
    }

    internal static ProcessStartInfo Command(string root, string requestFile, bool resume)
    {
        if (String.IsNullOrEmpty(root)) throw new InvalidDataException("Geçersiz araç yolu.");
        foreach (string path in new[] { root, requestFile ?? "" }) if (path.IndexOfAny(new[] { '"', '\r', '\n' }) >= 0) throw new InvalidDataException("Geçersiz araç yolu.");
        string script = Path.Combine(root, @"scripts\Register-Agent.ps1");
        string psHome = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0");
        var start = new ProcessStartInfo(Path.Combine(psHome, "powershell.exe")) {
            Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" +
                (resume ? " -Resume" : " -EnrollmentFile \"" + requestFile + "\""),
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (string key in new System.Collections.ArrayList(start.EnvironmentVariables.Keys))
            if (key.StartsWith("NODE_", StringComparison.OrdinalIgnoreCase)) start.EnvironmentVariables.Remove(key);
        // Never autoload an elevated module from a user's profile/module path.
        start.EnvironmentVariables["PSModulePath"] = Path.Combine(psHome, "Modules");
        return start;
    }

    internal Task<EnrollmentResult> Register(EnrollmentRequest request, bool resume)
    {
        return Task.Run(() => {
            LastCleanupFailed = false;
            ValidateLayout();
            if (HasIdentity || (!resume && HasPending) || (resume && !HasPending)) throw new InvalidOperationException("Makine kayıt durumu değişti; yeniden kontrol edin.");
            string privateFile = null; bool created = false, cleaned = true;
            try
            {
                if (!resume)
                {
                    byte[] bytes = new UTF8Encoding(false, true).GetBytes(request.Encode());
                    privateFile = Path.Combine(Common, "enrollment-request-" + Guid.NewGuid().ToString("N") + ".json");
                    var acl = new FileSecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(new SecurityIdentifier(AdminSid));
                    foreach (string sid in new[] { SystemSid, AdminSid }) acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.FullControl, AccessControlType.Allow));
                    try
                    {
                        using (var file = new FileStream(privateFile, FileMode.CreateNew, FileSystemRights.WriteData, FileShare.None, 4096, FileOptions.WriteThrough, acl))
                        { created = true; file.Write(bytes, 0, bytes.Length); file.Flush(true); }
                    }
                    finally { Array.Clear(bytes, 0, bytes.Length); }
                }
                int code;
                using (var process = new Process { StartInfo = Command(Root, privateFile, resume) })
                {
                    if (!process.Start()) throw new InvalidOperationException("Kayıt aracı başlatılamadı.");
                    Task<string> output = process.StandardOutput.ReadToEndAsync(), error = process.StandardError.ReadToEndAsync();
                    process.WaitForExit(); Task.WaitAll(output, error); code = process.ExitCode;
                    // Raw backend diagnostics never enter the UI or a GUI log.
                }
                return new EnrollmentResult { ExitCode = code };
            }
            finally
            {
                if (created) { try { File.Delete(privateFile); } catch { cleaned = false; } }
                LastCleanupFailed = !cleaned;
            }
        });
    }
    internal bool LastCleanupFailed { get; private set; }
}
internal sealed class EnrollmentResult { internal int ExitCode; }
