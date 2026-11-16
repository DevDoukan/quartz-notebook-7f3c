# Sürüm geçmişi

## 1.2.0-rc.48 geliştirme adayı

- Paket bütünlüğü denetimi, manifestte bulunmayan ek dosyaları ve bağlantı noktalarını da reddeder. Dosya hash'lerinin eşleşmesi tek başına yeterli kabul edilmez.
- Windows'ta aynı dosyaya karşılık gelen yinelenen yollar, alternatif veri akışı ve nokta/boşlukla biten yol adları, geçersiz hash/boyut alanları ve alt klasörlere gizlenmiş bilinen özel anahtar/etkinleştirme dosyaları reddedilir.
- Ek çalıştırılabilir dosya, yol takma adları, özel dosya ve junction senaryoları için regresyon kontrolleri eklendi. Bu kontrol imzalı yayıncı doğrulamasının yerini tutmaz.

## 1.2.0-rc.47 geliştirme adayı

- Makine Client kurucusuna Windows yönetici onayıyla çalışan kayıt yardımcısı eklendi. Tek kullanımlık JSON dosyası seçilir, HTTPS adresi ve cihaz adı incelenir; kayıt anahtarı ekranda veya işlem argümanlarında gösterilmez. Kesintiden devam ve mevcut kimliği koruma akışları bulunur.
- Kayıt dosyası tek yerel dosya tutamacıyla okunur; bağlantı, yeniden ayrıştırma noktası, ağ yolu ve boyut kontrolleri uygulanır. Yardımcının geçici isteği yalnızca yönetici/SYSTEM erişimiyle oluşturulur ve işlem sonunda temizlenir. Kullanıcının seçtiği asıl dosya korunur.
- Server yükseltmesi, mevcut TLS yapılandırması varsa yeni sürümü doğrulayıp hizmete geçirir. Farklı sürüme yükseltirken eski hizmet yeni paket hazır olana kadar çalışır; başarısız hizmet geçişinde eski hizmet yapılandırmasına dönüş denenir. Veri şeması için uyumlu yedek hâlâ gereklidir.
- Gerçek Windows kurulum, yeniden başlatma ve kayıt yardımcısı kabulü ayrıca izlenir; bu değişiklikler satışa hazır olunduğu anlamına gelmez.

## 1.2.0-rc.46 geliştirme adayı

- Geliştirme minifilter'ında tam dosya temiz kararları için en fazla bir saniyelik stream önbelleği eklendi. Küçük ardışık okumalar aynı dosyayı tekrar tekrar ayrıştırmak zorunda kalmaz.
- Önbellek birim değişim nesli, politika revizyonu ve yeniden yetkilendirme nesline bağlıdır; her isabette canlı politika tazeliği tekrar denetlenir. Başarısız incelemeler temiz karar kaydetmez ve isabetler süreyi uzatmaz.
- WDK statik analiz ve native protokol testleri geçti. Yüklü sürücü kabulü, PC'den USB'ye tam dosya çıkış kararı ve kalan kapsam açık kalır; SYS müşteri kurucularına eklenmedi.

## 1.2.0-rc.44 geliştirme adayı

- HTTPS merkez panelinden tek kullanımlık Client kayıt JSON dosyası indirme eklendi. Dosyada yapılandırılmış merkez adresi, tek kullanımlık anahtar ve isteğe bağlı açık kurum CA sertifikası bulunur.
- Özel anahtar ve 64 KB üzeri sertifika dosyaları indirmeden reddedilir. İndirme, şirket/oturum değişimi ve süre sonunda ekrandaki kayıt bilgileri temizlenir; HTTP test paneli için kayıt dosyası oluşturulmaz.
- Gerçek HTTPS üzerinden tarayıcı indirmesi, indirilen dosyayla kayıt, aynı anahtarın tekrar reddi, politika heartbeat'i, klavye/mobil kullanım ve süre sonu temizliği sınandı.

## 1.2.0-rc.43 geliştirme adayı

- Client kaydı için `Register-Agent.ps1 -EnrollmentFile` eklendi. BT dağıtımı, korunan makine klasöründeki tek kullanımlık istekle gizli istem açmadan yapılabilir; yönetici parolası gerekmez.
- Kayıt dosyasının konumu, sahipliği, erişim izinleri, boyutu ve JSON alanları denetlenir. Dosya anahtarı işlem argümanlarına veya doğrulama hatalarına yazılmaz; mevcut makine kimliğinin üzerine yazılmaz.
- Kurulum README'sine toplu dağıtım, ön kontrol, dosya temizliği ve kesintiden devam adımları eklendi. Gerçek Windows hizmeti kabulü açık kalır.

