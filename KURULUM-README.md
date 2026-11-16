# Kalkan DLP — Server ve Client kurulumu

Lisans düzeni iki katmandır: her şirket Server'ı yalnızca `https://lisans.kalkandlp.com.tr` adresinden üretici lisansı alır. Her Client yalnızca kendi şirket Server'ına bağlanır ve o sunucudan süreli, imzalı cihaz yetkisi alır. Lisans hizmeti PHP 8.3, Sodium ve SQLite tabanlıdır; DirectAdmin dağıtım paketi `Kalkan-License-Service-SURUM.zip` olarak hazırlanır. Kurulum adımları `licensing-php/README.md` içindedir. Dağıtım için en son sürüm numarasına sahip Client, Server ve lisans hizmeti paketlerini kullanın; daha eski sürüm kurulumları lisans akışını içermeyebilir.

Bu sürüm test adayıdır. Setup dosyaları henüz Authenticode imzalı değildir. Sistem genelinde dosya/USB filtresi tamamlanmadı; mevcut denetimler desteklenen uygulama akışlarıyla sınırlıdır. Gerçek hizmet kurulumu ve yeniden başlatma kabulü ayrı test makinesinde yapılmalıdır.

## Hangi dosya nereye kurulacak?

| Dosya | Hedef |
| --- | --- |
| Kalkan-DLP-SURUM-Server-Setup-unsigned.exe | Bir merkezi Windows x64 sunucu/bilgisayar |
| Kalkan-DLP-SURUM-Agent-Setup-unsigned.exe | Yönetilecek her Windows x64 istemci bilgisayar |
| Kalkan-DLP-SURUM-Setup-unsigned.exe | Kullanıcı oturumunda yerel deneme; şirket ajan dağıtımı yerine kullanılmaz |

Paketler kendi Node çalışma ortamını içerir. Müşteriye npm veya Node kurdurulmaz. Kurulum için Windows yöneticisi gerekir. Sunucu ve istemci için ayrı hesaplar/veri klasörleri kullanılır.

## 1. Server setup

Kurulumdan önce teslim klasöründe `Dosyalari-Dogrula.ps1` dosyasını PowerShell ile çalıştırın. Araç `DOSYA-DOGRULAMA.json` listesindeki SHA-256 değerlerini, boyutları, eksik ve fazladan dosyaları denetler. Hata bildirirse paketi güvenilir dağıtım kaynağından yeniden alın. Liste ile dosyaların birlikte değiştirilmesi bu kontrolle tespit edilemez; yayıncı kimliği Authenticode imzasıyla ayrıca doğrulanmalıdır.

1. Server setup dosyasını yönetici olarak çalıştırın. Kod `%ProgramFiles%\KalkanDLPCentral\versions\SURUM` altına kurulur. İlk kurulum, yalnızca SYSTEM/Administrators erişimli `%ProgramData%\KalkanDLPCentral` ve TLS/Data alt klasörlerini hazırlar.
2. Kurumun gerçek HTTPS DNS adını seçin (örnek: `dlp.firma.example`). Sertifika bu adı içermeli, istemciler sertifika zincirine güvenmelidir. Örnekteki adresi kullanmayın. Sertifika ve özel anahtarı PEM biçiminde korunan TLS klasörüne yerleştirin. Özel anahtarı e-posta, sohbet veya komut satırıyla paylaşmayın.
3. Yönetici 64 bit PowerShell'de yapılandırmayı yardımcıyla oluşturabilirsiniz (SURUM ve kurum adresini değiştirin):

```powershell
$serverApp = "$env:ProgramFiles\KalkanDLPCentral\versions\SURUM"
& "$serverApp\scripts\Manage-CentralService.ps1" -Action Configure -AppRoot $serverApp -Origin "https://dlp.firma.example:9443" -CertificateFile "$env:ProgramData\KalkanDLPCentral\TLS\fullchain.pem" -PrivateKeyFile "$env:ProgramData\KalkanDLPCentral\TLS\private-key.pem"
```

Özel kurum CA'sı için `-CAFile` ile korunan TLS klasöründeki açık kök sertifikasını ekleyin. Araç mevcut yapılandırmanın üzerine yazmaz; paket, korunan yollar, anahtar/sertifika eşleşmesi, sertifika tarihi ve adres kapsamını doğrular. Doğrulama başarısızsa yeni yapılandırmayı geri alır. Sertifika zincirinin Client bilgisayarlarınca güvenilir olması ayrıca gerekir. Hizmeti başlatmak için 4. adıma devam edin.

