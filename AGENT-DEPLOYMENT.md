# Windows ajanı kurulum adayı

Bu belge geliştirilmekte olan makine kurulumunu anlatır. Konsol kipindeki ajan testleri, gerçek Windows hizmeti hesabı ve makine izinleriyle yapılan kabul testinin yerini tutmaz. Ayrı Windows 11 VM'sinde Client rc.40 ve Server rc.41 özel hizmet hesaplarıyla Running/Auto olarak gözlendi; Server'ın üretici imzalı test lisansı doğrulandı. Bu gözlemler güncel paketin tam kayıt, yeniden başlatma, standart kullanıcı veya USB kabulünü kanıtlamaz.

## İki çalışma biçimi

- Masaüstü kurulum adayı kullanıcı hesabına kurulur. Uygulama o kullanıcının dosya izinleriyle çalışır.
- Agent kurulum adayı Windows yöneticisi gerektirir. Program dosyalarını Program Files/KalkanDLP altında tutar, KalkanDlpAgent adlı otomatik başlayan bir Windows hizmeti kurmayı hedefler.

Makine hizmeti LocalSystem veya ortak LocalService hesabını kullanmaz. Kendisine özel `NT SERVICE\KalkanDlpAgent` sanal hesabıyla yapılandırılır. Hizmetin istenen ayrıcalıkları SeChangeNotifyPrivilege ile sınırlanır. Normal kullanıcıların hizmeti durdurma veya yapılandırmasını değiştirme yetkisi verilmez. Windows yöneticileri güvenilen taraftır.

## Veri ve program izinleri

Makine verisi ProgramData/KalkanDLP/Data altında bulunur. Administrators ve SYSTEM tam erişime, hizmet hesabı veri klasöründe değiştirme hakkına sahiptir. Üst yapılandırma klasöründe hizmet hesabının yalnızca okuma ve çalıştırma hakkı vardır. Uygulama kodunun hizmet hesabı veya sıradan kullanıcı tarafından yazılabilir olması kabul edilmez.

İlk yönetici kurulumu için kurulum anahtarı veri klasöründedir. Yetkili Windows yöneticisi programı yükseltilmiş olarak açıp ilk hesap kurulumunu tamamlar. Daha sonra uygulama kullanıcıları kendi hesaplarıyla panele giriş yapar. Windows hizmeti, kullanıcı oturumu açılmadan çalışacak şekilde yapılandırılır. Bu davranış gerçek hedef makinede yeniden başlatma testiyle doğrulanmalıdır.

## Güvenilen klasörler

Hizmette tarama varsayılan olarak açık bir klasöre yetkili değildir. Panelin Lisans ve sistem bölümünden yönetici en fazla 20 yerel klasör tanımlar. Ayrıca Windows dosya güvenliğinde hizmet hesabına ilgili şirket klasörünü okuma hakkı gerekir. Bu erişim gizli kullanıcı profillerine veya bütün sürücüye otomatik olarak verilmez.

BT yöneticisi, izin verilen şirket klasörünün Windows Güvenlik sekmesinde `NT SERVICE\KalkanDlpAgent` hesabına okuma hakkı verebilir. Uygulama şirket dosyalarının NTFS izinlerini kendiliğinden genişletmez. Korumalı alt klasörlerin izinleri ayrıca değerlendirilir.

Dosya okuyucu, açılmış Windows dosya nesnesinin son yolunu denetler ve aynı nesneden okur. Klasör girdilerini de açılmış klasör tanıtıcısıyla listeler. Junction/symlink ile yetkili alan dışına çıkış, çok bağlantılı hard link dosyaları, ağ/aygıt yolları ve alternatif veri akışları reddedilir. Uygulama ve hizmet veri klasörleri kaynak olarak kabul edilmez. Kaynak baytları değişmeden taranıp politika kararı uygulanır.

## Süreç gözetimi

