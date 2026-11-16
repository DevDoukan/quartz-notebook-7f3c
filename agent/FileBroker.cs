using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Opens and authorizes the actual Windows object before reading. No path-based
// authorization followed by a separate file open is used for service reads.
internal static class FileBroker
{
    const int MaxBytes = 10 * 1024 * 1024;
    sealed class Request
    {
        public string action { get; set; }
        public string path { get; set; }
        public string[] roots { get; set; }
        public string[] denied { get; set; }
    }
    [StructLayout(LayoutKind.Sequential)] struct FileInfo
    {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder buffer, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int infoClass, IntPtr buffer, uint size);

    static string Normal(string value)
    {
        if (value == null || value.Length > 30000) throw new Exception("Gecersiz yerel yol.");
        value = value.Replace('/', '\\');
        if (!Regex.IsMatch(value, @"^[A-Za-z]:\\") || value.Substring(2).Contains(":")) throw new Exception("Yalnizca yerel surucu yollari desteklenir.");
        foreach (string part in value.Substring(3).Split('\\'))
            if (Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase)) throw new Exception("Aygit yolu kullanilamaz.");
        return Path.GetFullPath(value).TrimEnd('\\');
    }
    static bool Within(string value, string root)
    {
        return value.Equals(root, StringComparison.OrdinalIgnoreCase) || value.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
    }
    static string Final(SafeFileHandle handle)
    {
        StringBuilder buffer = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
        string result = buffer.ToString();
        if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) throw new Exception("Ag yollari desteklenmez.");
        if (result.StartsWith(@"\\?\")) result = result.Substring(4);
        return Normal(result);
    }
    static void Authorize(string final, Request request)
    {
        if (request.roots == null || request.roots.Length == 0 || request.roots.Length > 20) throw new Exception("Guvenilen klasor tanimlanmamis.");
        if (request.denied == null || request.denied.Length < 2 || request.denied.Length > 20) throw new Exception("Korunan klasor yapilandirmasi eksik.");
        foreach (string denied in request.denied) if (Within(final, Normal(denied))) throw new Exception("Korunan uygulama veya veri klasoru okunamaz.");
        foreach (string root in request.roots)
        {
            string normalized = Normal(root);
            if (normalized.Length <= 3) continue;
            if (Within(final, normalized)) return;
        }
        throw new Exception("Dosya guvenilen klasorlerin disinda.");
    }
    static object Read(Request request)
    {
        string input = Normal(request.path);
        Authorize(input, request);
        using (SafeFileHandle handle = CreateFileW(input, 0x80000000, 1, IntPtr.Zero, 3, 0x08000000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            string final = Final(handle); Authorize(final, request);
            FileInfo info;
            if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.attributes & 0x10) != 0 || info.links != 1) throw new Exception("Normal, tek baglantili dosya gerekli.");
            if (info.sizeHigh != 0 || info.sizeLow > MaxBytes) throw new Exception("Dosya 10 MB sinirini asiyor.");
            using (FileStream stream = new FileStream(handle, FileAccess.Read))
            using (MemoryStream output = new MemoryStream())
            {
                byte[] chunk = new byte[65536]; int read;
                while ((read = stream.Read(chunk, 0, chunk.Length)) > 0)
                {
                    if (output.Length + read > MaxBytes) throw new Exception("Dosya buyukluk siniri asildi.");
                    output.Write(chunk, 0, read);
                }
                return new { path = final, data = Convert.ToBase64String(output.ToArray()) };
            }
        }
    }
    static object List(Request request)
    {
        Authorize(Normal(request.path), request);
        using (SafeFileHandle handle = CreateFileW(Normal(request.path), 1, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            string final = Final(handle); Authorize(final, request);
            List<object> entries = new List<object>();
            IntPtr buffer = Marshal.AllocHGlobal(65536); bool first = true, truncated = false;
            try
            {
                while (true)
                {
                    // FILE_FULL_DIR_INFO, queried on the validated directory handle.
                    bool success = GetFileInformationByHandleEx(handle, first ? 15 : 14, buffer, 65536); first = false;
                    if (!success)
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error == 18) break;
                        throw new Win32Exception(error);
                    }
                    int offset = 0;
                    while (true)
                    {
                        int next = Marshal.ReadInt32(buffer, offset), attributes = Marshal.ReadInt32(buffer, offset + 56), bytes = Marshal.ReadInt32(buffer, offset + 60);
                        if (bytes < 0 || bytes % 2 != 0 || offset + 68 + bytes > 65536) throw new Exception("Klasor girdisi dogrulanamadi.");
                        string name = Marshal.PtrToStringUni(IntPtr.Add(buffer, offset + 68), bytes / 2);
                        if (name != "." && name != "..") entries.Add(new { name = name, directory = (attributes & 0x10) != 0, reparse = (attributes & 0x400) != 0 });
                        if (entries.Count >= 20001) { truncated = true; break; }
                        if (next == 0) break;
                        if (next < 68 || offset + next >= 65536) throw new Exception("Klasor girdisi siniri gecersiz.");
                        offset += next;
                    }
                    if (truncated) break;
                }
                return new { path = final, entries = entries, truncated = truncated };
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }
    static int Main()
    {
        try
        {
            Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
            StringBuilder input = new StringBuilder(); char[] chunk = new char[4096]; int read;
            while ((read = Console.In.Read(chunk, 0, chunk.Length)) > 0) { input.Append(chunk, 0, read); if (input.Length > 65536) throw new Exception("Istek cok buyuk."); }
            JavaScriptSerializer json = new JavaScriptSerializer(); json.MaxJsonLength = 32 * 1024 * 1024;
            Request request = json.Deserialize<Request>(input.ToString());
            object result = request.action == "read" ? Read(request) : request.action == "list" ? List(request) : null;
            if (result == null) throw new Exception("Gecersiz islem.");
            Console.Write(json.Serialize(result)); return 0;
        }
        catch (Exception error)
        {
            Win32Exception windows = error as Win32Exception;
            Console.Error.WriteLine(new JavaScriptSerializer().Serialize(new { error = error.Message, win32 = windows == null ? 0 : windows.NativeErrorCode })); return 1;
        }
    }
}
