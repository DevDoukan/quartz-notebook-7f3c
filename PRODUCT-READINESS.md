# Satışa hazırlık ölçütleri

Hedef: Windows kullanan şirketlerin BT ekipleri ve BT hizmeti veren bayiler. Yayıncı: MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN. Destek: destek@dkavis.com.tr. Mevcut geliştirme sürümü ticari genel yayına hazır değildir.

## Tamamlanması ve kanıtlanması gerekenler

- [x] İlk yönetici kurulumu, parola ile giriş, yetki rolleri ve oturum iptali
- [x] Politika, USB yönetimi, lisans ve kullanıcı işlemlerinde sunucu taraflı yetki kontrolü
- [x] Kayıtların bütünlük kontrolü, güvenli yedekleme ve geri yükleme testi
- [x] Satıcıya ait anahtarla imzalı lisans, süre sonu davranışı ve anahtarların teslim paketinden ayrılması
- [x] Client'ın üreticiye bağlanmadan şirket Server'ından imzalı ve süreli cihaz yetkisi alması
- [x] Paylaşımlı PHP hosting için üretici lisans API'si ve imzalı üretici yönetim komutu
- [x] Yerel PHP 8 lisans servisi entegrasyonu: imzalı oluşturma/iptal, idempotent yönetim komutu, şifreli yanıt önbelleği, sunucu kimliği doğrulaması ve imzalı kiralama
- [x] Merkez şirket politikasında makine Agent'ına imzalı Windows USB salt-okunur ayarı gönderme; merkez kaydında yerel panel/API geçersiz kılmasını kapatma
- [x] Canlı lisans subdomaini, DNS/SSL, hosting izinleri ve PHP-Sodium-SQLite çalışma kabulü
- [x] Canlı üretici anahtarının web kökü dışına güvenli yerleştirilmesi ve açık anahtar eşleşmesi
- [ ] Üretici özel anahtarının şifreli çevrimdışı yedeği ve geri yükleme kabulü
- [ ] İlk panel yöneticisi kurulumu ve lisans işlemlerinin panel arayüzünden kabulü
- [ ] Müşteri şirket Server'ında temiz Windows kurulumuyla üretici lisansı kabulü
- [ ] Yeni Client/Server kurulum paketlerinin üretilmesi ve ayrı Windows makinesinde uçtan uca lisans kabulü
- [x] Node.js kurulumunu müşteriden istemeyen Windows kurulum/kaldırma paketi
- [ ] Sürüm yükseltme, veri göçü, önceki sürüme dönüş ve temiz makine testi
- [ ] İmzalı sürüm dosyaları, bağımlılık envanteri ve üçüncü taraf lisans bildirimleri
- [ ] USB denetiminin fiziksel aygıt ve hedef Windows sürümlerinde doğrulanması
- [ ] SMTP sağlayıcısı ile gerçek bağlantı, gönderim ve hata senaryoları
- [ ] Klasik ve Yeni Outlook’ta gönderim öncesi denetim ve kesin engelleme. Sürüm ve hesap destek matrisi, kurumsal eklenti dağıtımı, engellenen iletinin alıcıya ulaşmadığına dair kanıt ve doğru şirketteki olay kaydı gerekli.
- [ ] Linux SaaS paketinin gerçek systemd ortamında kurulması, kurumsal HTTPS, lisans yenileme, çok cihazlı politika akışı ve şifreli yedekten geri yükleme
- [ ] Uzantı dağıtım yöntemi, desteklenen site akışları ve devre dışı bırakılma davranışı
- [ ] Büyük dosya, bozuk belge, eşzamanlı istek, kesinti ve kaynak tüketimi testleri
- [ ] Bağımsız güvenlik incelemesi ve kritik bulguların kapatılması
- [ ] Satıcı kimliği, destek kanalı, ürün kapsamı, müşteri koşulları ve ticari sürüm onayı
- [ ] Windows ajanının oturum açılmadan çalışma, kapatılmaya direnç ve sistem genelinde USB politikası kapsamı
- [ ] Bayi, müşteri ve cihaz bazında ayrılmış merkezi yönetim, yetkilendirme ve lisans akışları

Geliştirme testlerinin geçmesi, fiziksel aygıt, müşteri sağlayıcısı, kod imzalama veya ticari onay kapılarını tamamlamaz. Bu kapılar ayrı kanıt gerektirir. Kaynak ZIP'i ticari kurulum paketi veya sistem genelinde DLP koruması olarak tanıtmayacağız.

## Toplanan kanıt

29 Ekim 2026: `npm test` ile ilk kurulum, rol yetkisi, parola/oturum iptali, denetim zinciri değişikliği, kesintili kayıt kurtarma, şifreli yedek geri yükleme ve lisans testleri geçti. `npm run test:ui` ile gerçek Edge uzantısı ve masaüstü/mobil panel kontrol edildi.