Native hizmet, Node işlemini önce duraklatılmış durumda oluşturur. İşlemi Windows Job Object içine aldıktan sonra çalıştırır. Alt süreçler de iş grubunda kalır. Varsayılan sınır toplam 1 GB işlem belleği ve 24 süreçtir. Host kapanırken iş grubu kapanır ve kalan alt süreçler sonlandırılır. Ajan, kısa süreli Node çökmelerinde yeniden başlatmayı dener, sürekli hata halinde sınır uygular ve hata günlüğü yazar.

`agent.log`, `agent-status.json` ve `node-output.log` veri klasöründedir. Yapılandırma, denetim ve kullanıcı sırları bu günlüklerde yazdırılmaz. Uygulama üzerinden hizmeti durdurma API'si hizmet kipinde kapalıdır. Yerel kontrol anahtarı yalnızca hizmet ve yetkili Windows yöneticilerinin erişebildiği veri klasöründedir.

## USB politikası

Makine kurulum betiği hizmet hesabına yalnızca StorageDevicePolicies kayıt anahtarında okuma ve değer ayarlama hakkı ekler. Hizmet hesabı başka Windows ayarlarına genel yönetici yetkisi almaz. Paneldeki USB yazma koruması işlemi, bu hizmet kimliğiyle sınırlandırılır. Kurulum yazma korumasını kendiliğinden açmaz veya kapatmaz. Kaldırma mevcut USB ayarını korur.

Bu katman, Windows'un yazma koruması ayarıdır. Explorer kopyalarını dosya içeriğine göre sınıflandıran bir minifilter sürücüsü değildir. Gerçek USB aygıtı, dosya sistemi ve hedef Windows sürümü üzerinde etkinin doğrulanması gerekiyor. Web tarafında standart formlar ve dosya seçimi için mevcut uzantı kapsamı geçerlidir. Tüm ağ trafiği denetimi henüz sağlanmıyor.

Merkez şirket politikasında USB yazma kuralı `Ayarı değiştirme`, `Yazmayı engelle (salt okunur)` veya `Yazmaya izin ver` olarak yayımlanabilir. İmzalı politika yeni makine Agent sürümünde doğrulandıktan sonra Windows kayıt defteri ayarı hizmet hesabıyla uygulanır; merkez kaydından sonra yerel panelde USB aç/kapat düğmeleri gizlenir ve API üzerinden yerel geçersiz kılma reddedilir. Ajan yeniden başlatıldığında önbelleğe alınmış imzalı kural tekrar uygulanır. Salt okunur ayarı içerik denetimi değildir; yanlış yapılandırma şirketin USB depolama aygıtlarının yazılmasını durdurabilir. Önce ayrı test makinesinde ve zararsız test USB'sinde doğrulayın.

## Kabul testi

### Makine ajanını merkeze kaydetme