Alternatif olarak `%ProgramData%\KalkanDLPCentral\server-config.json` dosyasını elle oluşturabilirsiniz:

```json
{
  "dataDir": "C:\\ProgramData\\KalkanDLPCentral\\Data",
  "port": 9443,
  "origin": "https://dlp.firma.example:9443",
  "tlsCertFile": "C:\\ProgramData\\KalkanDLPCentral\\TLS\\fullchain.pem",
  "tlsKeyFile": "C:\\ProgramData\\KalkanDLPCentral\\TLS\\private-key.pem",
  "requireMfa": true
}
```

Özel kurum CA'sı kullanılıyorsa aynı TLS klasörüne açık kök sertifikasını koyup JSON'a `"caFile": "C:\\ProgramData\\KalkanDLPCentral\\TLS\\root-ca.pem"` ekleyin. Genel CA sertifikalarında bu alan gerekmez. Gerçek ProgramData yolu farklıysa yolları uyarlayın. Sertifika doğrulamasını kapatmayın.

4. **64 bit Windows PowerShell'i yönetici olarak** açın. SURUM yerine kurulu sürümü yazın:

```powershell
$serverApp = "$env:ProgramFiles\KalkanDLPCentral\versions\SURUM"
& "$serverApp\scripts\Manage-CentralService.ps1" -Action Validate -AppRoot $serverApp
& "$serverApp\scripts\Manage-CentralService.ps1" -Action Install -AppRoot $serverApp
& "$serverApp\scripts\Manage-CentralService.ps1" -Action Status
```

Kurum yürütme politikası scripti engelliyorsa kurumun onaylı script çalıştırma yöntemini kullanın. `Validate` başarısızken `Install` aşamasına geçmeyin. Setup, müşteriye ait TLS bilgisi olmadan merkezi başlatmaz; yukarıdaki yapılandırma/kurulum aşaması zorunludur.

5. DNS çözümlemesini ve seçilen TCP portunun yalnızca gerekli şirket ağlarından erişimini hazırlayın. Setup güvenlik duvarını otomatik açmaz. Tarayıcıdan gerçek HTTPS adını açın. İlk anahtar korunan `Data\setup-key.txt` dosyasındadır; yönetici hesabını oluşturun, MFA'yı etkinleştirin, kurtarma kodlarını ayrı güvenli yerde saklayın ve tekrar giriş yapın.
6. Şirket oluşturun, politikasını yayınlayın. Hassas veri kurallarına ek olarak USB depolama yazma kuralını "Ayarı değiştirme", "Yazmayı engelle (salt okunur)" veya "Yazmaya izin ver" seçebilirsiniz. Bu Windows ayarı yalnızca yeni makine Agent hizmetinde uygulanır ve bağlı USB depolama aygıtlarının tamamını etkiler; Explorer üzerinden içerik taraması yapmaz. Her cihaz için ayrı tek kullanımlık ajan kayıt anahtarı üretin (15 dakika geçerli). Bayi/şirket kullanıcılarına yalnızca ilgili şirket üyeliğini verin.

7. Üretici lisansı verildikten sonra müşteri Server bilgisayarında `/api/server-license` durumu `active` olmalıdır. Lisans kimliği dosyasını yalnızca korunan `%ProgramData%\KalkanDLPCentral\Data\vendor-activation.json` konumuna koyun; içeriği sadece `{"credential":"64-karakter-anahtar"}` olmalı. Yenileme otomatik olarak HTTPS üzerinden yapılır. Server etkin değilken yeni Client kaydı açılamaz.

## 2. Client / ajan setup

1. Her bilgisayarda Agent setup dosyasını yönetici olarak çalıştırın. Kod `%ProgramFiles%\KalkanDLP`, veriler `%ProgramData%\KalkanDLP\Data` altındadır. Hizmet adı `KalkanDlpAgent`; ayrı sanal hizmet hesabıyla çalışır.
2. rc.47 ve sonrasında kurulum sonunda açılan **Client kayıt yardımcısı** ile merkezden indirdiğiniz tek kullanımlık kayıt JSON dosyasını seçin. Yardımcıya Başlat menüsündeki Kalkan DLP klasöründen de ulaşabilirsiniz. Gösterilen şirket HTTPS adresini ve cihaz adını kontrol edip kaydı başlatın. Windows yönetici onayı gerekir; merkez yönetici parolası veya MFA kodu gerekmez. Kesinti sonrası **Kaydı sürdür** seçeneğini kullanın. Mevcut cihaz kimliğinin üzerine yazılmaz.

