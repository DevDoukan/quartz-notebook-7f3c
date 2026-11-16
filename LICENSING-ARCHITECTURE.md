# Kalkan DLP lisans mimarisi

Kullanıcı kararı: her Client kendi şirket Server'ından yönetilir; her şirket Server'ı üretici lisansını yalnızca `https://lisans.kalkandlp.com.tr` üzerinden alır. Client makineleri üretici lisans alan adına bağlanmaz.

## Akış

```text
Üretici lisans servisi (PHP 8.3 / SQLite)
        │ imzalı, sunucu kimliğine bağlı 24 saatlik lisans; HTTPS yenileme
        ▼
Şirket Server'ı (Windows hizmeti, cihaz kotası ve müşteri verisi)
        │ imzalı, cihaza özel en çok 1 saatlik yetki + politika/olay eşitlemesi
        ▼
Şirket Client'ları (Windows hizmeti, yerel tarama ve politika uygulama)
```

Üretici hizmeti lisans ve aktivasyon bilgilerini işler. DLP dosyaları, olaylar, politikalar ve cihaz listesi şirket Server'ında kalır. Üretici özel imza tohumu müşteri paketlerine girmez. İstemci paketi yalnızca üretici açık anahtarını taşır.

## Uygulama durumu

- `server-license.js` sunucu UUID'sini üretici Ed25519 imzasına bağlar; süre, kota, lisans durumu ve revizyonu doğrular.
- `server-license-runtime.js` `vendor-activation.json` içindeki tek aktivasyon kimliğini kullanır. Lisans merkezi adresi ve açık anahtar ürün paketinde sabittir. Sunucu otomatik HTTPS yenilemesi yapar; hata durumunda geçerli imzalı önbelleği süre sonuna kadar kullanır.
- `central-store.js` lisanslı kotayı tüm şirketler genelinde tek SQLite işlemi içinde denetler. Kota veya lisans etkin değilken yeni Client kaydı reddedilir.
- Şirket Server'ı heartbeat yanıtında imzalı üretici sunucu kimliğini verir ve cihaza özel yetki üretir. `central-client.js` sunucu imzasını ve üretici imzasını doğrular; üretici anahtarını ürün paketindeki sabit açık anahtarla karşılaştırır. Eski kurulumlar da imzalı heartbeat üzerinden üretici kimliğini öğrenip korunan yerel veritabanına sabitleyebilir.
- `client-entitlement.js` yetkiyi cihaz, şirket Server'ı, sıra numarası, üretici revizyonu ve süreye bağlar. Yetki yoksa, bozuksa veya süresi dolduysa Client'ın korumalı tarama/işlem uçları çalışmaz. Client üretici servisine doğrudan bağlanmaz.
- `licensing-php/public/index.php` paylaşımlı PHP hosting için `POST /api/v1/server/lease` ve imzalı üretici yönetim komutlarını sunar. SQLite ve özel imza tohumu web kökünün dışında tutulur. `tools/vendor-license-remote-admin.cjs` imzalı lisans oluşturma, yenileme ve iptal komutlarını HTTPS ile gönderir.

Lisans hizmetinin DirectAdmin dosya yerleşimi, izinler, kontrol adımları ve lisans verme işlemi `licensing-php/README.md` içinde. Paket `tools/package-license-service.ps1` ile oluşturulur. 31 Ekim 2026'da canlı DNS/TLS, PHP 8.3.36, Sodium, PDO SQLite, özel dosya izinleri ve imzalı provision/renew/lease/revoke akışı doğrulandı. Panel ilk yönetici hesabı, şifreli çevrimdışı tohum yedeği ve müşteri Windows Server kabulü hâlâ açık.

## Anahtar ve aktivasyon işletimi

Üretici anahtarı `.vendor/vendor-signing.seed` altında yerel geliştirme/üretici makinesinde tutulur ve `.gitignore` ile dışlanır. `vendor-license-public.pem` ve `licensing-php/vendor-public.key` açık anahtardır. Özel tohumu üretici sunucusuna yüklemek, onu hosting sağlayıcısının çalıştırdığı PHP sürecine emanet eder; dosya 600 izniyle web kökü dışında saklanmalı ve şifreli çevrimdışı yedeği bulunmalıdır. Üretici yönetim komutu aynı özel tohumla imzalanır.

Server lisansı oluşturma komutu için önce Server'ın `/api/server-license` ekranından `serverId` alınır. Bir defa dönen `credential`, yalnızca Server'ın korunan veri klasöründeki `vendor-activation.json` dosyasına konur. Client kayıt anahtarıyla karıştırılmaz ve Client bilgisayarına dağıtılmaz.

İptal anlık değildir: üretici Server tarafından bir sonraki yenilemede, en geç yaklaşık 24 saatte görülür. Client'ın son imzalı yetkisi en çok bir saat yaşar. Server çevrimdışı kalırsa Client son yetki süresi bitince korumalı işlemleri durdurur.

## Üretim öncesi kalan işler

Canlı lisans servisi ve imzalı yönetim akışı çalışıyor; web panelinin ilk yöneticisi henüz kurulmadı. Üretici tohumu için şifreli, çevrimdışı yedek ve geri yükleme adımı tamamlanmalı; ardından Client ve Server paketleri temiz Windows ortamında kurulup Server aktivasyonu, Client kaydı, kota, lisans bitişi/iptali, çevrimdışı davranış ve yükseltme kabulü yapılmalıdır.

Üretim Windows kurulumları şu an Authenticode imzası taşımaz. USB koruması sistem genelinde minifilter değildir; desteklenen uygulama akışlarıyla sınırlıdır. Ürün `PRODUCT-READINESS.md` içindeki sürücü, fiziksel aygıt, SMTP, temiz makine, güvenlik incelemesi ve ticari yayın kapıları kapanmadan “rakiplerin hepsinden iyi” veya genel satışa hazır olarak tanıtılamaz.