## 1.2.0-rc.42 geliştirme adayı

- Makine Client kayıt aracı, 64 KB'ye kadar açık kurum CA paketini standart girdiden kabul eder. Önceki 16 KB istek sınırının geçerli CA paketlerini reddetmesi giderildi.
- Parçalı standart girdide Türkçe cihaz adları UTF-8 olarak korunur; bozuk UTF-8, aşırı büyük istek ve CA dosyaları kimlik oluşturmadan reddedilir.
- Gerçek HTTPS kayıt yanıtıyla CLI regresyon testleri eklendi. Bunlar Windows hizmeti, yeniden başlatma veya fiziksel USB kabulünün yerine geçmez.

## 1.2.0-rc.25 geliştirme adayı

- Merkez şirket politikasına USB depolama için isteğe bağlı Windows salt-okunur ayarı eklendi. İmzalı politika makine Agent hizmetinde uygulanır, çevrimdışı yeniden başlatmada önbellekten sürdürülür ve yerel API geçersiz kılması reddedilir.
- Merkez arayüzü ayarı "değiştirme / yazmayı engelle / yazmaya izin ver" seçenekleriyle sunar ve ayarın dosya içeriğini taramadığını açıkça belirtir.
- Sürüm testleri gerçek imzalı merkez yanıtıyla USB kuralı uygulamasını, tekrar eşitlemesini ve istemci panelindeki yerel değişiklik kilidini kapsar.

## 1.2.0-rc.24 geliştirme adayı

- PHP lisans servisi, tekrar denenebilir imzalı provision komutlarının yanıtlarını SQLite'ta Sodium secretbox ile şifreli tutuyor; aktivasyon kimlik bilgisi düz metin veritabanı önbelleğine yazılmıyor.
- PHP uçtan uca testi disk üzerindeki SQLite ve WAL içinde lisans anahtarının düz metin bulunmadığını doğruluyor.
- Kurulum README'si eski rc.15 paketlerine dair yanıltıcı uyarıdan arındırıldı; dağıtım için en güncel Client, Server ve lisans hizmeti paketlerini seçmeyi belirtiyor.

## 1.2.0-rc.23 geliştirme adayı

- Ticari hazır olma kapısı eski masaüstü makbuzu yerine güncel Client Agent ve Server kurulum paketlerini doğruluyor; Server paket makbuzu ayrıca denetleniyor.

## 1.2.0-rc.22 geliştirme adayı

- PHP lisans hizmeti için yerel uçtan uca kabul testi eklendi: imzalı oluşturma/iptal, tekrar güvenliği, sunucu kimliği ve lisans imzası doğrulanıyor.
- PHP lisans testi sürüm test kapısına bağlandı; lisans hizmeti `Sodium` ve `PDO SQLite` ile gerçek PHP 8 çalıştırıcısında doğrulanıyor.

## 1.2.0-rc.21 geliştirme adayı

- Uçtan uca tarayıcı testinde üretici imza anahtarı yalnızca yerel TLS test ortamında enjekte edilebilir hale getirildi; gerçek Client enrollment/kurtarma/politika akışı lisanslı bir test server'ıyla doğrulanıyor.

## 1.2.0-rc.20 geliştirme adayı

- İstemci/Sunucu lisans geçişi, mevcut kurulumların üretici kimliğini güvenli biçimde öğrenmesi ve imzalı Client yetkisi UI'ı düzeltildi; Windows PHP runtime anahtar nesnesi uyumluluğu giderildi.
- Lisanssız merkez testlerinin yerel deneme lisansına düşmeden korumalı işlemleri reddetmesi doğrulandı.

## 1.2.0-rc.19 geliştirme adayı

- OV sertifika geldiğinde merkez yürütücüsü, Server setup'ı ve Client Agent setup'ını aynı yayıncı kimliğiyle imzalayan derleme zinciri eklendi. Sertifika yokken paketler açıkça unsigned kalır.

## 1.2.0-rc.18 geliştirme adayı

- Merkezi lisansın istemci ekranında doğru gösterimi; kayıtlı Client'larda yerel lisans formu gizlenir ve merkez yetkisi/son kullanma bilgisi görünür.

## 1.2.0-rc.17 geliştirme adayı

- Üretici lisans API'si paylaşımlı DirectAdmin/PHP 8.3 hosting için PHP/Sodium/SQLite olarak hazırlandı; üretici komutları Ed25519 imzalı HTTPS istekleriyle lisans oluşturur, yeniler ve iptal eder.
- Ayrı üretici Ed25519 açık anahtarı üretildi ve Client/Server paketlerine sabitlenmek üzere eklendi. Ürün dosyalarındaki eski endpoint lisans anahtarıyla karıştırılmaz.
- Client kayıt yanıtı ve imzalı heartbeat sunucu lisans kimliğini taşır. Client üretici anahtarını doğrular, imzalı entitlement'ı önbelleğe alır ve geçerli yetki yokken korumalı DLP işlemlerini durdurur.
- DirectAdmin PHP servis dağıtım yönergesi ve ayrı ZIP paket oluşturma aracı eklendi. Canlı DNS/SSL/API ve ayrı Windows kabulü açık.

