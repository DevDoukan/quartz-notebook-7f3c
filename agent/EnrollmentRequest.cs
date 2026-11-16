using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// Public deployment data plus a short-lived, one-use enrollment token. Never
// accepts a central password, recovery code, private key or arbitrary CA path.
internal sealed class EnrollmentRequest
{
    internal string Origin { get; private set; }
    internal string Name { get; set; }
    internal string CaPem { get; private set; }
    internal int CertificateCount { get; private set; }
    private string token;
    private const int MaxBytes = 131072;

    internal static EnrollmentRequest Parse(string json, string defaultName)
    {
        try
        {
            if (json == null || Encoding.UTF8.GetByteCount(json) > MaxBytes) throw new InvalidDataException();
            var serializer = new JavaScriptSerializer { MaxJsonLength = MaxBytes, RecursionLimit = 8 };
            var fields = serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (fields == null) throw new InvalidDataException();
            foreach (string key in fields.Keys)
                if (key != "origin" && key != "name" && key != "token" && key != "caPem") throw new InvalidDataException();
            object originValue, tokenValue, nameValue, caValue;
            if (!fields.TryGetValue("origin", out originValue) || !(originValue is string) ||
                !fields.TryGetValue("token", out tokenValue) || !(tokenValue is string)) throw new InvalidDataException();
            string origin = (string)originValue, suppliedToken = (string)tokenValue;
            Uri uri;
            if (origin.Length > 2048 || !Uri.TryCreate(origin, UriKind.Absolute, out uri) ||
                uri.Scheme != "https" || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" ||
                uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
                !Regex.IsMatch(suppliedToken, @"\A[a-f0-9]{64}\z")) throw new InvalidDataException();
            var builder = new UriBuilder(uri) { Host = uri.IdnHost };
            var request = new EnrollmentRequest { Origin = builder.Uri.GetLeftPart(UriPartial.Authority), token = suppliedToken };
            if (fields.TryGetValue("name", out nameValue) && !(nameValue is string)) throw new InvalidDataException();
            request.Name = ValidateName(nameValue == null ? defaultName : (string)nameValue);
            if (fields.TryGetValue("caPem", out caValue))
            {
                string pem = caValue as string;
                if (String.IsNullOrEmpty(pem) || pem.Length > 65536 || pem.IndexOf("PRIVATE KEY", StringComparison.OrdinalIgnoreCase) >= 0)
                    throw new InvalidDataException();
                pem = pem.TrimStart('\uFEFF');
                const string pattern = @"-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\r\n\t ]+)-----END CERTIFICATE-----";
                MatchCollection certificates = Regex.Matches(pem, pattern);
                if (certificates.Count == 0 || Regex.Replace(pem, pattern, "").Trim().Length != 0) throw new InvalidDataException();
                var normalized = new StringBuilder();
                foreach (Match certificate in certificates)
                {
                    byte[] der = Convert.FromBase64String(certificate.Groups[1].Value);
                    // Classify before constructing X509Certificate2: a disguised
                    // PKCS#12 payload must never import a private key/container.
                    if (X509Certificate2.GetCertContentType(der) != X509ContentType.Cert) throw new InvalidDataException();
                    using (var parsed = new X509Certificate2(der))
                    {
                        byte[] canonical = parsed.RawData;
                        if (parsed.HasPrivateKey || canonical.Length == 0 || canonical.Length != der.Length) throw new InvalidDataException();
                        for (int i = 0; i < der.Length; i++) if (canonical[i] != der[i]) throw new InvalidDataException();
                    }
                    normalized.Append(certificate.Value).Append('\n');
                }
                request.CaPem = normalized.ToString(); request.CertificateCount = certificates.Count;
            }
            return request;
        }
        catch { throw new InvalidDataException("Kayıt dosyası geçersiz. HTTPS adresi, tek kullanımlık anahtar ve varsa açık PEM sertifikası gerekir."); }
    }

    internal static string ValidateName(string value)
    {
        if (String.IsNullOrWhiteSpace(value) || value.Length > 120 || Regex.IsMatch(value, @"[\x00-\x1f]"))
            throw new InvalidDataException("Cihaz adı 1–120 karakter olmalı ve kontrol karakteri içermemeli.");
        return value.Trim();
    }

    internal string Encode()
    {
        var fields = new Dictionary<string, object> { { "origin", Origin }, { "name", ValidateName(Name) }, { "token", token } };
        if (CaPem != null) fields.Add("caPem", CaPem);
        return new JavaScriptSerializer().Serialize(fields);
    }

    // Capture an ordinary local file through one immutable handle. An elevated
    // picker must not follow a replaced symlink, device/UNC path or hard link.
    internal static EnrollmentRequest ReadFile(string path, string defaultName)
    {
        try
        {
            if (path == null || !Regex.IsMatch(path, @"\A[A-Za-z]:\\") || path.IndexOf(':', 2) >= 0) throw new InvalidDataException();
            string expected = Path.GetFullPath(path);
            DriveType drive = new DriveInfo(Path.GetPathRoot(expected)).DriveType;
            if (drive != DriveType.Fixed && drive != DriveType.Removable && drive != DriveType.CDRom) throw new InvalidDataException();
            using (SafeFileHandle handle = CreateFileW(expected, 0x80000000u, 1, IntPtr.Zero, 3, 0x00200000u | 0x08000000u, IntPtr.Zero))
            {
                HandleInfo info;
                if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) ||
                    (info.Attributes & (0x400u | 0x10u)) != 0 || info.Links != 1 || info.SizeHigh != 0 || info.SizeLow > MaxBytes)
                    throw new InvalidDataException();
                var final = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandleW(handle, final, (uint)final.Capacity, 0);
                if (length == 0 || length >= final.Capacity || !String.Equals(final.ToString(), @"\\?\" + expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException();
                using (var stream = new FileStream(handle, FileAccess.Read))
                using (var content = new MemoryStream())
                {
                    byte[] buffer = new byte[4096]; int read;
                    while ((read = stream.Read(buffer, 0, buffer.Length)) != 0)
                    {
                        if (content.Length + read > MaxBytes) throw new InvalidDataException();
                        content.Write(buffer, 0, read);
                    }
                    byte[] bytes = content.ToArray();
                    try
                    {
                        int start = bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf ? 3 : 0;
                        return Parse(new UTF8Encoding(false, true).GetString(bytes, start, bytes.Length - start), defaultName);
                    }
                    finally { Array.Clear(bytes, 0, bytes.Length); Array.Clear(buffer, 0, buffer.Length); }
                }
            }
        }
        catch { throw new InvalidDataException("Yerel bir kayıt JSON dosyası seçin. Dosya biçimi, boyutu veya güvenli dosya erişimi doğrulanamadı."); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] private struct HandleInfo
    {
        public uint Attributes; public FileTime Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out HandleInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint length, uint flags);
}
