# Kalkan DLP

[Güncel Windows Client ve Server kurucularını indir](latest/)

Yeni bir sürüm yayımlarken kurulum dosyalarını ve doğrulanmış yayın raporunu hazırlayın. PowerShell 7 ile `pwsh -File tools/Publish-Latest.ps1` komutunu çalıştırın. Ardından `latest/README.md` değişikliğini sürümle birlikte GitHub'a gönderin.

## 1.2 sürüm adayı ve ürünleşme durumu

Bu sürüm satışa çıkış öncesi doğrulama aşamasındadır. Ticari yayın kapıları PRODUCT-READINESS.md dosyasında izlenir. Kaynak ZIP yerine Node.js çalışma ortamını içeren Windows kurulum adayı hazırlanmıştır. Kurulu üründe kullanıcıdan Node.js kurulumu istenmez.

İlk açılışta yönetici hesabı oluşturulur. Varsayılan parola yoktur. Baslat.cmd tek kullanımlık yerel kurulum anahtarını panele taşır. Gerekirse veri klasöründeki setup-key.txt dosyasını kullanın. Parola en az 12 karakter olmalıdır. Yönetici kullanıcı ve politika ayarlarını yönetir, operatör tarama ve aktarım yapar, denetçi raporları okur.

1.2.0-rc.3 veri şeması 3'e geçer. Kullanıcı/parola/MFA değişiklikleri ve gereken oturum iptali imzalı denetim olayıyla aynı veritabanı işleminde kaydedilir. Önceki uygulama sürümleri yükseltilmiş veri klasörünü açmaz; sürüm düşürmek için o sürümle uyumlu ayrı yedek gerekir. Yükseltmeden önce doğrulanmış yedek alın.

Lisans ve sistem sayfası kurulum kimliğini, 14 günlük deneme süresini, imzalı lisans yüklemeyi, kayıt bütünlüğü denetimini ve şifreli yedek indirmeyi sunar. Lisans süresi dolduğunda yeni tarama ve aktarım durur, kayıt ve rapor erişimi devam eder.

Windows kurulum adayı kullanıcı hesabına kurulur. Program dosyaları sürümlü klasörlerde, veriler varsayılan olarak LOCALAPPDATA/KalkanDLP/Data altında tutulur. Kaldırma veri klasörünü silmez. Temiz başka bilgisayar, imza ve kurum ortamı kontrolleri henüz yayın kapılarıdır.

## Çevrimdışı yedek geri yükleme

Masaüstü modunda veri klasöründeki `agent-central.json` ve varsa yarım kalan `agent-central.json.pending.json` şifreli yedeğe dahil edilir. Merkez kimliğinin veritabanıyla eşleşmesi ve önbellekteki politika imzası doğrulanır. Bekleyen kayıt geri yüklendiğinde yerel işlemler kayıt tamamlanana kadar kapalı kalır. Aynı cihaz kimliğini iki bilgisayarda eşzamanlı çalıştırmayın; kurtarma öncesi eski ajanı durdurun.

Windows hizmeti veya `DLP_CENTRAL_CONFIG` ile harici yapılandırma kullanıldığında kimlik dosyası panel yedeğine alınmaz. Bu dosya Windows yöneticisinin ayrı korumalı kurtarma işlemine tabidir; veritabanındaki merkez bağı korunur ve eksik kimlikle yerel politikaya geçilmez. Eski yedekler de kimlik dosyası içermez. Masaüstü yapılandırmasında harici `caFile` varsa taşınabilir yedek reddedilir; açık CA sertifikası `caPem` olarak yapılandırmaya dahil edilmelidir.

Sunucuyu durdurun. Yedeği, çalışmayan ve boş bir veri klasörüne geri yükleyin. Parolayı komut satırı argümanına yazmayın. tools/restore-backup.cjs parolayı standart girdiden alır. Geri yüklemeden sonra DLP_DATA_DIR değişkenini yeni klasöre ayarlayın. Yönetici parolaları korunur, eski oturumlar iptal edilir ve uzantıyı yeniden eşleştirmek gerekir. Şifreli yedek ve parolayı ayrı güvenli yerlerde saklayın.

## Kaynak sürümü çalıştırma

Windows için tek yerel panelde hassas dosya taraması, web/e-posta kontrolü ve USB denetimi.

## Başlatma

