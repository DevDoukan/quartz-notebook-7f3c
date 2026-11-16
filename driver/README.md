# Kalkan filtre sürücüsü — geliştirme durumu

Derleme: `tools\build-driver.ps1 -EwdkRoot E:\`. Bağlı EWDK sürücü harfi farklıysa değiştirin. Araç protokol testini, SYS ve native araçları WDK/MSVC statik analizle derler; çıktı hash'lerini `.test-artifacts/kalkan-driver-build.json` içinde tutar. Başarısız derleme eski kanıtı geçersiz kılar.

## Bağlanan akış

- InstanceSetup birimin sabit Windows özelliklerini bağlama alır. Taşınabilir aygıt ve çıkarılabilir medya adaydır; bu sınıflar kesin USB veri yolu tespiti değildir. Ağ/yerel/bilinmeyen ayrı tutulur.
- Aday birimlerde normal IRP_MJ_READ mevcut dosya nesnesini tarar. Fast I/O, IRP yoluna geri yönlendirilir. Hata, eksik tarama veya izin dışı sonuç ACCESS_DENIED döndürür. Başlangıçta politika kullanılamaz durumdadır; ilk geçerli politika gelmeden kapsamdaki normal okuma reddedilir. Bu başlangıç davranışı yüklenmiş sürücüde henüz doğrulanmadı. Alıcıdan politika yenilemesi beş saniye kesilirse yeni tarama izni üretilmez. Paging/özyinelemeli veya uygun yürütme düzeyi olmayan okumalar senkron taramaya girmez ve mevcut geliştirme yolunda reddedilir; bu yollar için üretim kullanılabilirliği tamamlanmamıştır.
- Birim başına IoGate, taramanın başından gerçek okumanın post-callback'ine kadar değiştirme kabulünü engeller. Create/write/set-information/FSCTL ve yazılabilir section olayları bu kapıya bağlıdır. Yazılabilir section görülmüş birime temiz okuma varsayılmaz. Daha önce var olan eşlemeler ve tüm section yaşam döngüsü henüz kapsanmıyor.
- İçerik birim başına IoGate nesliyle doğrulanır; başka birimdeki değişiklik bu nesli değiştirmez. Genel sayaçlar yalnızca tanı bilgisidir. Performans ve kullanılabilirlik kabulü yapılmadı. Salt derleme bu akışın gerçek makinede çalıştığını kanıtlamaz.
- Tam dosya incelemesinin temiz sonucu, dosya sistemi stream context'inde en çok bir saniye önbelleğe alınır. Anahtar birim nesli, politika revizyonu ve yeniden yetkilendirme neslidir. Gerçek okuma tamamlanana kadar birim okuma kapısı tutulur; her isabette güncel politika/yetki tazeliği tekrar denetlenir. İsabet önbellek süresini uzatmaz. Bağlam yoksa tam inceleme yapılır; hata veya eksik tarama temiz karar kaydetmez. Yüklü sürücüde performans ve yarış kabulü henüz yapılmadı.
- ScanReceiver --stdio, filtre isteğini miras alınmış özel pipe üzerinden Node'a iletir. Node driver-scanner en fazla sekiz 10 MB tamponla bütün dosyayı birleştirir; metin/PDF/DOCX/XLSX okuyucularını çalıştırır. Belirsiz arşivler, gömülü ikili içerik ve zaman aşımı izin vermez. Yalnızca son, tam dosya yanıtı PARSER_COMPLETE taşır.
- Politika/Client yetkisi doğrulamasını central.scanPolicy yapar. Native alıcı bunu sürücüye aktarır; eski revizyon reddedilir, bağlantı kaybı ve yetki değişimi eski kararları geçersiz kılar. Sürücü kendisi merkezi imzayı çözümlemez; yerel port yalnızca SYSTEM ve KalkanDlpAgent SID'sine açıktır.
- createApp({driverReceiverPath}) yalnızca açık geliştirme bağlantısıdır. HTTP veya ortamdan EXE seçilmez. Kapanış alt sürecin bitmesini bekler. Sağlık API'sinde süreç durumu ayrı gösterilir; protectionActive henüz false kalır.

## Kanıtın kapsamı ve kalanlar

PC'den USB'ye içerik bazlı çıkış engellemesi henüz bağlı değildir. PreRead aday USB/çıkarılabilir birimdeki okumayı inceler; PreMutation ise eşzamanlı değiştirme kabulünü yönetir, hedefe yazılan tam dosyayı içerik kararından sonra yayımlayan bir mekanizma değildir. Windows USB salt-okunur kuralı ayrı bir katmandır ve seçildiğinde tüm yazmayı sınırlar. Okuma önbelleği bu çıkış kapsamını genişletmez.

ProtocolTest karşılıklı okuma/değiştirme kabulünü, politika değişimini, dosya kapsamını, süre ve bozuk mesaj sınırlarını kullanıcı modunda sınar. PipeTransportTest gerçek native pipe koduyla politika ve tarayıcı istek/yanıtını sürücü yüklemeden sınar. Bunlar minifilter callback'lerinin gerçek Windows davranışını kanıtlamaz.

Kesin USB veri yolu, açılış koruması, eşlenmiş erişim, içerik temelli yazma kararları, per-file snapshot/nesil, dosya context kurulamaması, tüm kanal kapsamı, INF/altitude ve Microsoft imzası eksiktir. SYS müşteri kurucularında yoktur. Windows hizmeti üretimde bu geliştirme yolunu otomatik açmaz. İlk yükleme, Driver Verifier ve fiziksel USB kabulü üretim verisi içermeyen ayrı Windows ortamında yapılmalıdır; günlük kullanılan bu PC'ye sürücü yüklenmedi.
