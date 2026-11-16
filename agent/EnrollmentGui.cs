using System;
using System.Drawing;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;

internal static class KalkanDlpEnrollment
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        bool acquired = false;
        try
        {
            var security = new MutexSecurity(); security.SetAccessRuleProtection(true, false);
            security.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
            foreach (string sid in new[] { "S-1-5-18", "S-1-5-32-544" })
                security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(sid), MutexRights.FullControl, AccessControlType.Allow));
            bool created;
            using (var mutex = new Mutex(false, @"Global\KalkanDlpMachineEnrollment", out created, security))
            {
                try { acquired = mutex.WaitOne(0, false); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) { MessageBox.Show("Bu bilgisayarda başka bir Client kayıt yardımcısı açık.", "Kalkan DLP", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
                try { Application.Run(new EnrollmentForm(EnrollmentHost.OpenInstalled(), false)); }
                finally { mutex.ReleaseMutex(); }
            }
        }
        catch { MessageBox.Show("Kayıt yardımcısı başlatılamadı. Güncel Client kurulumunu ve korunan makine/program izinlerini kontrol edin. Windows yönetici yetkisi gerekir.", "Kalkan DLP", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}

internal sealed class EnrollmentForm : Form
{
    private readonly EnrollmentHost host;
    private readonly bool preview;
    private EnrollmentRequest request;
    private bool busy;
    private readonly TextBox fileName = new TextBox { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly TextBox origin = new TextBox { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly TextBox device = new TextBox { MaxLength = 120, Dock = DockStyle.Fill };
    private readonly Label certificate = new Label { AutoSize = true, Dock = DockStyle.Fill };
    private readonly Label status = new Label { AutoSize = true, Dock = DockStyle.Fill, AccessibleRole = AccessibleRole.StaticText };
    private readonly Button select = Button("Dosya &seç", false);
    private readonly Button register = Button("Client’ı &kaydet", true);
    private readonly Button resume = Button("Bekleyen kaydı s&ürdür", false);
    private readonly Button close = Button("&Kapat", false);
    private readonly ProgressBar progress = new ProgressBar { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 25, Dock = DockStyle.Fill, Height = 7, Visible = false };
    private readonly TableLayoutPanel content = new TableLayoutPanel { ColumnCount = 1, Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(24), BackColor = Color.White };

    internal EnrollmentForm(EnrollmentHost installed, bool isPreview)
    {
        host = installed; preview = isPreview;
        Text = preview ? "Kalkan DLP · Client kaydı · Önizleme" : "Kalkan DLP · Client kaydı";
        Font = new Font("Segoe UI", 10); BackColor = Color.FromArgb(248, 250, 252);
        ForeColor = Color.FromArgb(30, 41, 59); ClientSize = new Size(720, 640);
        MinimumSize = new Size(560, 480); AutoScaleMode = AutoScaleMode.Font;
        StartPosition = FormStartPosition.CenterScreen; AutoScroll = true; MaximizeBox = false;
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); Controls.Add(content);
        Add(TextLabel("KALKAN DLP", 11, FontStyle.Bold));
        Add(TextLabel("Client’ı şirket merkezine bağlayın", 20, FontStyle.Bold));
        Add(TextLabel(preview ? "ÖNİZLEME · Hizmet ve kayıt dosyaları değiştirilmez." : "Merkez panelinden indirdiğiniz tek kullanımlık kayıt dosyasını seçin. Merkez yönetici parolanız istenmez.", 10, FontStyle.Regular));
        Add(TextLabel("1. Kayıt dosyası", 11, FontStyle.Bold));
        var picker = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Fill, AutoSize = true, Margin = new Padding(0, 0, 0, 16) };
        picker.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); picker.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        fileName.Margin = new Padding(0, 6, 12, 6); picker.Controls.Add(fileName, 0, 0); picker.Controls.Add(select, 1, 0); Add(picker);
        Add(TextLabel("2. Bağlantıyı kontrol edin", 11, FontStyle.Bold));
        Add(TextLabel("Merkez HTTPS adresi", 10, FontStyle.Regular)); Add(origin);
        Add(TextLabel("Cihaz adı", 10, FontStyle.Regular)); Add(device);
        certificate.Margin = new Padding(0, 8, 0, 18); Add(certificate);
        Add(TextLabel("3. Kaydı tamamlayın", 11, FontStyle.Bold));
        status.Margin = new Padding(0, 0, 0, 18); status.Name = "EnrollmentStatus"; Add(status); Add(progress);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Margin = new Padding(0, 12, 0, 0) };
        actions.Controls.Add(register); actions.Controls.Add(resume); actions.Controls.Add(close); Add(actions);
        fileName.AccessibleName = "Seçilen kayıt dosyası"; origin.AccessibleName = "Merkez HTTPS adresi"; device.AccessibleName = "Cihaz adı";
        select.Click += SelectFile; register.Click += delegate { Execute(false); }; resume.Click += delegate { Execute(true); }; close.Click += delegate { Close(); };
        CancelButton = close; AcceptButton = register;
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) e.Cancel = true; };
        Resize += delegate { ResizeLabels(); };
        Shown += delegate {
            Rectangle area = Screen.FromControl(this).WorkingArea;
            if (Width > area.Width || Height > area.Height) { MinimumSize = new Size(Math.Min(560, area.Width), Math.Min(480, area.Height)); Size = new Size(Math.Min(Width, area.Width), Math.Min(Height, area.Height)); }
            ResizeLabels();
        };
        device.Text = preview ? "KALKAN-TEST" : Environment.MachineName;
        certificate.Text = "Standart HTTPS sertifika doğrulaması kullanılacak.";
        status.Text = preview ? "Kayıt dosyasını kontrol edin. Önizlemede kayıt işlemi yapılmaz." : host.HasIdentity ? "Bu bilgisayarda merkez kimliği zaten var. Mevcut kimliğin üzerine yazılmaz." : host.HasPending ? "Önceki kayıt tamamlanmamış. Aynı makine kimliğiyle devam etmek için bekleyen kaydı sürdürün." : "Dosyayı seçtikten sonra HTTPS adresini kontrol edin. Kayıt sırasında Windows izinleri ve kurulu paket de doğrulanır.";
        if (preview) { fileName.Text = "enrollment-request.json"; origin.Text = "https://dlp.firma.example:9443"; }
        RefreshButtons();
    }

    private static Button Button(string text, bool primary)
    {
        return new Button { Text = text, AutoSize = true, MinimumSize = new Size(0, 44), Padding = new Padding(14, 7, 14, 7),
            FlatStyle = primary ? FlatStyle.Flat : FlatStyle.Standard, BackColor = primary ? Color.FromArgb(3, 105, 161) : SystemColors.Control,
            ForeColor = primary ? Color.White : Color.FromArgb(30, 41, 59), UseVisualStyleBackColor = !primary, Margin = new Padding(0, 0, 12, 8) };
    }
    private static Label TextLabel(string text, int size, FontStyle style)
    { return new Label { Text = text, AutoSize = true, Dock = DockStyle.Fill, Font = new Font("Segoe UI", size, style), Margin = new Padding(0, 0, 0, 10) }; }
    private void Add(Control control)
    {
        content.RowCount++; content.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        if (control is TextBox) control.Margin = new Padding(0, 0, 0, 12);
        content.Controls.Add(control, 0, content.RowCount - 1);
    }
    private void ResizeLabels()
    {
        int width = Math.Max(100, ClientSize.Width - 64);
        foreach (Control control in content.Controls) if (control is Label) control.MaximumSize = new Size(width, 0);
    }
    private void RefreshButtons()
    {
        bool identity = !preview && host.HasIdentity, pending = !preview && host.HasPending;
        select.Enabled = !busy && !preview && !identity && !pending;
        register.Enabled = !busy && !identity && !pending && (preview || request != null);
        resume.Visible = pending; resume.Enabled = !busy && pending && !identity;
        device.ReadOnly = busy || identity || pending || (!preview && request == null); close.Enabled = !busy;
        AcceptButton = pending ? resume : register;
    }
    private void SelectFile(object sender, EventArgs args)
    {
        using (var dialog = new OpenFileDialog { Filter = "Client kayıt dosyası (*.json)|*.json", CheckFileExists = true, Multiselect = false, Title = "Merkezden indirilen kayıt dosyasını seçin" })
        {
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            request = null; origin.Clear(); fileName.Clear();
            try
            {
                request = EnrollmentRequest.ReadFile(dialog.FileName, Environment.MachineName);
                fileName.Text = System.IO.Path.GetFileName(dialog.FileName); origin.Text = request.Origin; device.Text = request.Name;
                certificate.Text = request.CertificateCount == 0 ? "Standart HTTPS sertifika doğrulaması kullanılacak." : "Açık kurum CA sertifikası içeriyor: " + request.CertificateCount;
                status.ForeColor = ForeColor; status.Text = "HTTPS adresini doğrulayın, ardından Client’ı kaydedin. Kaynak kayıt dosyasını işlemden sonra güvenli biçimde kaldırın.";
                device.Focus();
            }
            catch { certificate.Text = "Sertifika bilgisi yok."; status.ForeColor = Color.FromArgb(153, 27, 27); status.Text = "Kayıt dosyası okunamadı. Yerel, geçerli bir merkez JSON dosyası seçin. Bağlantı/hard link dosyaları ve özel anahtarlar kabul edilmez."; }
            RefreshButtons();
        }
    }
    private async void Execute(bool continuePending)
    {
        if (busy) return;
        if (preview) { status.Text = "Önizleme: kayıt veya hizmet değişikliği yapılmadı."; return; }
        try { if (!continuePending) { if (request == null) return; request.Name = EnrollmentRequest.ValidateName(device.Text); } }
        catch { status.Text = "Geçerli bir cihaz adı girin (en fazla 120 karakter)."; device.Focus(); return; }
        busy = true; progress.Visible = true; RefreshButtons();
        status.ForeColor = ForeColor; status.Text = "Paket ve izinler doğrulanıyor; Client kaydı deneniyor. İşlem tamamlanana kadar bekleyin; pencereyi küçültebilirsiniz.";
        try
        {
            EnrollmentResult result = await host.Register(request, continuePending);
            request = null; fileName.Clear(); origin.Clear();
            status.ForeColor = result.ExitCode == 0 ? Color.FromArgb(22, 101, 52) : Color.FromArgb(153, 27, 27);
            status.Text = result.ExitCode == 0 ? "Client kaydı ve hizmet sağlık kontrolü tamamlandı. Merkez panelinde cihazı ve politika teslimini kontrol edin." : "Kayıt tamamlanamadı. Paket, makine izinleri, tek kullanımlık anahtar ve HTTPS güvenini kontrol edin. Bekleyen istek varsa aynı kaydı sürdürün.";
            if (host.LastCleanupFailed) { status.ForeColor = Color.FromArgb(146, 64, 14); status.Text += " Geçici kayıt dosyası temizlenemedi; korunan makine klasörünü BT yöneticisi kontrol etmeli."; }
        }
        catch { status.ForeColor = Color.FromArgb(153, 27, 27); status.Text = "Kayıt aracı çalıştırılamadı. Kurulu Client ve korunan makine izinlerini kontrol edin; merkez kimlik dosyalarını silmeyin."; }
        finally { busy = false; progress.Visible = false; RefreshButtons(); }
    }
}