Gereksinim: Windows 10/11, **Node.js 24**. Bu bilgisayarda bağımlılıklar hazırdır.

1. `Baslat.cmd` dosyasına çift tıklayın.
2. Paneli `http://127.0.0.1:4317` adresinde açın.
3. Dosya taramasında `C:\Users\mtb\Documents\dlp\ornekler` klasörünü deneyin.

Başka bilgisayara kaynak paketi taşırsanız önce proje klasöründe `npm ci --omit=dev` çalıştırın. Sunucuyu konsolda başlatmak için `npm start`, durdurmak için `Ctrl+C` kullanın. `Baslat.cmd` arka planda başlatır, günlükleri `data/server.log` ve `data/server-error.log` içine yazar. Arka plandaki örneği durdurmak için `Durdur.cmd` dosyasını kullanın. Alternatif olarak Görev Yöneticisi'nde bu projenin `server.js` komutuyla çalışan Node işlemini seçin. Diğer Node işlemlerini sonlandırmayın.

## Kullanılabilir özellikler

### Dosya taraması

- Alt klasörlerde TXT, CSV, TSV, JSON, XML, HTML, Markdown, LOG, YAML, INI, EML, SQL, kaynak kod dosyaları, PDF, DOCX ve XLSX taraması.
- T.C. kimlik numarasında kontrol basamağı, kart numarasında Luhn ve Türkiye IBAN'da mod97 doğrulaması.
- E-posta adresi, olası parola/API anahtarı ve gizlilik işaretleri tespiti.
- Dosya yolu, satır ve risk seviyesi. Ham değerler sonuçlara veya olay kayıtlarına yazılmaz.
- İlerleme, iptal, önceki taramalar ve JSON raporu.
- Klasördeki dosyaları değiştirmez. Sembolik bağlantıları ve yaygın bağımlılık klasörlerini atlar.

Sınırlar: dosya başına 10 MB, 3.000 taranan dosya, 20.000 dizin öğesi, 100 MB okunan içerik, 500 bulgulu dosya veya 5 dakika. Sınıra ulaşan sonuç kısmi olarak işaretlenir. Dosya başına ilk 100 bulgu gösterilir. En son 20 tarama saklanır. Tarama başladığındaki politika, tarama bitene kadar sabit kalır. PDF/Word okuyucusu ayrı bir süreçte çalışır ve belge başına 30 saniye süre sınırı uygular. İptal, devam eden belge okumasından sonra tamamlanabilir.

Taranmış görüntü PDF'leri için OCR, eski DOC/XLS, XLSM, genel arşivler ve şifreli belgeler desteklenmez. PDF/DOCX/XLSX satırları çıkarılan metindeki konumu gösterir; belge sayfası veya Excel hücre adresi değildir. XLSX paylaşılan/yerel hücre metinleri, zengin metin parçaları, formüller ve saklanan değerleri tarar. Formülleri çalıştırmaz, dış bağlantı indirmez; yeniden hesaplanmamış değerlerin güncelliğini garanti etmez. Görsel/gömülü ikili dosya içeren çalışma kitapları tam okunmuş sayılmaz, aktarımda reddedilir.

EML okuyucusu MIME/Base64/quoted-printable kodlamasını ve karakter kümelerini çözer; metin, HTML, konu/alıcı bilgileri ve desteklenen ekleri tarar. İç içe ek derinliği 3, ek sayısı 20, MIME parça sayısı 100 ile sınırlıdır. Desteklenmeyen/görsel/şifreli ek varsa dosya temiz kabul edilmez. EML, XLSX, PDF ve DOCX okuyucuları belgenin ayrı ve sınırlı sürecinde çalışır. Bu destek Outlook/Exchange trafiğini kendiliğinden yakalamaz. Metin dosyalarında UTF-8 ve BOM içeren UTF-16LE desteklenir. Ayrıntılı sınırlar DOCUMENT-FORMATS.md içindedir.

### Politika

- İlk açılış **izleme modunda** gelir. Bulgu aktarımı engellemez, olay oluşturur.
- **Engelleme modunda** etkin kurallardan herhangi birinin eşleşmesi entegre aktarımı durdurur.
- E-posta adresi tespiti konu, gövde ve ekleri kapsar. Alıcı adresi bir hassas veri eşleşmesi olarak değerlendirilmez.
- Okunamayan veya desteklenmeyen aktarım dosyası, izleme modunda da gönderilmez.
- Sayısal kontrol, kimlik veya hesabın gerçekliğini doğrulamaz. Örnekler ve bağlama göre yanlış alarmlar oluşabilir.

