# Belge ve e-posta içerik kapsamı

1.2 kaynaklarında XLSX ve EML çözümleme dosya taraması, uygulama içi USB kopyası, SMTP ek kontrolü ve eklenti dosya denetiminde aynı sunucu okuyucusunu kullanır. Bu belge genel Windows aktarım denetimi veya Outlook entegrasyonu tamamlandı iddiası değildir.

## XLSX

Paylaşılan dizgiler, zengin metin parçaları, hücre içi dizgiler, CDATA, XML karakter başvuruları, OOXML `_xHHHH_` kaçışları, formül metinleri ve saklanan hücre değerleri incelenir. Sayısal bilimsel gösterim belirli aralıkta düz metne açılır; Excel'in önceden kaybettiği hassasiyet geri getirilemez. Fonetik açıklama ana hücre metnini bozmayacak şekilde ayrıca taranır. Gizli sayfalar atlanmaz.

Formüller çalıştırılmaz, dış bağlantılar indirilmez. Saklanan sonuç güncel olmayabilir; şifrelenmiş dosyalar, XLS/XLSB/XLSM ve gömülü görsel/OLE/binary içerikler desteklenmez. Böyle içerik içeren XLSX aktarımda reddedilir, klasör taramasında hata olarak görünür. Hücre koordinatları henüz rapora taşınmaz.

ZIP girişleri sırayla açılır. En fazla 2.000 giriş, giriş başına 8 MiB, toplam bildirilen açılmış içerik 32 MiB kabul edilir. Gerçek akış boyutu ayrıca kontrol edilir. Yinelenen ad, şifreli ZIP girdisi, geçersiz metin başvurusu, DTD ve bozuk XML reddedilir. Disk üzerine arşiv içeriği çıkarılmaz. [Yauzl](https://github.com/thejoshwolfe/yauzl) ve [Saxes](https://github.com/lddubeau/saxes) sabit sürümlerle kullanılır.

## EML

[MailParser](https://nodemailer.com/extras/mailparser) ile MIME kodlamaları çözülür. Düz metin ve HTML birlikte incelenir; görüntülenen HTML metni [html-to-text](https://github.com/html-to-text/node-html-to-text) ile çıkarılır. HTML işlenirken tarayıcı açılmaz, betik çalıştırılmaz veya uzak kaynak indirilmez. Konu ve temel adres alanları da incelemeye alınır. EML ekleri ayrıca çözümlenir; ayrı okuyucusu olmayan ek temiz kabul edilmez.

Dosya başına toplam girdi 10 MiB, desteklenen eklerin toplamı 10 MiB, ek sayısı 20, MIME parça sayısı 100 ve bir bölümün başlık boyutu 64 KiB ile sınırlandırılır. İç içe ek derinliği 3'tür; sınırı aşan dosya reddedilir. Ek mesajlar ayrıştırıcının otomatik düzleştirmesine bırakılmaz. EML kökünden itibaren desteklenen ekler aynı sınırlı okuyucu sürecinde değerlendirilir.

## Ortak sınırlar ve kanıt

Belge okuyucusu en fazla 4.194.304 metin karakteri, 30 saniye ve 192 MiB JavaScript heap sınırıyla ayrı süreçte çalışır. Yerel süreç başına en fazla iki eşzamanlı belge okuyucusu başlatılır. Heap sınırı tüm işletim sistemi belleğinin sınırı değildir; gerçek Windows hizmetinde native Job Object ek süreç/bellek sınırları vardır. İşlem çöker veya yanıt vermeden sonlanırsa belge temiz sayılmaz.

`tests/formats.test.js` gerçek XLSX ZIP/XML parçalarını ve üretilmiş MIME dosyalarını kullanır. Zengin metin, CDATA, karakter kaçışı, bilimsel sayı, Base64/quoted-printable, HTML, Excel eki, iç içe EML sınırı, desteklenmeyen ek, ZIP genişleme sınırı, DTD ve bozuk başvurular test edilir. DLP raporunda ham hassas veri bulunmadığı da kontrol edilir. Gerçek kurum belgeleriyle yanlış alarm/kaçırma ölçümleri ve farklı Office üreticilerinin kapsamlı uyumluluk testleri henüz gereklidir.