Yardımcı, isteği yalnızca kendisinin oluşturduğu korunan geçici dosyayla kayıt aracına aktarır ve bu geçici dosyayı işlem sonunda kaldırır. Seçtiğiniz asıl indirme dosyasını değiştirmez; başarılı kayıt sonrası bu dosyayı güvenli dağıtım sürecinizle kaldırın. Özel kurum CA'sı gerekiyorsa merkezden dosyayı indirirken açık CA sertifikasını ekleyin. Yardımcının başarı durumu hizmet sağlığını gösterir; merkezde cihazın politika sürümünü ayrıca kontrol edin.

Komut satırı veya RMM dağıtımı için kurulu sürüm klasöründe yönetici 64 bit PowerShell ile kayıt aracını kullanabilirsiniz:

```powershell
$clientApp = "$env:ProgramFiles\KalkanDLP\versions\SURUM"
& "$clientApp\scripts\Register-Agent.ps1" -Origin "https://dlp.firma.example:9443" -DeviceName $env:COMPUTERNAME
```

Kayıt anahtarını aracın gizli istemine girin; argümana yazmayın. Özel kurum CA'sında `-CAFile "C:\Korunan\root-ca.pem"` ekleyin; yalnızca açık sertifika verilir. Bağlantı yanıtı kaybolmuşsa aynı makinede `Register-Agent.ps1 -Resume` ile mevcut kayıt sürdürülür. Başka cihazın bağlantı dosyasını kopyalamayın.

3. Yerel panel `http://127.0.0.1:4317` adresindedir; her PC'deki bu adres o PC'ye aittir. BT'nin ortak yönetim ekranı merkezi HTTPS adresidir. Yerel ilk kurulum hesabı gerekiyorsa o cihazın `Data\setup-key.txt` anahtarı kullanılır; merkez hesabıyla aynı değildir.
4. Gerekiyorsa yerel yönetici panelinden taramaya izin verilen şirket klasörlerini tanımlayın. Merkez listesinde cihazı ve sonraki eşitlemede politika sürüm bildirimini kontrol edin. Raporlanan güncel sürüm tek başına gerçek kanal engelleme kanıtı değildir.

5. Kayıtlı Client lisansı kendi şirket Server'ından saatlik yeniler. Sunucuya erişim kesilirse son imzalı yetki en çok bir saat çalışır; süre bitince korumalı DLP işlemleri kilitlenir. Üretici lisans sunucusu Client bilgisayarlarına açılmaz.

## 3. BT ve bayi için otomatik Client kaydı (rc.43 ve sonrası)

rc.44 ve sonraki HTTPS Server panelinde şirket politikasını yayınlayıp **Yeni ajan kaydı → Client kayıt dosyasını indir** adımını kullanabilirsiniz. Merkezin yapılandırılmış HTTPS adresi ve tek kullanımlık anahtar `enrollment-request.json` dosyasına yazılır. Özel kurum CA'sı gerekiyorsa indirmeden önce **Özel kurum CA sertifikası kullanıyorum** bölümünde yalnızca açık PEM sertifikasını seçin. Parola veya MFA bilgisi dosyaya eklenmez. HTTP test panelinde dosya indirme kapalıdır.

İndirme sonrası anahtar ve sertifika seçimi ekrandan temizlenir. Anahtarın süresi dolarsa yeni kayıt oluşturun. İndirilen dosya tek Client içindir. rc.47 kayıt yardımcısında yerel dosyayı seçebilirsiniz; dosyayı çift tıklayarak çalıştırmayın. Aşağıdaki RMM/komut satırı yönteminde yetkili dağıtım aracı dosyayı korunan konuma, belirtilen sahiplik ve izinlerle yerleştirmelidir. Server adresi localhost/127.0.0.1 ise dosya yalnızca Server'ın kendisindeki test Client'ı için kullanılabilir; farklı bilgisayarlar için erişilebilir şirket HTTPS adı gerekir.

