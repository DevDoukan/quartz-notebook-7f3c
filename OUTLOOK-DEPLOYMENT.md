# Outlook dağıtımı ve kabul durumu

Kalkan DLP Outlook entegrasyonu geliştirme aşamasındadır. Üretim dağıtımı kabulü açık.

Client panelindeki dosya indirme ve Outlook görev bölmesindeki içe aktarma RC68 kaynaklarına eklenmiştir. Kurulum ortamında aynı sürüm Client ve Server kullanın. Gerçek Outlook dağıtım ve teslimat kabulü ayrıca gereklidir.

| Bileşen | Mevcut kanıt | Kalan kabul |
| --- | --- | --- |
| İleti toplama ve karar motoru | Gövde, konu, alıcı, Bcc ve desteklenen eklerle kaynak testleri | Gerçek Outlook içinde Office.js çağrıları |
| Şirket politikası | Kayıtlı cihazın şirketiyle HTTP testi ve olay izolasyonu | Outlook hesabıyla cihaz kimliğinin güvenli eşleştirilmesi |
| Kesin engel | Block kararı ve denetim hatası gönderimi durdurur. Desteklenen istemcide warn kararı kullanıcı onayı sunar | Klasik ve Yeni Outlook’ta gerçek teslimat kontrolü |
| Lisans | Üretici lisansı devre dışıysa denetim API’si HTTP 402 döndürür | Canlı lisans yenileme ve kesinti kabulü |
| Dağıtım | Manifest ve çalışma dosyaları şirket HTTPS Server’ından sunulur. XML şeması doğrulandı | Kurumsal dağıtım, yükseltme ve kaldırma |

## Hedef istemciler

Klasik Outlook ve Yeni Outlook ayrı kabul gerektirir. Geliştirme bilgisayarında Klasik Outlook 16.0.4266.1001 ve Yeni Outlook 1.2026.818.0 gözlendi. Bu gözlem sürüm veya hesap desteğini kanıtlamaz. Smart Alerts desteği istemci sürümü, posta hesabı ve kurumsal dağıtım koşullarıyla birlikte doğrulanmalıdır.

## Manifest ve kurumsal dağıtım

`node tools/outlook-manifest.cjs https://dlp.firma.example:9443 manifest.xml` komutu şirkete ait manifesti oluşturur. Mevcut dosyanın üzerine yazmaz. Manifest OnMessageSend olayını Block gönderim moduyla tanımlar.

Microsoft office-addin-manifest aracıyla yapılan kontrolde XML şeması kabul edildi. Genel doğrulama sonucu Block gönderim modunun Marketplace kısıtı nedeniyle başarısız oldu. Bu sonuç kurumsal dağıtım kabulü değildir.

Microsoft belgelerine göre Block kullanan Smart Alerts eklentileri kurum yöneticisi tarafından dağıtılır. Kurumun Microsoft 365 yönetim merkezinde Settings, Integrated apps, Upload custom apps yolundan Office Add-in manifesti yüklenir ve test kullanıcılarına atanır. Çalışma dosyaları ve güvenli oturum aktarımı tamamlandıktan sonra bu dağıtım gerçek tenant üzerinde sınanmalıdır.

[Microsoft kurumsal dağıtım ve Marketplace koşulları](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/event-based-activation)

Microsoft belgeleri