Windows kurulum adayı ayrı test klasörüne kuruldu. Sistem Node.js yerine paket içindeki `runtime/node.exe` ile çalıştığı işlem yolu üzerinden doğrulandı. Kurulu sürümde ilk yönetici ve PDF ayrıştırma denendi. 1.637 paket dosyasının SHA256 değeri kontrol edildi. Kaldırma günlükte başarılı tamamlandı, program çalışma ortamı kaldırıldı ve veri klasörü korundu. Bu test mevcut geliştirme bilgisayarındadır, temiz başka Windows makinesi testi değildir.

Inno Setup derleyicisi mevcut ortamda “Non-commercial use only” bildiriyor. Ticari paket yayını için derleyicinin uygun kullanım lisansı veya alternatif derleyici gerekir. Ürün kurulum adayı henüz Authenticode imzalı değildir.

Yükseltme yaşam döngüsü denemesi önceki sürümü kurup yeni sürüme geçerek kullanıcı, politika, kurulum kimliği ve denetim zincirinin korunduğunu doğrular. Güncel ve kaynak parmak izine bağlı kanıtlar `.test-artifacts/release-tests.json` ile `.test-artifacts/installer-lifecycle.json` dosyalarındadır. `npm run check:commercial` eksik kapılar varsa başarısız çıkar. Bu sonuç bilinçli olarak genel yayın onayı yerine geçmez.

## Mevcut kapsam

1.2.0-rc.1 kaynaklarında merkezi şirket ayrımı, bayi/şirket paneli, HTTPS ajan iletişimi, Ed25519 politika doğrulaması, çevrimdışı politika/olay kuyruğu, kullanıcı erişim yaşam döngüsü ve TOTP MFA eklendi. Merkezi çevrimdışı yedekten gerçek sunucu başlatma, aynı cihazla imzalı politika alma ve MFA kurtarma koduyla giriş test edildi. Ayrıntılar CENTRAL-MANAGEMENT.md ve CENTRAL-RECOVERY.md içinde yer alır. Bunlar merkez kurulum/lisans dağıtımını, zamanlanmış yedeği veya ayrı makinedeki kabul testini tamamlamaz. Önceki installer raporları yeni kaynağın paket kanıtı olarak kullanılamaz.

Gerçek dosya tarama, PDF/DOCX okuma, uygulama içinden SMTP ve USB aktarımında politika kararı, Windows kayıt defteri üzerinden merkezi USB depolama salt-okunur ayarı, seçili sitelerde standart HTML formu ve dosya seçiminde uzantı kontrolü. Windows filtre sürücüsü ve tüm ağ trafiğini yakalayan bir katman henüz yoktur. Salt-okunur USB ayarının fiziksel cihaz etkisi ayrıca test edilmelidir. Bu eksikler ürünün satışta kullanılabilecek koruma iddiasını sınırlar.

31 Ekim 2026: Önce yerel PHP 8.0 + Sodium + PDO SQLite üzerinde lisans akışı kabul edildi. Ardından canlı `lisans.kalkandlp.com.tr` üzerinde imzalı lisans oluşturma, yenileme, Ed25519 kiralama belgesini doğrulama ve iptal akışı tamamlandı; deneme lisansları iptal edilmiş durumda. Canlı PHP 8.3.36, Sodium, PDO SQLite, özel yapılandırma/anahtar erişimi ve veritabanı yazımı doğrulandı. Yanlış kodlanmış satır sonu taşıyan açık anahtar dosyası düzeltildi. Yönetim panelinin ilk hesabı ve müşteri Windows Server'ı üzerinden kabul hâlâ açık.

XLSX ve kodlanmış EML için okuyucular eklendi. Metin bölme/kaçış, hücre/formül, MIME gövde ve desteklenen ek senaryoları ile ZIP/XML/derinlik sınırları test edildi. Gömülü görsel/ikili içerik ve eski/şifreli Office türleri temiz sayılmaz. Kurum belgeleriyle kapsamlı uyumluluk ve yanlış alarm/kaçırma ölçümü ayrı kabul gerektirir. Ayrıntılar DOCUMENT-FORMATS.md içindedir.

Native ajan gözetimi, duraklatılmış süreç oluşturma ve Windows Job Object kullanımı, çökme sınırı ve alt süreç temizliği konsol testinde doğrulandı. Açılmış dosya/klasör nesnesine bağlı okuma, klasör sınırı ve hard link/junction kaçış testleri geçti. Makine kurulum adayı ayrı sanal Windows hizmeti hesabını, Program Files kod alanını ve ProgramData veri alanını yapılandırır. Bu oturum yönetici olmadığından gerçek SCM kurulumu, ayrı standart Windows kullanıcısı ve yeniden başlatma testleri henüz tamamlanmadı. Konsol testleri bu kabul kapılarını tamamlamaz.