Güncel Agent kurulumundan sonra **64 bit Windows PowerShell'i yönetici olarak**, profil yüklemeden açın. Program Files içindeki kurulu sürümün `scripts/Register-Agent.ps1` aracını kullanın. `-ValidateOnly` servis/kimlik değiştirmeden ön kontrolleri yapar. Normal çalıştırmada `-Origin https://merkez.example.com:9443`, isteğe bağlı `-DeviceName` ve yalnızca özel kurum CA'sı için `-CAFile` verilebilir. Tek kullanımlık anahtar gizli istemde alınır; komut satırı argümanına veya günlüğe yazılmaz. Örnek:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\KalkanDLP\versions\SURUM\scripts\Register-Agent.ps1" -Origin "https://merkez.example.com:9443"
```

`SURUM` ve merkez adresi gerçek kurulu sürüm/adresle değiştirilir. Önce merkezde şirket politikası yayınlanıp yeni kayıt anahtarı oluşturulmalıdır. Araç kurulu özel hizmet hesabını, tam hizmet komutunu, Program Files kod/manifest bütünlüğünü, Node imzasını ve Common yapılandırma izinlerini doğrular. Normal kullanıcıya ait/yazılabilir kod, korunan durumda beklenmedik okuma/yazma ve reparse yolları reddedilir. Kullanıcı SID'sinin yönetici grubuna üye olması, o SID'ye doğrudan kod yazma veya sahiplik yetkisi verilmesini güvenli saydırmaz.

Anahtar alınırken hizmet çalışmaya devam eder. Ağ kaydından önce korunan `central-enrollment.required` işareti yazılır ve hizmet durdurulur. Node aracına JSON UTF-8 standart girdiden aktarılır; anahtar/sır işlem argümanlarında bulunmaz. Çocuk süreçte `NODE_*` ortam değişkenleri miras alınmaz. Başarıda `central-connection.json` doğrulanır, hizmet başlatılır ve sağlık yanıtı korunan durum dosyasındaki gerçek hizmet/Node süreç kimlikleriyle eşleştirilir. İlk politika henüz gelmediyse hizmetin açık olması aktarım izni anlamına gelmez.

Kesintide `-Resume` bekleyen korunan isteği aynı cihaz kimliğiyle sürdürür. Başarısız kayıt sonrası araç hizmeti yönetimsiz biçimde yeniden açmaz. Yerel gerekli-kayıt işareti veya bekleyen dosya varken tam bağlantı dosyası yoksa native host hizmeti başlatmayı reddeder. Gerekli-kayıt işareti tamamlanmadan sonra da korunur; bağlantı dosyasını silerek veya makineyi yeniden başlatarak yerel politikaya dönülmez. İşareti/kimlik dosyalarını gelişigüzel silmeyin; yönetici kurtarması gerekir. Mevcut kimliğin üzerine yazma, sessiz başka şirkete taşıma veya kayıt kaldırma aracı henüz yoktur.

Korunan Common klasörünün tamamı üretim hizmetinde güvenli dosya aracısının reddedilen alanıdır. Önceden daha geniş bir klasör güvenilmiş olsa da makine kimliği/kurulum yapılandırması okunamaz veya kontrollü aktarım kaynağı yapılamaz. Konsol test düzeni ayrı geçici klasörlerle çalışır; gerçek hizmet sınırı test kipiyle gevşetilmez.

Bu araç hazırlanıp sözdizimi, standart kullanıcı reddi ve dosya aracısı sınır testleriyle doğrulandı. Bu ortam yönetici olmadığı için gerçek sanal hizmet hesabında tam kayıt, ACL sahiplik varsayımları, yeniden başlatma ve durum/işlem eşleştirmesi henüz kabul edilmedi. Aşağıdaki gerçek makine kabul adımları açık kalır.

1. Ayrı bir Windows test makinesinde imzalı Agent kurulumunu Windows yöneticisiyle yükleyin.
2. Hizmet hesabı, otomatik başlangıç, program/veri ACL'leri ve hizmet kontrol DACL'sini doğrulayın.
3. Şirket test klasörüne okuma hakkı verip panelde aynı klasörü tanımlayın.
4. Ayrı bir standart Windows hesabıyla tarama ve rapor erişimini deneyin. Hizmetin durdurulamadığını ve veri klasörünün doğrudan okunamadığını doğrulayın.
5. Bilgisayarı yeniden başlatın. Kullanıcı oturumu açmadan hizmetin ve koruma ayarlarının durumunu denetleyin.
6. Fiziksel test USB'sinde politikayı, sürüm yükseltmesini ve veri korunarak kaldırmayı doğrulayın.

Doğrulanmamış kabul adımları PRODUCT-READINESS.md ve ticari yayın kontrolünde açık kalır.

## Teknik kaynaklar

- [Windows hizmet erişim hakları](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights)
- [Sanal hizmet hesapları](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/configure-windows-service-accounts-and-permissions)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
- [FILE_FULL_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_full_dir_info)