### Chrome / Edge uzantısı

1. `chrome://extensions` veya `edge://extensions` sayfasını açın.
2. Geliştirici modunu açıp **Paketlenmemiş öğe yükle** ile bu projenin `extension` klasörünü seçin.
3. Panelde **Bağlantılar** bölümünden eşleştirme anahtarını kopyalayın.
4. Uzantı simgesinde anahtarı ve korunacak alan adlarını girin. Her satıra bir alan adı yazın. `portal.example.com` veya `*.example.com` biçimini kullanın. Koruma kutusunu işaretleyip kaydedin.
5. Mevcut hedef sekmelerini yenileyin. Aynı alan adındaki tüm portlar kapsam dahilindedir.

Seçilen sitelerde standart HTML form gönderimlerini ve dosya seçimi `change` olaylarını denetler. Gönderilecek içerik, eşleştirme anahtarıyla yalnızca `127.0.0.1:4317` üzerindeki yerel servise gider. Hassas form veya ek, engelleme modunda durur. İzleme modunda kullanıcıya devam sorulur. Korunan sitede servis kapalıysa, anahtar yanlışsa veya ek okunamıyorsa işlem durur.

Bu uzantı tüm HTTP trafiğini yakalayan bir proxy değildir. Doğrudan JavaScript `fetch/XHR`, `form.submit()`, sürükle-bırak yüklemeleri ve özel webmail arayüzleri kapsama girmeyebilir. Kullanıcı uzantıyı kaldırabilir. Kurumsal tarayıcı zorunluluğu veya kötü niyetli sayfalara karşı değiştirilemez bir güvenlik sınırı sağlamaz. SMTP gönderim paneli e-posta için doğrudan entegre kanaldır.

Uzantı varsayılan 4317 portunu kullanır. Sunucunun `PORT` değişkenini değiştirirseniz uzantıdaki adresleri ve manifest host iznini de güncelleyin.

### SMTP ile kontrollü gönderim

İçerik ön kontrolü yapılandırma olmadan çalışır. Gerçek e-posta için PowerShell'de ortam değişkenlerini ayarlayıp sunucuyu aynı oturumda başlatın:

```powershell
$env:DLP_SMTP_HOST = 'smtp.sirketiniz.com'
$env:DLP_SMTP_PORT = '587'
$env:DLP_SMTP_FROM = 'gonderen@sirketiniz.com'
$env:DLP_SMTP_USER = 'gonderen@sirketiniz.com'
$smtpCredential = Get-Credential -Message 'SMTP kullanıcı adı ve uygulama parolası'
$env:DLP_SMTP_PASS = $smtpCredential.GetNetworkCredential().Password
npm start
```

Bu değerleri `Baslat.cmd` ile çalışan mevcut sunucuya uygulamak için önce o sunucuyu durdurun. Gizli bilgileri kaynak dosyaya veya Git'e eklemeyin. 465 portu doğrudan TLS, diğer portlar zorunlu STARTTLS kullanır. Gönderici adresi ve kimlik doğrulama, sağlayıcınızın SMTP politikasına uymalıdır. OAuth veya yalnızca API kabul eden sağlayıcılar için ayrıca adaptör gerekir.

Panelde kanal olarak E-posta'yı seçin, alıcıyı ve metni girin, gerekirse dosya ekleyin. **Kontrol et ve SMTP ile gönder** düğmesi gerçek bir gönderim yapar ve onay sorar. En fazla 5 ek ve toplam 10 MB. Konu, gövde ve ekler gönderimden önce kontrol edilir. Bulgu engellenirse SMTP aktarımı başlamaz. Sunucuya iletilme, alıcının posta kutusuna teslim garantisi değildir. Mevcut Outlook veya diğer istemcilerden bağımsız gönderimleri izlemez.

### USB / Windows

- Bağlı çıkarılabilir diskleri ve Windows'un USB olarak bildirdiği disklerin sürücü harflerini listeler.
- Panelden seçilen dosyayı tarar ve izin varsa aynı taranan baytları hedef diskin köküne yazar. Var olan dosyayı ezmez.
- Desteklenmeyen veya okunamayan dosyayı kopyalamaz.
- **Windows USB yazma koruması** düğmeleri UAC ile yönetici izni isteyerek `HKLM\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies\WriteProtect` değerini açar veya kapatır. Bu işlem kendiliğinden uygulanmaz.

