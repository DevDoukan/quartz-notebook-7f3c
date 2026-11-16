# Merkezi Windows önizleme paketi

Merkez ZIP'i kendi doğrulanmış Node.js çalışma ortamını, üretim bağımlılıklarını, yönetim panelini, lisans bildirimlerini ve dosya özet manifestini içerir. Hedef bilgisayara ayrıca Node.js kurulması gerekmez. Bu paket henüz Windows hizmeti kuran veya imzalı ticari merkez kurulum programı değildir.

## Yerel deneme

ZIP'i yalnızca yetkili kullanıcının yazabildiği ayrı klasöre açın. `Merkez-Baslat.cmd` arka planda başlatır; `Merkez-Durdur.cmd` seçili veri klasörüne ait merkeze özel yerel kontrol anahtarıyla durdurur. Panel varsayılan olarak `http://127.0.0.1:4417` adresindedir. Paketli çalışmada veriler program klasörüne değil `%LOCALAPPDATA%\KalkanDLPCentral\Data` içine yazılır. İlk kurulum anahtarı bu veri klasöründeki `setup-key.txt` dosyasındadır. Kaynak çalışmada önceki `central-data` varsayılanı korunur.

Bir port başka veri klasörüne ait merkeze aitse kontrol aracı onu durdurmaz veya ikinci örnek gibi kullanmaz. Veritabanı kilidi aynı verilerle ikinci sunucuyu reddeder. Program klasörünü yükseltmek/silmek verileri silmez. Özel kontrol anahtarı yönetici/kullanıcı parolası veya ajan kayıt anahtarı değildir; yedek paketine konulmaz.

## Kurum için yapılandırma

Yalnızca yöneticinin değiştirebildiği bir JSON dosyası hazırlayın. `DLP_CENTRAL_SERVER_CONFIG` ortam değişkenini bu dosyanın tam yoluna ayarlayın. Göreli yollar JSON dosyasının klasörüne göre çözülür. Örnek alanlar:

```json
{
  "dataDir": "C:\\Korunan\\KalkanMerkezVerisi",
  "port": 9443,
  "origin": "https://merkez.example.com:9443",
  "tlsCertFile": "C:\\Korunan\\tls\\fullchain.pem",
  "tlsKeyFile": "C:\\Korunan\\tls\\private-key.pem",
  "requireMfa": true
}
```

Bu adres/dosyalar örnektir; gerçek DNS ve kuruma ait TLS dosyaları kullanılmalıdır. `caFile` yalnızca özel kurum CA'sı varsa kontrol aracına açık güven kökü dosyasını belirtir; doğrulamayı kapatmaz. Sertifika ve özel anahtar birlikte verilmelidir; port/adres uyumsuzluğu veya eksik TLS yapılandırması HTTP'ye düşürülmez, başlangıç reddedilir. Ortamın `DLP_CENTRAL_DATA_DIR`, `DLP_CENTRAL_PORT`, `DLP_CENTRAL_ORIGIN`, `DLP_CENTRAL_CERT`, `DLP_CENTRAL_KEY`, `DLP_CENTRAL_REQUIRE_MFA` değerleri dosya alanlarına üstün gelir.

TLS ile dış erişimde MFA varsayılan zorunludur. Yerel HTTP denemesi yalnızca loopback üzerinde dinler. Kontrol aracı HTTPS sertifikasını doğrular ve doğrudan loopback üzerinden sunucu adı/Host bilgisiyle bağlanır. Uzak HTTP kontrolüne izin verilmez. DNS, güvenlik duvarı, sertifika yenileme ve Windows klasör ACL'leri işletim sorumlusunca hazırlanıp kabul edilmelidir.

## Yayın sınırları

### Kaynakta geliştirilen hizmet kurulum aracı

`scripts/Manage-CentralService.ps1` için `Initialize`, `Validate`, `Install`, `Status` ve `Remove` işlemleri eklendi. Bunlar yönetici ayrıcalığıyla yapılacak gerçek kabul testleri tamamlanana kadar geliştirme adayıdır. Henüz mevcut rc.14 ZIP'inde bulunmazlar; yeni merkez derlemesine native yürütücü ve script dahil edilir. Araç program dosyalarını taşımaz; doğrulanmış merkez paketi önce `%ProgramFiles%\KalkanDLPCentral\versions\SURUM` altına açılmalıdır.

`Initialize`, merkez ortak klasörü ve hizmeti yoksa yalnızca SYSTEM/Administrators erişimli yeni ortak klasör ve onun altında TLS/Data klasörlerini oluşturur. Var olan ortak klasörü veya hizmeti değiştirmez. Yönetici, gerçek sertifika/özel anahtar dosyalarını bu TLS klasörüne, sunucu JSON'unu ortak kökte `server-config.json` dosyasına yerleştirir. JSON açık `port`, HTTPS `origin`, tam korunan `dataDir`, `tlsCertFile`, `tlsKeyFile` yolları ve `requireMfa: true` içermelidir. Özel kurum CA'sı varsa açık kök dosyası TLS klasöründe tutulup `caFile` ile gösterilir. Özel anahtar sohbet veya komut satırı argümanıyla iletilmez.

