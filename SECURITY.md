# Güvenlik modeli ve yayın kapıları

## Mevcut güvenlik sınırı

Panel sadece IPv4 localhost üzerinde dinler. Yönetim API'si kullanıcı oturumu ve rol kontrolü ister. İlk yönetici kurulum anahtarı veri klasöründe bulunur ve kullanımdan sonra silinir. Oturum sırrı HttpOnly/SameSite çerezinde, CSRF belirteci tarayıcı belleğinde tutulur. Oturum kayıtları sunucuda özet olarak saklanır. 30 dakika hareketsizlik ve 8 saat mutlak süre sınırı uygulanır. Parola değişikliği ve kullanıcı erişim değişikliği ilgili oturumları iptal eder.

Bu loopback sürümü HTTPS sunmaz. Aynı Windows hesabındaki başka bir uygulama çerezlere, dosyalara veya yerel servise erişebiliyorsa bu hesap bir güven sınırı olarak kabul edilir. Yerel dosyalara erişebilen aynı kullanıcıdan veya Windows yöneticisinden değiştirilemezlik ve lisans kopyalama direnci beklenmez. Servis başka ağ arayüzlerine açılmamalıdır.

## Denetim kayıtları

Olaylar HMAC zincirine bağlanır. Ayrı zincir sonu ve bekleyen işlem dosyası, satır değiştirme, son kayıt silme ve kesinti durumlarını denetlemeye yardımcı olur. Anahtar ve kontrol dosyaları aynı veri klasöründedir. Bu mekanizma bağımsız bir zaman damgası servisi, uzak kayıt merkezi veya WORM depolama değildir. Bu dosyaların tamamını ele geçiren saldırgan karşısında güvence vermez. Zincir doğrulanmazsa servis başlangıcı durur.

## Yedek ve lisans anahtarları

Yedek AES-256-GCM ile şifrelenir. Parola scrypt ile türetilir. Yedekler yönetici hesaplarını, politika ve olayları içerir. Etkin oturumlar çıkarılır. Geri yüklemede uzantı anahtarı yenilenir ve uzantının yeniden eşleştirilmesi gerekir. Geri yükleme yalnızca boş klasöre yapılır.

Lisans doğrulama açık anahtarı ürünle dağıtılır. Satıcının özel lisans anahtarı ürün klasöründe, kaynak ZIP'inde veya kurulum paketinde yer almamalıdır. Geliştirme ortamındaki özel anahtar çalışma alanının dışında, satıcıya ait özel bir klasörde tutulur. Anahtarın yedeğini ve erişim politikasını satıcı yönetmelidir.

## Ticari yayın öncesi

- Kaynak ve derlenmiş paket için bağımsız güvenlik incelemesi.
- Dosya ayrıştırıcıları için zararlı, bozuk, büyük ve iç içe belgelerle dayanıklılık testleri.
- Hedef Windows sürümlerinde USB, UAC, kurulum, yükseltme ve kaldırma doğrulaması.
- Güvenilen yayıncı sertifikasıyla Authenticode imzası ve zaman damgası.
- Kurulum derleyicisinin ticari kullanım lisansının satıcı tarafından tamamlanması veya uygun bir derleyiciye geçiş.
- Güvenlik bildirim kanalı ve destek sorumlusu. Satıcı iletişimi henüz belirtilmedi.

Güvenlik açığı bildirimlerini otomatik olarak üçüncü taraflara göndermiyoruz. Satıcı iletişim bilgileri geldikten sonra burada doğrulanmış bildirim kanalı yer alacak.