Yazma koruması bütün desteklenen USB depolama aygıtlarını etkileyebilir. Yeniden takma veya yeniden başlatma gerekebilir. Windows sürümü, aygıt ve kurum politikası sonucu etkiler. Panel kayıt defteri ayarını gösterir, bir yazma testi gerçekleştirmez. Pilot ortamda hedef aygıt üzerinde doğrulayın. USB politikası şirketinizce yönetiliyorsa mevcut yönetime uygun kullanın.

Dosya bazlı kontrol uygulama üzerinden yapılan kopyalar içindir. Explorer üzerinden kopyalamayı dosya içeriğine göre durduran bir Windows filtre sürücüsü bu sürümde yoktur.

## Kayıtlar ve çalışma modeli

`data/dlp.sqlite` politikalara, uzantı anahtarına, son 300 olaya ve son 20 taramaya ev sahipliği yapar. Ham dosya içeriği saklanmaz. Dosya yolları ve kurallar raporda bulunur. SQLite dosyasının erişimini işletim sistemi hesabınız yönetir. Sunucu yalnızca localhost üzerinde dinler. Host ve Origin kontrolleri, oturum belirteci ve uzantı anahtarı kullanır.

Bu sürüm tek bilgisayardaki kullanıcı hesabı için yerel yönetim sağlar. Yönetici, operatör ve denetçi rolleri ile ayrı kullanıcı oturumları vardır. Merkezi konsol, bağımsız değiştirilemez kayıt depolaması, OCR, ajan dağıtımı ve sistem genelinde ağ engellemesi yoktur. Panel son 300 olayı gösterir, denetim zinciri eski olayları da saklar. Aynı yerel kullanıcı hesabındaki kötü niyetli uygulamalara karşı koruma sağlamaz.

İsteğe bağlı oturum açılışında başlatma:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Startup.ps1
# Yalnızca bu uygulamanın otomatik başlatmasını kaldırır:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Startup.ps1 -Remove
```

Bu işlem mevcut kullanıcıya bir başlangıç kısayolu ekler. Windows sistem servisi kurmaz ve yönetici yetkisiyle çalıştırmaz. Oturum açılmadığında çalışan bir kurumsal ajan değildir.

## Doğrulama

```powershell
npm ci
npm test
npm run test:ui
```

`npm test`: kontrol basamakları, maskeleme, TXT/UTF16/PDF/DOCX taraması, iptal, HTTP erişim sınırları, politika ve kalıcı kayıt, SMTP karar kapısı, ek denetimi ve USB kopyalama testleri. SMTP taşıyıcısı ve USB hedefi testlerde yalıtılmış taklitler kullanır, gerçek mesaj göndermez veya fiziksel USB diske yazmaz.

`npm run test:ui`: 4317 portunun boş olmasını ve kurulu Microsoft Edge'i gerektirir. Geçici profil ve veritabanıyla masaüstü/mobil panel, politika kaydı, tarama, rapor indirme ve gerçek Manifest V3 uzantısının form/ek engellemesini doğrular. `DLP_BROWSER_CHANNEL` ile Playwright kanalını değiştirebilirsiniz. Test görselleri `.test-artifacts` içine yazılır.

Bu bilgisayarda USB listesi Windows üzerinden okunarak kontrol edildi. Fiziksel USB bulunmadığı için gerçek aygıta yazma ve yönetici yazma korumasının etkisi doğrulanmadı. SMTP kimlik bilgisi sağlanmadığı için gerçek sağlayıcıya teslim testi yapılmadı. Bunlar kurum ortamında tamamlanacak kurulum kontrolleridir.

## Geliştirme kaynakları

- [Chrome içerik betikleri](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) ve [uzantı ağ istekleri](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Nodemailer SMTP yapılandırması](https://nodemailer.com/smtp)
- [PDF okuyucu API'si](https://www.npmjs.com/package/pdf-parse)

Bağımlılıklar `package-lock.json` ile sabitlenir. Kullanıcı dosyalarına ve ortamlara yönelik işlemler ilgili işletim sistemi izinleri altında yürür.