## Henüz paketlenmemiş kaynak değişiklikleri

- Üretici imzalı sunucu lisansı, sunucu genelinde cihaz kotası ve HTTPS yenileme istemcisi; ağ/TLS/sahte imza/kapasite testleri. Üretici servisi ve varsayılan üretim entegrasyonu henüz tamamlanmadı.

- Merkez için korunan durum dizini hazırlama ve ayrı hizmet hesabıyla kurulum/denetim/kaldırma aracı; yeni merkez derlemelerine yürütücü/script ekleme. Gerçek yönetici kurulumu ve yeniden başlatma kabulü açık.

- Merkez için ayrı derlenen native Windows hizmet yürütücüsü; TLS/MFA zorunluluğu, ortam temizliği, Job Object ve kontrollü durdurma.
- Gerçek Node/TLS merkeziyle konsol kipinde çökme/yeniden başlatma ve temiz kapanma testi. Korumalı SCM kurulum aracı ve gerçek hizmet kabulü henüz tamamlanmadı.

## 1.2.0-rc.14 geliştirme adayı

- Olay alımındaki tam kayıt sayımlarını transaction ile tutulan şirket/genel sayaçlarla değiştirme; açılışta eski veriden sayaç göçü ve tutarlılık kontrolü.
- 900.000 sentetik olay üzerinde yerel HTTP yük kontrolü ve bir milyon olay genel kapasite senaryosu.

- Ajanın doğruladığı politika sürümü/özeti, ürün sürümü ve olay kuyruğunun kimliği doğrulanmış durum raporu.
- Merkez cihaz listesinde eksik/eski/uyuşmayan raporların ve rapor zamanının gösterilmesi. Bildirim, gerçek kanal engelleme kanıtı değildir.

## 1.2.0-rc.13 geliştirme adayı

- Şirket bazında olay saklama süresi, açık silme onayı ve olay kapasitesi; merkez toplam olay sınırı.
- Sınırda HTTP 507 ile ajan kuyruğunu koruma; aynı kimlikli farklı olay içeriğini reddetme.
- Kademeli zamanlanmış temizlik, aynı işlemde imzalı denetim niyeti ve panelde kapasite/yönetim geçmişi.
- Windows sürücü araç zinciri için salt okunur önkoşul raporu; sistem genelinde minifilter koruması henüz uygulanmadı.

## 1.2.0-rc.12 geliştirme adayı

- Masaüstü ajanının merkez kimliği ve bekleyen kayıt dosyasını şifreli yedeğe dahil etme; kimlik/veritabanı ve önbellekteki politika imzasını doğrulama.
- Geri yüklemeyi geçici kardeş klasörde doğrulayıp tamamlanınca hedefe taşıma; hatalı yedeğin kullanılabilir kısmi kurulum bırakmasını engelleme.
- Hizmet ve harici yapılandırma kimliklerinin panel yedeğinden ayrı tutulması.

## 1.2.0-rc.11 geliştirme adayı

- Windows yöneticisi için korunan makine kayıt aracı; gizli anahtar istemi, standart girdi, kayıt gereklilik işareti ve hizmet süreç eşleştirmesi.
- Üretim hizmetinde Common kimlik/kurulum alanını dosya aracısı okuma/listesinden çıkarma.
- Normal kullanıcı SID'sine ait/yazılabilir kodu ve özel hizmet durumunda beklenmedik okuma erişimini reddetme.
- Hizmet USB yardımcısında süreç kapsamlı PowerShell çalıştırma ayarı; sıradan tokenla kimlik reddi testi.
- Derleme sırasında kaynak değişirse paket makbuzu oluşturmayı reddetme.
- Gerçek yöneticiyle tam hizmet kayıt/yeniden başlatma kabulü henüz tamamlanmadı.

## 1.2.0-rc.9 geliştirme adayı

- Yanıt kaybında aynı cihaz kaydını sürdürme; istek/cihaz kimliğini ağ isteğinden önce korunan bekleme dosyasına yazma.
- Kayıt tekrarını anahtar/istek/sır/adına bağlama, etkin cihaz sırrıyla kimlik kurtarma ve iptal edilmiş cihazı reddetme.
- NTFS üzerinde kısmi hedef dosyası oluşturmadan kimlik tamamlama; bekleyen dosya kaybında yerel politikaya düşmeyi engelleme.