Her bilgisayar için merkezden ayrı, 15 dakika geçerli tek kullanımlık kayıt anahtarı alın. Kurulu Agent'ın korunan `%ProgramData%\KalkanDLP` klasörüne, yetkili dağıtım aracınızla UTF-8 bir `enrollment-request.json` dosyası yerleştirin. İçeriği:

```json
{
  "origin": "https://dlp.firma.example:9443",
  "token": "MERKEZDEN_ALINAN_64_KARAKTER_KUCUK_HARF_HEX_ANAHTAR"
}
```

Örnek token gerçek anahtarla değiştirilir. İsteğe bağlı `name` cihaz adıdır; verilmezse bilgisayar adı kullanılır. Özel kurum CA'sı için isteğe bağlı `caPem` alanına yalnızca açık PEM sertifikası eklenebilir (JSON satır sonları `\n`). Parola, yönetici hesabı, MFA/kurtarma kodu ve özel TLS anahtarı bu dosyaya konulmaz. Aynı kayıt dosyasını birden fazla bilgisayara dağıtmayın.

Dosyanın sahibi SYSTEM veya Administrators olmalı; sıradan kullanıcılara okuma/yazma izni verilmemelidir. Korunan üst klasör izinlerini genişletmeyin. Dosya doğrudan bu klasörde bulunmalı; paylaşımlı ağ veya kullanıcı klasöründen okunmaz. Kayıt aracı bu koşulları, paket bütünlüğünü ve kurulu özel hizmet hesabını denetler. Yönetici 64 bit, profil yüklemeyen dağıtım işlemiyle çalıştırın:

```powershell
$clientApp = "$env:ProgramFiles\KalkanDLP\versions\SURUM"
& "$clientApp\scripts\Register-Agent.ps1" -EnrollmentFile "$env:ProgramData\KalkanDLP\enrollment-request.json" -ValidateOnly
& "$clientApp\scripts\Register-Agent.ps1" -EnrollmentFile "$env:ProgramData\KalkanDLP\enrollment-request.json"
```

`ValidateOnly` kayıt anahtarını tüketmez ve hizmeti değiştirmez; sunucu bağlantısını veya anahtarın hâlâ geçerli olduğunu kanıtlamaz. Normal çalıştırmada gizli istem açılmaz; anahtar çocuk sürece standart girdiden iletilir, işlem argümanına yazılmaz. Dosya otomatik silinmez; başarılı kayıt sonrasında yetkili dağıtım aracınızla kaldırın. Kesinti sonrası aynı makinede `-Resume` kullanın; `EnrollmentFile` ile birleştirmeyin. Kayıt başarısızlığında hizmet yönetimsiz biçimde yeniden başlatılmaz. Gerçek SCM hesabında bu otomatik akışın kabulü ayrıca doğrulanmalıdır.

## 4. Kabul ve işletim

Destek kaydı için `scripts\Get-SupportStatus.ps1 -Role Server` veya `-Role Client` çalıştırın. JSON çıktısı yalnızca Windows sürümü, son açılış zamanı ve Kalkan hizmetlerinin kurulma/çalışma durumunu içerir. Yapılandırma, günlük, veritabanı, kullanıcı/makine adı ve anahtar dosyaları okunmaz. Çıktıyı inceleyip destek kaydına ekleyebilirsiniz. Bu durum raporu gerçek USB engellemesini veya lisans kabulünü kanıtlamaz.

- Önce üretim verisi olmayan test Windows üzerinde kurun. Standart kullanıcıyla kod/veri/TLS dosyalarının değiştirilemediğini ve özel verilerin okunamadığını kontrol edin.
- Windows'u yeniden başlatın; oturum açmadan hizmetlerin çalışmasını ve merkeze bağlantıyı doğrulayın. Fiziksel USB, SMTP ve desteklenen tarayıcı akışlarını ayrı deneyin. Sanal makinede fiziksel USB için aygıt yönlendirme ayrıca gerekir.
- Merkez sürümlerini yükseltmeden önce CENTRAL-RECOVERY.md içindeki çevrimdışı yedeği alın. rc.47 ve sonrasında Server setup yeni sürümü ayrı klasöre yerleştirir; mevcut TLS yapılandırması varsa paket ve yapılandırmayı doğruladıktan sonra hizmeti yeni sürüme geçirir ve sağlığını kontrol eder. Aynı sürüm onarımında dosyalar değiştirilmeden hizmet durdurulur. İlk kurulumda TLS yapılandırması yoksa yukarıdaki Configure/Validate/Install adımları gerekir. Hizmet geçişi başarısızsa önceki hizmet yapılandırması geri yüklenmeye çalışılır; veri şeması geri alınmaz. Veri şeması daha eski uygulamayla açılamayabilir; geri dönüş uyumlu yedek gerektirir.
- Windows Uygulamalar ekranından Server kaldırma hizmeti kaldırır, veritabanı ve TLS dosyalarını korur. Client kaldırma da şirket verisini korur. Veri silme ayrıca yetkili işletim işlemidir.
- Merkez günlükleri: `%ProgramData%\KalkanDLPCentral\Data\central-service.log`, `node-output.log`; istemci günlükleri `%ProgramData%\KalkanDLP\Data\agent.log`. Gizli anahtarları destek kaydına eklemeyin.

