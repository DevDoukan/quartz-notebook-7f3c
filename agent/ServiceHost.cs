using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

internal static class HostProfile
{
#if CENTRAL_HOST
    public static readonly bool Central = true;
#else
    public static readonly bool Central = false;
#endif
    public static string Product { get { return Central ? "KalkanDLPCentral" : "KalkanDLP"; } }
    public static string Service { get { return Central ? "KalkanDlpCentral" : "KalkanDlpAgent"; } }
    public static string Entry { get { return Central ? "central-server.js" : "server.js"; } }
    public static string Config { get { return Central ? "central-service.json" : "agent-config.json"; } }
    public static string Prefix { get { return Central ? "central-service" : "agent"; } }
}

internal sealed class AgentConfig
{
    public string AppRoot { get; set; }
    public string DataDir { get; set; }
    public int Port { get; set; }
    public int MemoryLimitMb { get; set; }
    public string ServerConfigFile { get; set; }
}

internal sealed class ProcessJob : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters
    {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr handle;
    public ProcessJob(int memoryMb)
    {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        ExtendedLimits limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000 | 0x200 | 0x8; // Kill on close, aggregate memory, process count.
        limits.Basic.ActiveProcessLimit = 24;
        limits.JobMemory = new UIntPtr((ulong)memoryMb * 1024 * 1024);
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))))
        { int error = Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error); }
    }
    public void Add(Process process)
    {
        if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public void AddHandle(IntPtr process) { if (!AssignProcessToJobObject(handle, process)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}

internal sealed class AgentRuntime : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public int size; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
    [StructLayout(LayoutKind.Sequential)] struct StartupInfo
    {
        public int size; public IntPtr reserved, desktop, title;
        public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
        public ushort show, reservedBytes; public IntPtr reservedData, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    readonly string configPath;
    readonly bool console;
    readonly object sync = new object();
    readonly ManualResetEvent stop = new ManualResetEvent(false);
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly Queue<DateTime> starts = new Queue<DateTime>();
    AgentConfig config;
    Process child;
    ProcessJob job;
    Thread monitor;
    int generation;
    bool disposed;
    volatile bool failed;

    public AgentRuntime(string path, bool consoleMode) { configPath = path; console = consoleMode; }
    static string Absolute(string path)
    {
        if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || path.StartsWith(@"\\") || path.Contains("\"")) throw new Exception("A local absolute path is required.");
        return Path.GetFullPath(path).TrimEnd('\\');
    }
    static void RejectReparseAncestors(string path)
    {
        DirectoryInfo current = new DirectoryInfo(path);
        while (current != null)
        {
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Agent paths cannot contain reparse points.");
            current = current.Parent;
        }
    }
    void Load()
    {
        string file = Absolute(configPath);
        if (new FileInfo(file).Length > 16384) throw new Exception("Agent configuration is too large.");
        config = json.Deserialize<AgentConfig>(File.ReadAllText(file, Encoding.UTF8));
        config.AppRoot = Absolute(config.AppRoot); config.DataDir = Absolute(config.DataDir);
        if (config.Port == 0) config.Port = HostProfile.Central ? 4417 : 4317;
        if (config.Port < (HostProfile.Central ? 1 : 1024) || config.Port > 65535) throw new Exception("Invalid service port.");
        if (config.MemoryLimitMb == 0) config.MemoryLimitMb = 1024;
        if (config.MemoryLimitMb < 512 || config.MemoryLimitMb > 4096) throw new Exception("Invalid job memory limit.");
        if (!File.Exists(Path.Combine(config.AppRoot, @"runtime\node.exe")) || (!HostProfile.Central && !File.Exists(Path.Combine(config.AppRoot, @"agent\KalkanFileBroker.exe"))) || !File.Exists(Path.Combine(config.AppRoot, HostProfile.Entry))) throw new Exception("Service application files are incomplete.");
        if (HostProfile.Central) { config.ServerConfigFile = Absolute(config.ServerConfigFile); RejectReparseAncestors(config.ServerConfigFile); if (!File.Exists(config.ServerConfigFile) || new FileInfo(config.ServerConfigFile).Length > 16384) throw new Exception("Central server configuration is missing or too large."); }
        if (!console)
        {
            string programRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), HostProfile.Product) + "\\";
            string commonRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), HostProfile.Product);
            if (!config.AppRoot.StartsWith(programRoot, StringComparison.OrdinalIgnoreCase) || !config.DataDir.Equals(Path.Combine(commonRoot, "Data"), StringComparison.OrdinalIgnoreCase) || !file.Equals(Path.Combine(commonRoot, HostProfile.Config), StringComparison.OrdinalIgnoreCase) || (HostProfile.Central && !config.ServerConfigFile.Equals(Path.Combine(commonRoot, "server-config.json"), StringComparison.OrdinalIgnoreCase))) throw new Exception("Service paths must be in the protected machine installation.");
            WindowsIdentity identity = WindowsIdentity.GetCurrent();
            SecurityIdentifier serviceSid = (SecurityIdentifier)new NTAccount(@"NT SERVICE\" + HostProfile.Service).Translate(typeof(SecurityIdentifier));
            if (!identity.User.Equals(serviceSid)) throw new Exception("The agent must run as its dedicated virtual service account.");
            string connectionFile = Path.Combine(commonRoot, "central-connection.json");
            if (!HostProfile.Central && !File.Exists(connectionFile) && (File.Exists(connectionFile + ".pending.json") || File.Exists(Path.Combine(commonRoot, "central-enrollment.required")))) throw new Exception("Machine enrollment is required or pending. An administrator must complete registration before the service can start.");
        }
        RejectReparseAncestors(config.AppRoot); RejectReparseAncestors(config.DataDir);
        Directory.CreateDirectory(config.DataDir);
    }
    void Log(string line)
    {
        try
        {
            lock (sync)
            {
                string file = Path.Combine(config.DataDir, HostProfile.Prefix + ".log");
                if (File.Exists(file) && new FileInfo(file).Length > 2 * 1024 * 1024) { string old = file + ".1"; if (File.Exists(old)) File.Delete(old); File.Move(file, old); }
                File.AppendAllText(file, DateTime.UtcNow.ToString("o") + " " + (line ?? "").Substring(0, Math.Min(4000, (line ?? "").Length)) + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch { }
    }
    void Status(string state)
    {
        lock (sync)
        {
            string file = Path.Combine(config.DataDir, HostProfile.Prefix + "-status.json"), temp = file + ".tmp";
            File.WriteAllText(temp, json.Serialize(new { state = state, mode = console ? "console-test" : "windows-service", updatedAt = DateTime.UtcNow.ToString("o"), generation = generation, hostPid = Process.GetCurrentProcess().Id, childPid = child != null && !child.HasExited ? child.Id : 0 }), new UTF8Encoding(false));
            if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
        }
    }
    void StartChild()
    {
        DateTime at = DateTime.UtcNow;
        while (starts.Count > 0 && at - starts.Peek() > TimeSpan.FromMinutes(1)) starts.Dequeue();
        if (starts.Count >= 4) throw new Exception("Agent restart limit reached. Inspect protected logs.");
        starts.Enqueue(at); generation++;
        job = new ProcessJob(config.MemoryLimitMb);
        string exe = Path.Combine(config.AppRoot, @"runtime\node.exe");
        System.Collections.SortedList environment = new System.Collections.SortedList(StringComparer.OrdinalIgnoreCase);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables()) environment[(string)entry.Key] = (string)entry.Value;
        environment.Remove("NODE_OPTIONS"); environment.Remove("NODE_PATH"); environment.Remove("PSModulePath");
        if (HostProfile.Central) {
            List<string> inherited = new List<string>(); foreach (System.Collections.DictionaryEntry entry in environment) if (((string)entry.Key).StartsWith("DLP_", StringComparison.OrdinalIgnoreCase)) inherited.Add((string)entry.Key);
            foreach (string name in inherited) environment.Remove(name);
            environment["DLP_CENTRAL_SERVER_CONFIG"] = config.ServerConfigFile; environment["DLP_CENTRAL_DATA_DIR"] = config.DataDir;
            environment["DLP_CENTRAL_PORT"] = config.Port.ToString(); environment["DLP_CENTRAL_REQUIRE_MFA"] = "1";
            environment["DLP_CENTRAL_SERVICE"] = console ? "console-test" : "windows-service";
            string staleStop = Path.Combine(config.DataDir, "central-service-stop.request"); if (File.Exists(staleStop)) File.Delete(staleStop);
        } else { environment["DLP_DATA_DIR"] = config.DataDir; environment["DLP_AGENT_MODE"] = "service"; }
        if (!HostProfile.Central && !console) {
            // Machine enrollment is read only from the administrator-protected
            // common directory, never an inherited caller-selected location.
            environment.Remove("DLP_CENTRAL_CONFIG");
            string connection = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KalkanDLP", "central-connection.json");
            if (File.Exists(connection)) environment["DLP_CENTRAL_CONFIG"] = connection;
        }
        if (!HostProfile.Central) environment["DLP_AGENT_CONSOLE_TEST"] = console ? "1" : "0"; environment["PORT"] = config.Port.ToString();
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        environment["PATH"] = Path.Combine(windows, "System32") + ";" + windows + ";" + Path.Combine(windows, @"System32\Wbem") + ";" + Path.Combine(windows, @"System32\WindowsPowerShell\v1.0");
        string temporary = Path.Combine(config.DataDir, "Temp"); Directory.CreateDirectory(temporary); environment["TEMP"] = temporary; environment["TMP"] = temporary;
        StringBuilder block = new StringBuilder();
        foreach (System.Collections.DictionaryEntry entry in environment) { if (((string)entry.Key).Contains("=")) continue; block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0'); } block.Append('\0');
        IntPtr nativeEnvironment = Marshal.StringToHGlobalUni(block.ToString());
        ProcessInfo created = new ProcessInfo();
        string log = Path.Combine(config.DataDir, "node-output.log");
        if (File.Exists(log) && new FileInfo(log).Length > 2 * 1024 * 1024) { if (File.Exists(log + ".1")) File.Delete(log + ".1"); File.Move(log, log + ".1"); }
        SecurityAttributes security = new SecurityAttributes(); security.size = Marshal.SizeOf(typeof(SecurityAttributes)); security.inherit = true;
        try
        {
            using (SafeFileHandle output = CreateFileW(log, 4, 3, ref security, 4, 0x80, IntPtr.Zero))
            using (SafeFileHandle input = CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero))
            {
                if (output.IsInvalid || input.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                StartupInfo startup = new StartupInfo(); startup.size = Marshal.SizeOf(typeof(StartupInfo)); startup.flags = 0x100;
                startup.input = input.DangerousGetHandle(); startup.output = output.DangerousGetHandle(); startup.error = output.DangerousGetHandle();
                StringBuilder command = new StringBuilder("\"" + exe + "\" \"" + Path.Combine(config.AppRoot, HostProfile.Entry) + "\"");
                // Assign the suspended process before any application code or child can run.
                if (!CreateProcessW(exe, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000000 | 0x4 | 0x400, nativeEnvironment, config.AppRoot, ref startup, out created)) throw new Win32Exception(Marshal.GetLastWin32Error());
                job.AddHandle(created.process); child = Process.GetProcessById((int)created.pid);
                IntPtr retainedHandle = child.Handle;
                if (ResumeThread(created.thread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        catch { if (created.process != IntPtr.Zero) TerminateProcess(created.process, 1); job.Dispose(); if (child != null) child.Dispose(); child = null; throw; }
        finally { if (created.thread != IntPtr.Zero) CloseHandle(created.thread); if (created.process != IntPtr.Zero) CloseHandle(created.process); Marshal.FreeHGlobal(nativeEnvironment); }
        Status("running"); Log("Node generation " + generation + " started.");
    }
    void ClearChild()
    {
        if (job != null) { job.Dispose(); job = null; }
        if (child != null) { try { child.WaitForExit(5000); } catch { } child.Dispose(); child = null; }
    }
    void Monitor()
    {
        try
        {
            while (!stop.WaitOne(1000))
            {
                if (child.HasExited) { Log("Node exited with " + child.ExitCode + "."); ClearChild(); if (stop.WaitOne(1500)) return; StartChild(); }
            }
        }
        catch (Exception error) { failed = true; Log(error.Message); Status("failed"); stop.Set(); }
    }
    public void Start()
    {
        Load(); StartChild(); monitor = new Thread(Monitor); monitor.IsBackground = true; monitor.Start();
    }
    public bool Failed { get { return failed; } }
    public void Dispose()
    {
        if (disposed) return; disposed = true; stop.Set();
        if (monitor != null) monitor.Join(5000);
        try
        {
            if (HostProfile.Central) {
                string key = File.ReadAllText(Path.Combine(config.DataDir, "central-control-token.txt")).Trim();
                if (key.Length != 64) throw new Exception("Invalid central control token.");
                File.WriteAllText(Path.Combine(config.DataDir, "central-service-stop.request"), key, new UTF8Encoding(false));
                if (child != null) child.WaitForExit(10000);
            } else {
            string key = File.ReadAllText(Path.Combine(config.DataDir, "control-token.txt")).Trim();
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + config.Port + "/api/control/shutdown");
            request.Proxy = null; request.Method = "POST"; request.ContentType = "application/json"; request.Headers["X-DLP-Control"] = key; request.Timeout = 5000;
            byte[] bytes = Encoding.UTF8.GetBytes("{}"); request.ContentLength = bytes.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            using (WebResponse response = request.GetResponse()) { }
            if (child != null) child.WaitForExit(10000);
            }
        }
        catch { }
        ClearChild(); if (config != null) { Status(failed ? "failed" : "stopped"); Log("Agent stopped."); }
    }
}

internal sealed class KalkanService : ServiceBase
{
    readonly string config;
    AgentRuntime runtime;
    Timer failureMonitor;
    public KalkanService(string path) { ServiceName = HostProfile.Service; CanStop = true; CanShutdown = true; AutoLog = true; config = path; }
    protected override void OnStart(string[] args)
    {
        runtime = new AgentRuntime(config, false); runtime.Start();
        failureMonitor = new Timer(delegate { if (runtime.Failed) { ExitCode = 1; Stop(); } }, null, 5000, 5000);
    }
    protected override void OnStop() { if (failureMonitor != null) failureMonitor.Dispose(); RequestAdditionalTime(20000); if (runtime != null) runtime.Dispose(); }
    protected override void OnShutdown() { if (runtime != null) runtime.Dispose(); }
}

internal static class Program
{
    static int Main(string[] args)
    {
        try
        {
            bool console = false; string config = null;
            for (int i = 0; i < args.Length; i++) { if (args[i] == "--console") console = true; else if (args[i] == "--config" && i + 1 < args.Length) config = args[++i]; else throw new Exception("Unknown argument."); }
            if (config == null) throw new Exception("--config is required.");
            if (!console) { ServiceBase.Run(new KalkanService(config)); return 0; }
            using (AgentRuntime runtime = new AgentRuntime(config, true))
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                runtime.Start(); Console.WriteLine(HostProfile.Central ? "KALKAN_CENTRAL_STARTED" : "KALKAN_AGENT_STARTED");
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) { e.Cancel = true; done.Set(); };
                Thread input = new Thread(new ThreadStart(delegate { while (true) { string line = Console.ReadLine(); if (line == null || line == "stop") { done.Set(); return; } } })); input.IsBackground = true; input.Start();
                while (!done.WaitOne(500)) if (runtime.Failed) return 1;
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