## 1.2.0-rc.7 geliştirme adayı

- Yerel kullanıcı ajanı için HTTPS merkez kayıt formu, özel CA yükleme, kayıt anahtarını temizleme ve bağlantı yenileme.
- İlk merkez politikası gelmeden işlem reddi; bağlantı dosyası kaybında yerel politikaya düşmeyi engelleme.
- Web/CLI kayıt yanıtı doğrulamasını birleştirme; kimlik üzerine yazmayı reddetme.
- Windows hizmetinin korunan makine kayıt akışı ve uçtan uca kayıt tekilleştirmesi henüz tamamlanmadı.

## 1.2.0-rc.6 geliştirme adayı

- Ayrı Node çalışma ortamlı merkezi Windows ZIP önizlemesi; veri klasöründen ayrı program dağıtımı.
- Dosyadan TLS/port/veri/MFA yapılandırması, eksik TLS'de başlangıcın reddi.
- Merkeze özel loopback kontrol anahtarıyla başlatma/durdurma ve başka veri klasörüne ait merkezi durdurmayı reddetme.
- ZIP'ten çıkarılmış gerçek paket, sistem Node'u olmadan çalışma, Unicode yol ve HTTPS kabul testi.

## 1.2.0-rc.3 geliştirme adayı

- Merkezi şirket/politika/üyelik/ajan değişikliğini imzalı denetim kuyruğuyla aynı işlemde tamamlama; kesintiden sonra tekil teslim.
- Kuyruk düzenleme/silme kontrolü ve şirket bazında yönetim geçmişi ekranı.
- Kullanıcı/parola/MFA değişikliği ve oturum iptalini imzalı güvenlik olayıyla birlikte tamamlama; hatada geri alma ve yeniden başlatmada tekil teslim.
- Veri şeması 3: eski okuyucunun yeni veriyi açmasını reddetme.

## 1.2.0-rc.1 geliştirme adayı

- Ayrı merkezi sunucu ve bayi/şirket paneli; şirket bazında cihaz, politika, olay ve kullanıcı erişimi.
- HTTPS ajan kaydı, tek kullanımlık anahtar, imzalı/sürümlü politika, kalıcı çevrimdışı olay kuyruğu.
- Kullanıcı hesabını kapatma/açma, şirket üyeliğini kaldırma ve bekleyen kayıt anahtarlarını iptal etme.
- Doğrulama uygulamasıyla TOTP MFA, şifreli sır saklama, tek kullanımlık kurtarma kodları ve tekrar kullanım engeli. HTTPS merkezinde varsayılan zorunlu kurulum.
- Merkezi veritabanları ve kimlik anahtarları için çevrimdışı şifreli yedekleme ve doğrulanmış yeni klasöre geri yükleme.
- XLSX hücre/formül metni ve MIME/Base64/quoted-printable EML gövde/ek çözümleme; ZIP/XML/ek derinliği sınırları ve okunamayan dosyada aktarım reddi.
- Windows hizmeti gözetmeni ve dosya tanıtıcısına bağlı erişim aracısı; makine kurulumu gerçek yönetici ortamında henüz kabul edilmedi.

Bu kaynak sürümü yeni bir imzalı satış paketi değildir. Güncel kaynak için paketleme, yaşam döngüsü ve harici kabul kanıtları ayrıca üretilmelidir.

## 1.1.0 sürüm adayı

- İlk yönetici için tek kullanımlık yerel kurulum anahtarı. Varsayılan hesap veya parola yok.
- Scrypt ile parola saklama, HttpOnly/SameSite oturum, oturum süresi, giriş deneme sınırı ve CSRF kontrolü.
- Yönetici, operatör ve denetçi rolleri. Kullanıcı devre dışı bırakma ve parola değişikliğinde oturum iptali.
- HMAC ile denetim zinciri, zincir sonu kontrolü ve kesinti sonrası bekleyen işlem kurtarma.
- AES-256-GCM ile parolalı yedek ve boş veri klasörüne çevrimdışı geri yükleme.
- Kurulum kimliğine bağlı Ed25519 imzalı lisans ve 14 günlük deneme.
- Süre sonunda rapor erişimini koruyarak yeni işlem başlatmayı durdurma.
- Üretim bağımlılıkları ve Node.js çalışma ortamını içeren Windows kurulum adayı.
- Sürümlü uygulama klasörleri, veri klasöründen ayrı kurulum, kaldırmada veri koruma.

Ticari yayın, imza ve gerçek ortam kabul kapıları PRODUCT-READINESS.md içinde izlenir.
