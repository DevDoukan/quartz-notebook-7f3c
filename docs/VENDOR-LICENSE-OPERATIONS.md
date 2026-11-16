# Üretici lisans işletimi

## Anahtar

`node tools/create-vendor-signing-key.cjs` üretici Ed25519 anahtarını oluşturur. Özel 32 baytlık tohum `.vendor/vendor-signing.seed` içinde kalır ve `.gitignore` tarafından dışlanır. `vendor-license-public.pem` ile `licensing-php/vendor-public.key` açık anahtarlardır; istemci ve sunucu paketlerine yalnızca bunlar girer. Özel tohumu şifreli çevrimdışı yedekleyin ve erişimi yalnızca lisans operatörlerine verin. Tohum kaybolursa mevcut ürün sürümlerinin güven kökü değiştirilemeyeceği için anahtar rotasyonu ayrı sürüm ve müşteri geçişi gerektirir.

## Hosting dağıtımı

`tools/package-license-service.ps1` `release/Kalkan-License-Service-SURUM.zip` dosyasını oluşturur. ZIP özel tohumu veya müşteri aktivasyon anahtarı içermez. Subdomain belge kökü yalnızca `public/` olmalı; `private/` ve SQLite veritabanı bunun dışında kalmalıdır. PHP 8.3, Sodium, PDO SQLite ve HTTPS gerekir. Ayrıntılar `licensing-php/README.md` içindedir. Canlı DNS/SSL/PHP kabulü tamamlanmadan üretim lisansı dağıtmayın.

## Lisans oluşturma

Üretici Windows makinesinde Node 24 kullanılır. PowerShell'de özel tohumun dosya yolunu `KALKAN_VENDOR_SIGNING_SEED` ortam değişkenine atayın; değişken dosya yolunu içerir, tohum metnini değil. `tools/vendor-license-remote-admin.cjs provision <serverId> <müşteri> <cihaz> <YYYY-MM-DD>` komutu lisans kaydını HTTPS üzerinden imzalı komutla oluşturur. Server kimliği müşteri merkezindeki `/api/server-license` kartından alınır.

Provision yanıtındaki `credential` bir sırdır. Terminal kayıt/komut geçmişine yapıştırmayın. Yetkisi dar bir sır kasasına kaydedin ve Server hizmetine güvenli dosya aktarımıyla korunan `%ProgramData%\KalkanDLPCentral\Data\vendor-activation.json` dosyasını oluşturun. İçerik yalnızca `{"credential":"..."}` olur. Windows ACL'si dosyaya sadece SYSTEM, Administrators ve Kalkan DLP hizmet hesabı erişecek şekilde ayarlanmalıdır. Bu dosya Client makinelerine gitmez.

Yenileme: `node tools/vendor-license-remote-admin.cjs renew <licenseId> <cihaz> <YYYY-MM-DD>`. İptal: `node tools/vendor-license-remote-admin.cjs revoke <licenseId>`. Yenileme/iptal hemen uygulanmaz; Server üretici hizmetini en geç 24 saat içinde tekrar çağırır. Client yetkileri en çok bir saat geçerlidir.

Eski `tools/vendor-license-admin.cjs` yerel geliştirme/test SQLite deposu içindir; canlı PHP hizmetini yönetmez. Üretim işlemlerinde `vendor-license-remote-admin.cjs` kullanılır.