Yayıncı: MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN. Destek: destek@dkavis.com.tr. Bu kılavuz satış/genel yayın onayı değildir; eksik kabul kapıları PRODUCT-READINESS.md içinde izlenir.

## İlk yönetilen Server kurulumu

Server kurucusu dosyaları yerleştirdikten ve TLS dosyaları korumalı TLS klasörüne konduktan sonra, yeni müşteri makinesinde yönetici olarak aşağıdaki komutu çalıştırın. `$serverApp` kurulu Server sürümünün klasörüdür.

```powershell
& "$serverApp\scripts\Manage-CentralService.ps1" -Action Provision -AppRoot $serverApp -Origin "https://dlp.firma.example:9443" -CertificateFile "$env:ProgramData\KalkanDLPCentral\TLS\fullchain.pem" -PrivateKeyFile "$env:ProgramData\KalkanDLPCentral\TLS\private-key.pem"
```

Provision ilk HTTPS yapılandırmasını oluşturur, doğrular ve Server hizmetini başlatır. Mevcut Server yapılandırmasını korumak için daha önce hazırlanmış sunucularda Install akışını kullanın.

## Linux üzerinde yönetilen SaaS

SaaS merkezi Linux üzerinde Node.js 24 ile çalışır. Her müşteri için ayrı sunucu veya sanal makine, HTTPS alan adı, veri dizini ve Kalkan DLP üretici lisansı kullanın. Windows Client’lar müşterinin HTTPS adresine bağlanır.

1. Linux SaaS ZIP arşivini boş bir dizine çıkarın. Node.js 24 ile `node tools/verify-package.cjs .` komutunu çalıştırın. Doğrulama başarılıysa dosyaları `/opt/kalkan-dlp` altına yerleştirin ve o dizinde `npm ci --omit=dev --ignore-scripts` çalıştırın. Uygulama dosyalarının sahibi root olmalı ve hizmet hesabının yazma yetkisi bulunmamalıdır.
2. `kalkan-dlp` sistem kullanıcısını ve grubunu oluşturun. `deploy/server-config.example.json` dosyasını `/etc/kalkan-dlp/server-config.json` olarak kopyalayın. HTTPS adresini müşteri DNS adıyla değiştirin. Adres portu ile `port` alanı eşleşmelidir. Örnek port 9443’tür. Sertifika zincirini ve özel anahtarı örnekteki yollara yerleştirin. `/etc/kalkan-dlp` için `root:kalkan-dlp` ve `0750`, yapılandırma ve TLS dosyaları için `root:kalkan-dlp` ve `0640` kullanın. Veri dizinini systemd oluşturur.
3. `deploy/kalkan-dlp-central.service` dosyasını `/etc/systemd/system/` altına kopyalayın. Birim `/usr/bin/node` yolunu kullanır. `systemctl daemon-reload` ve `systemctl enable --now kalkan-dlp-central` çalıştırın. Açılış hatalarını `journalctl -u kalkan-dlp-central` ile inceleyin.
4. İlk yöneticiyi oluşturup MFA’yı etkinleştirin. Üretici lisansını ve ilk Client kaydını tamamlayın. Dış ağdan `/api/health` yanıtında HTTPS, beklenen sürüm ve `systemd` hizmet kipini doğrulayın.

Bu kurulum Linux SaaS merkezi içindir ve Microsoft sunucu lisansı gerektirmez. Canlıya geçmeden önce müşteri ortamında ilk Client kaydı, lisans yenileme ve şifreli yedekten geri dönüşü doğrulayın.