- [Smart Alerts ve gönderim olayları](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/onmessagesend-onappointmentsend-events)
- [Klasik Outlook COM eklentilerinden web eklentilerine geçiş](https://learn.microsoft.com/deployoffice/outlook/get-started/migrate-com-to-web-addins)

## Mevcut sınırlar

Denetim API’si müşterinin HTTPS merkezinde POST /api/agent/outlook/inspect yolundadır. Kayıtlı cihaz kimliği gerekir. Genel ajan kimliğinin Office manifestine, herkese açık JavaScript dosyasına veya URL’ye yazılması uygun değildir. Üretim eklentisi için kullanıcı ve cihaz eşleştirmesi ile yetkisi sınırlandırılmış kimlik akışı tamamlanmalıdır.

Kayıtlı Client, kendi genel kimliğiyle HTTPS üzerinden POST /api/agent/outlook/credential çağırarak 15 dakika geçerli bir Outlook kimliği alabilir. Kimlik o1_ öneki taşır ve yalnızca Outlook denetiminde kullanılabilir. Yeni kimlik üretimi önceki kimliği geçersiz kılar. Eklenti bağlantı kodu yalnızca bu sınırlı kimliği kabul eder. API kapsam ve süre kontrolleri test edildi. Client panelinden dosya indirme ve Outlook görev bölmesinden içe aktarma uygulanmıştır. Otomatik aktarım ve yenileme bekliyor.

## Test bağlantısını kurma

1. Şirket Server’ını kurumsal olarak güvenilen HTTPS sertifikasıyla çalıştırın. Test kullanıcısına atanacak manifesti Server adresindeki `/outlook/manifest.xml` yolundan alın. Kurumsal dağıtımı üretim verisi içermeyen test hesaplarıyla sınayın.
2. Şirkete kayıtlı Client panelinde yönetici olarak giriş yapın. Lisans ve sistem sayfasındaki **Outlook bağlantı dosyasını indir** düğmesini kullanın. Etkin ürün lisansı ve şirket bağlantısı gerekir.
3. Outlook’ta ileti oluşturun ve şeritteki **Kalkan DLP** düğmesini açın. **Süreli bağlantı dosyası** alanından indirilen JSON dosyasını seçin. Başarı mesajını kontrol edin.
4. Temiz ve hassas test iletilerini ayrı deneyin. İzin sonucu, engel sonucu ve alıcı posta kutusunu gerçek kabul listesine göre kontrol edin.
5. Oturum süresi dolunca yeni bağlantı dosyasını indirin ve iletiye yeniden aktarın. Yeni dosya, aynı cihaz için önceden verilen Outlook kimliğini geçersiz kılar. Birden fazla açık ileti eski kimliği kullanıyorsa yeniden bağlanmalıdır.

Dosya bir erişim anahtarı içerir. Paylaşmayın ve testten sonra indirme klasöründeki kopyasını silin. Anahtarın içeriği panelde veya görev bölmesinde gösterilmez. Oturum iletiye özel SessionData içinde tutulur. Otomatik aktarım ve otomatik yenileme henüz uygulanmadı. Dosya içe aktarma kaynak ve tarayıcı testlerinde doğrulandı, gerçek Outlook kabulü açık.

Toplam ek içeriği 10 MiB, ek sayısı 20 ve API isteği 16 MiB ile sınırlıdır. Okunamayan ekler ayrı sonuç verir. Politika block ise okunamayan ek gönderimi engeller. Alan adı listesi kesin alan adı eşleşmesi kullanır. Alt alan adları ayrıca eklenmelidir.

Şu an politika audit ve block kiplerini destekler. Onaylı gerekçeli istisna akışı tamamlanmamıştır. İşleyici allow kararında gönderimi sürdürür. Mailbox 1.14 destekleyen istemcilerde warn kararı Smart Alerts promptUser seçeneğini kullanır. Destek bulunamazsa gönderim durdurulur. Block kararında uyarı geçersiz kılma seçeneği eklenmez. Gerçek Outlook içinde kullanıcı onayı ve gerekçeli istisnanın merkezde yetkilendirilmesi ayrıca doğrulanmalıdır.

## Gerçek kabul adımları

1. Test posta hesaplarını, istemci sürümlerini ve kurumsal dağıtım yöntemini kaydedin.
2. Temiz iletinin alıcı posta kutusuna ulaştığını doğrulayın.
3. Hassas gövde ve desteklenen hassas ek için kesin engel politikasını sınayın. Alıcı posta kutusunda teslimat olmadığını kontrol edin.
4. To, Cc, Bcc, yanıt ve iletme akışlarını ayrı sınayın. Merkez olayının doğru şirkette ve cihazda oluştuğunu doğrulayın.
5. Şifreli, bozuk, desteklenmeyen ve sınırı aşan eklerle politikayı sınayın.
6. Eklenti devre dışı, çevrimdışı, zaman aşımı, iptal edilmiş cihaz ve etkin olmayan lisans senaryolarını sınayın.
7. Yönetici dağıtımı, yükseltme ve kaldırmayı doğrulayın. Her iki Outlook istemcisinin sonuçlarını ayrı kaydedin.

Linux SaaS merkezi için Microsoft sunucu lisansı gerekmez. Outlook hesap ve kurumsal dağıtım gereksinimleri müşterinin posta ortamına bağlıdır.
