# Kalkan DLP üretici lisans hizmeti

Bu paket, `https://lisans.kalkandlp.com.tr` üzerinde PHP 8.3, Sodium ve PDO SQLite ile çalışır. Müşteri şirket sunucuları üretici hizmetinden günde en fazla bir kez yenilenen imzalı sunucu lisansı alır. Müşteri bilgisayarları üreticiye bağlanmaz; kendi şirket sunucularından en fazla bir saatlik imzalı yetki alır.

Tekrarlanan imzalı yönetim komutlarının yanıt önbelleği SQLite'ta Sodium secretbox ile şifrelenir; aktivasyon kimlik bilgisi yalnızca SHA-256 özetiyle saklanır.

## DirectAdmin kurulumu

1. Kalkan canlı kurulumunda subdomain ve Let's Encrypt HTTPS sertifikası zaten açıktır. Yeni hosting hesabında `lisans.kalkandlp.com.tr` subdomainini ve SSL'yi kurun; PHP 8.3, `sodium` ve `pdo_sqlite` modüllerini etkinleştirin.
2. Paketteki `public` klasörünün içeriğini subdomainin belge köküne yükleyin. PHP dosyası belge kökünde `index.php` olmalı.
3. Belge kökünün bir üst dizininde `private` klasörü oluşturun. Paketteki `private/config.php.example` dosyasını `private/config.php` adıyla kopyalayın. `private` için dosya iznini 700, `config.php`, `vendor-signing.seed` ve veritabanı için 600 yapın.
4. `vendor-public.key` dosyasını uygulama köküne yükleyin. `private/vendor-signing.seed` dosyasını güvenli kanaldan yerleştirin. Özel tohumu web köküne, müşteri paketine veya herkese açık yedeğe koymayın.
5. `private/config.php` içindeki `vendor_public_key` değerini `vendor-public.key` içeriğiyle aynı bırakın. Dosyadaki yollar, örnek klasör düzeninde çalışır. PHP 8.3 için çevre değişkeni tanımlamaya gerek yoktur.
6. `https://lisans.kalkandlp.com.tr/api/v1/server/lease` adresine tarayıcı GET isteği 404 vermelidir. `http://` adresi HTTPS'e yönlenmelidir. Dosya URL'leriyle PHP kaynak kodu veya özel dosyalar sunulmamalıdır.

## Lisans oluşturma ve yönetme

Üretici Windows bilgisayarında Node 24 ile `tools/vendor-license-remote-admin.cjs` kullanılır. `KALKAN_VENDOR_SIGNING_SEED` ortam değişkenini `.vendor/vendor-signing.seed` dosya yoluna ayarlayın. Komutlar imzalanır, TLS doğrulaması yapılır ve yönetim anahtarı isteğe eklenmez.

Müşteri sunucusunun `/api/server-license` ekranındaki `serverId` değerini alın. Lisans oluşturma komutu `provision <serverId> <müşteri> <cihaz-kotası> <YYYY-MM-DD>` biçimindedir. Yanıttaki `credential` yalnızca bir kez gösterilir; sunucunun korumalı veri klasörüne yalnızca `{"credential":"..."}` içeren `vendor-activation.json` dosyası olarak koyun. Dosya iznini sadece Kalkan DLP hizmet hesabına verin. Kimlik bilgisi istemci bilgisayarlara dağıtılmaz.

Yenileme `renew <licenseId> <cihaz> <YYYY-MM-DD>`, iptal `revoke <licenseId>` komutuyla yapılır. `licenseId` ve `credential` bilgilerini şifreli üretici kayıtlarında saklayın. İptal, sunucu bir sonraki yenilemede (en geç 24 saat içinde) ulaşır; istemci yetkileri en çok bir saat geçerlidir.

## Veri ve sınırlar

Üretici hizmeti sadece şirket sunucusu kimliğini, müşteri lisansını ve lisans yenileme isteklerini işler. DLP olayları, dosyalar, politikalar ve cihaz envanteri müşteri şirket sunucusunda kalır. Kiralama istekleri imzalı Ed25519 belge döndürür; sunucu ve istemci uygulamaları belgeyi yerel olarak doğrular. İmza tohumu kaybolursa lisans imzalama ve anahtar rotasyonu gerekir; bu tohumu yedekleyip erişimini sınırlayın.

Bu hizmet `https://lisans.kalkandlp.com.tr` üzerinde canlıdır. Her yeni sunucu için önce bir iç deneme lisansı oluşturup lease imzasını doğrulayın, sonra kaydı iptal edin. Üretici tohumu şifreli çevrimdışı yedeklenmeli ve geri yükleme kabulü yapılmalıdır. Windows Authenticode imzası ayrıca gerekir.
