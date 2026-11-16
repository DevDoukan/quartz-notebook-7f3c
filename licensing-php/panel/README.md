# Kalkan DLP lisans yönetim paneli

`panel.kalkandlp.com.tr` subdomaininin belge köküne paketteki dosyaları yükleyin. Hostingte PHP 8.3, Sodium, PDO SQLite ve HTTPS etkin olmalıdır. Panel, lisans API'sinin kullandığı SQLite veritabanına erişir; üretici imzalama tohumunu kullanmaz.

Panel belge kökünün bir üstünde, web erişimine kapalı `private/panel-config.php` bulunmalıdır. Varsayılan DirectAdmin yerleşiminde panel ve lisans belge kökleri `public_html/panel` ve `public_html/lisans`, korumalı veriler ise `public_html/private` altındadır. Pakette bunun örneği vardır. DirectAdmin klasör düzeniniz farklıysa Apache/PHP `KALKAN_LICENSE_CONFIG` ortam değişkenini bu dosyanın tam yoluna ayarlayın. İçeriği:

```php
<?php
return [
  'database' => '/home/ACCOUNT/domains/kalkandlp.com.tr/private/kalkan-licenses.sqlite',
  'setup_token_hash' => '64-karakter-sha256-özeti',
];
```

Veritabanı yolu lisans API'sindeki `database` ile aynı olmalıdır. Özel dizin izni 700, config izni 600 olsun. Yapılandırmayı web köküne koymayın.

Yayımdan önce kriptografik olarak rastgele en az 40 karakterli bir kurulum anahtarı üretin. Yapılandırmaya yalnızca `SHA-256(anahtar)` değerini yazın. Anahtar, panel açılış ekranında bir kez girilerek yönetici hesabını oluşturur. Anahtar/parolayı sohbet, e-posta veya web dosyalarına koymayın. Hesap kurulduktan sonra ilk kurulum anahtarı tekrar kullanılamaz.

Panelde Server kimliği müşteri şirketindeki Kalkan DLP Server ekranından alınır. Oluşturulan aktivasyon anahtarı yalnızca bir kez gösterilir; müşterinin sunucusunda güvenli biçimde saklanmalı ve istemcilere gönderilmemelidir. İptal, Server'ın sonraki lisans yenilemesiyle (en geç 24 saat) uygulanır.

Yönetim paneli `noindex` durumundadır ve ürün analitiği/reklam pikselleri çalıştırmaz. Yönetici parolası `password_hash` ile, oturumlar SHA-256 özetiyle saklanır; Secure/HttpOnly/SameSite çerez, CSRF başlığı ve giriş deneme sınırı kullanılır.
