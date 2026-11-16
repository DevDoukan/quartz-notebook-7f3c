using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class EnrollmentGuiTests
{
    private static int assertions;
    private static void Check(bool condition, string label) { assertions++; if (!condition) throw new Exception(label); }
    private static void Rejected(Action action)
    {
        bool rejected = false;
        try { action(); } catch (InvalidDataException e) { rejected = true; Check(!e.Message.Contains(new string('a', 64)), "Secret in error"); }
        Check(rejected, "Unsafe request accepted");
    }
    private static string Json(Dictionary<string, object> data) { return new JavaScriptSerializer().Serialize(data); }
    private static Dictionary<string, object> Request() { return new Dictionary<string, object> { { "origin", "https://central.example:9443" }, { "token", new string('a', 64) } }; }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--preview")
        {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new EnrollmentForm(null, true)); return 0;
        }
        string root = Path.Combine(Path.GetTempPath(), "kalkan-gui-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var input = Request(); input.Add("name", "Şirket İŞ-PC");
            EnrollmentRequest model = EnrollmentRequest.Parse(Json(input), "DEFAULT-PC");
            Check(model.Origin == "https://central.example:9443" && model.Name == "Şirket İŞ-PC", "Valid request changed");
            Check(EnrollmentRequest.Parse(Json(Request()), "DEFAULT-PC").Name == "DEFAULT-PC", "Default device name lost");
            var roundtrip = EnrollmentRequest.Parse(model.Encode(), "OTHER"); Check(roundtrip.Name == model.Name && roundtrip.Origin == model.Origin, "Serialization changed identity");
            foreach (string origin in new[] { "http://central.example", "https://user:pass@central.example", "https://central.example/path", "https://central.example/?q=x", "https://central.example/#x" })
            { var bad = Request(); bad["origin"] = origin; Rejected(() => EnrollmentRequest.Parse(Json(bad), "PC")); }
            foreach (object token in new object[] { null, 12, new string('A', 64), new string('a', 64) + "\n", "short" })
            { var bad = Request(); bad["token"] = token; Rejected(() => EnrollmentRequest.Parse(Json(bad), "PC")); }
            foreach (object name in new object[] { null, 12, "", "   ", new string('x', 121), "bad\nname" })
            { var bad = Request(); bad["name"] = name; Rejected(() => EnrollmentRequest.Parse(Json(bad), "PC")); }
            foreach (string key in new[] { "password", "caFile", "credential", "Token" })
            { var bad = Request(); bad.Add(key, "forbidden"); Rejected(() => EnrollmentRequest.Parse(Json(bad), "PC")); }
            foreach (string bad in new[] { "[]", "null", "12", "{\"token\":\"" + new string('a', 64) + "\"," }) Rejected(() => EnrollmentRequest.Parse(bad, "PC"));
            string cert = File.ReadAllText(args[0]);
            input = Request(); input["caPem"] = cert;
            model = EnrollmentRequest.Parse(Json(input), "PC"); Check(model.CertificateCount == 1, "Public certificate rejected");
            using (var publicCertificate = new X509Certificate2(Encoding.ASCII.GetBytes(cert)))
            {
                var disguised = Request(); disguised["caPem"] = "-----BEGIN CERTIFICATE-----\n" + Convert.ToBase64String(publicCertificate.Export(X509ContentType.Pkcs12)) + "\n-----END CERTIFICATE-----";
                Rejected(() => EnrollmentRequest.Parse(Json(disguised), "PC"));
            }
            foreach (string ca in new[] { "-----BEGIN PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----", new string('x', 65537) })
            { var bad = Request(); bad["caPem"] = ca; Rejected(() => EnrollmentRequest.Parse(Json(bad), "PC")); }
            string source = Path.Combine(root, "request.json");
            File.WriteAllText(source, Json(Request()), new UTF8Encoding(true));
            Check(EnrollmentRequest.ReadFile(source, "PC").Origin == "https://central.example:9443", "BOM local import failed");
            string linked = Path.Combine(root, "linked.json"); Check(CreateHardLinkW(linked, source, IntPtr.Zero), "Cannot create hard-link fixture");
            Rejected(() => EnrollmentRequest.ReadFile(source, "PC")); Rejected(() => EnrollmentRequest.ReadFile(linked, "PC"));
            File.Delete(linked);
            File.WriteAllBytes(source, new byte[] { 0xc3, 0x28 }); Rejected(() => EnrollmentRequest.ReadFile(source, "PC"));
            File.WriteAllBytes(source, new byte[131073]); Rejected(() => EnrollmentRequest.ReadFile(source, "PC"));
            Rejected(() => EnrollmentRequest.ReadFile(source + ":stream", "PC")); Rejected(() => EnrollmentRequest.ReadFile(@"\\127.0.0.1\share\request.json", "PC")); Rejected(() => EnrollmentRequest.ReadFile(root, "PC"));
            string saved = Environment.GetEnvironmentVariable("NODE_OPTIONS");
            try
            {
                Environment.SetEnvironmentVariable("NODE_OPTIONS", "--untrusted-test");
                var command = EnrollmentHost.Command(@"C:\Program Files\KalkanDLP\versions\TEST", @"C:\ProgramData\KalkanDLP\enrollment-request-test.json", false);
                Check(command.Arguments.Contains("-NonInteractive") && command.Arguments.Contains("-EnrollmentFile") && !command.Arguments.Contains(new string('a', 64)), "Unsafe backend arguments");
                Check(command.EnvironmentVariables["NODE_OPTIONS"] == null && command.EnvironmentVariables["PSModulePath"] == Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\Modules"), "Inherited module injection");
                Check(EnrollmentHost.Command(@"C:\Program Files\KalkanDLP\versions\TEST", null, true).Arguments.EndsWith(" -Resume"), "Resume command mismatch");
            }
            finally { Environment.SetEnvironmentVariable("NODE_OPTIONS", saved); }
            Rejected(() => EnrollmentHost.Command("C:\\bad\"root", source, false));
            string manifest = Manifest(args[1]); Check(manifest.Contains("level=\"requireAdministrator\"") && manifest.Contains("uiAccess=\"false\""), "Production elevation manifest missing");
            Console.WriteLine("PASS native enrollment GUI validation, captured-file import, hard-link/UTF-8 rejection, sanitized backend arguments and embedded elevation manifest (" + assertions + " assertions)");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine("FAIL native enrollment GUI self-test after " + assertions + " assertions (" + error.GetType().Name + ")"); return 1; }
        finally { Directory.Delete(root, true); }
    }

    private static string Manifest(string path)
    {
        IntPtr module = LoadLibraryExW(path, IntPtr.Zero, 0x22);
        if (module == IntPtr.Zero) throw new Exception("Cannot read manifest");
        try
        {
            IntPtr resource = FindResourceW(module, new IntPtr(1), new IntPtr(24)); uint size = SizeofResource(module, resource);
            if (resource == IntPtr.Zero || size == 0 || size > 65536) throw new Exception("Invalid manifest");
            IntPtr address = LockResource(LoadResource(module, resource)); if (address == IntPtr.Zero) throw new Exception("No manifest bytes");
            byte[] bytes = new byte[size]; Marshal.Copy(address, bytes, 0, bytes.Length); return Encoding.UTF8.GetString(bytes);
        }
        finally { FreeLibrary(module); }
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateHardLinkW(string name, string existing, IntPtr security);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadLibraryExW(string path, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindResourceW(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll")] private static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FreeLibrary(IntPtr module);
}