`Validate -AppRoot TAM_PAKET_YOLU`, hizmeti değiştirmeden kod/veri sahiplik ve ACL'lerini, reparse noktalarını, paket manifestini, paket Node imzasını ve TLS yapılandırmasını kontrol eder. `Install` aynı kontrollerden sonra ayrı sanal hizmet hesabı, kısıtlı hizmet hakları ve otomatik başlatma/yeniden başlatma ayarlarını uygular. Ortak yapılandırma ve TLS, hizmete salt okunur; yalnızca Data alanı değiştirilebilir olur. Açılan HTTPS merkezinin kimliği, Node PID'si, native yürütücü PID'si ve SCM PID'si eşleştirilir. `Remove` yalnızca kendi hizmet kaydını kaldırır; verileri ve TLS dosyalarını silmez. Sertifika yenileme ve tam işlem geri alma kabulü ayrıca sınanmalıdır.

Bu oturumda Windows PowerShell sözdizimi ve yetkisiz/untrusted yol çağrısının reddi doğrulandı. Gerçek `Initialize/Install`, ayrı standart kullanıcı ACL'leri, kurum TLS'si ve Windows yeniden başlatma testi henüz yapılmadı; otomatik ticari kurulum tamamlandı sayılmaz.

Kaynakta `KalkanDlpCentral.exe` için ayrı native hizmet yürütücüsü geliştiriliyor. `tools/build-agent.ps1`, ortak süreç gözetim kodunu merkez profiliyle ayrıca derler. Profil program kökü olarak `%ProgramFiles%\KalkanDLPCentral`, veri olarak `%ProgramData%\KalkanDLPCentral\Data`, yürütücü yapılandırması olarak aynı ortak kökte `central-service.json`, sunucu yapılandırması olarak `server-config.json` ve Windows kimliği olarak `NT SERVICE\KalkanDlpCentral` ister. Başka bir hizmet hesabıyla üretim kipinde başlatmayı reddeder. Bu yollar kurulum aracı yerine elle hazırlanması önerilen bir kurulum tarifi değildir; korunan ACL/SCM kurulum aracı henüz tamamlanmadı.

Merkez profili Node sürecini askıda oluşturur, çalıştırmadan önce Job Object'e bağlar; bellek/süreç sayısı ve yeniden başlatma sınırı uygular. Üst süreçten gelen `DLP_*`, `NODE_OPTIONS` ve `NODE_PATH` ayarlarını taşımaz; korunan yapılandırma, veri/port ve zorunlu MFA'yı kendisi belirtir. Hizmet kipinde TLS olmadan başlamaz. Hizmet durdurmada aynı korunan veri klasöründeki kontrol anahtarına bağlı istek dosyasıyla sunucu/veritabanı temiz kapatılır; süre sonunda kalan alt süreçler Job Object kapanışıyla sonlandırılır. Taşınabilir kontrol aracı hizmet kipindeki örneği durdurmaz; hizmet yaşam döngüsü yürütücü üzerinden yönetilir.

`tests/native-central.test.js` ayrı geçici klasörde, TLS test sertifikasıyla gerçek Node merkezini **konsol test kipinde** çalıştırır. Ortam değişkeni temizliği, zorunlu MFA, yanlış durdurma isteğinin reddi, gerçek alt süreç çökmesi/yeniden başlatma, hesap korunması, alt süreç temizliği ve veritabanı kilidinin temiz kaldırılması sınanır. Bu test gerçek SCM kurulumu, hizmet ACL'leri, oturum açılmadan başlatma veya yeniden başlatma kabulü değildir. Merkez ZIP'i bu yürütücüyü henüz içermiyor.

Otomatik Windows hizmeti kurulumu, oturum açılmadan çalışma, merkez lisans dağıtımı, güvenli otomatik güncelleme, harici kabul/yük testi ve bağımsız inceleme tamamlanmadı. ZIP bir önizleme dağıtımıdır; bunların yerine geçmez. Merkez yedekleme ve geri dönüş adımları CENTRAL-RECOVERY.md dosyasındadır. Önceki sürüme dönüş, uyumlu yedek gerektirir.

Derleme: `powershell -File tools/build-central.ps1`. Çıktı adı sürümlüdür, mevcut ZIP üzerine yazılmaz. `npm run test:central-package` ZIP'i ayrı klasöre açar, manifesti doğrular, sistem Node yolunu boşaltarak paket Node'u ile gerçek merkez başlatır, çalışan sürecin yolunu denetler ve TLS üzerinden panel/kontrol/ilk hesap işlemlerini sınar. Program klasörü taşındığında ayrı veri klasöründeki hesabın korunduğu da doğrulanır. Test TLS sertifikası yalnızca testte açıkça güvenilir CA olarak verilir; pakete veya Windows güven deposuna kurulmaz.

`npm run test:release` merkez ZIP'inin güncel kaynakla derlenmiş olmasını gerektirir; birim/entegrasyon, ajan/eklenti tarayıcısı, merkez tarayıcısı, merkez dağıtımı ve ajan kayıt tarayıcısı olmak üzere beş aşama birlikte geçmelidir.
