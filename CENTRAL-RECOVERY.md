# Merkez yedekleme ve kurtarma

Bu akış merkezi sunucu içindir. Yerel ajan panelinin yedekleme dosyasıyla karıştırılmamalıdır. Araç merkez ZIP önizlemesine dahildir; otomatik Windows hizmeti kurulumu ve kurumsal işletim kabulü henüz tamamlanmadı. Paket içindeki aracı kullanırken aşağıdaki `node` yerine `runtime\node.exe` çalıştırılır.

## Ön koşullar

- Merkez sunucusunu durdurun. Çalışan merkezin veri klasörü kilitliyken yedekleme reddedilir. Uygulama kapalıyken gelen cihaz olayları ajanların sınırlı yerel kuyruğunda bekler.
- Veri klasörü ve kurtarma hedefinin üst klasörü yalnızca yetkili yönetici/hizmet hesabına açık olmalıdır. Araç Windows klasör ACL'lerini otomatik yapılandırmaz. Üretimde bu izinler BT tarafından doğrulanmalıdır.
- 12–128 karakterlik güçlü bir yedek parolası seçin. Parolayı anahtarlardan ve yedek dosyasından ayrı koruyun. Unutulan parolayı açan yönetici anahtarı yoktur.

Araç parolayı yalnızca standart girdiden okur. Parolayı komut satırı argümanına, betiğe veya günlük dosyasına yazmayın. Güvenilen bir parola yöneticisinden güvenli girdiyi araca bağlayın. Komut biçimleri aşağıdadır; `PAROLA_GIRDİSİ` gerçek bir program adı değildir, standart girdiyi gösterir:

```text
PAROLA_GIRDİSİ | node tools/central-backup.cjs create C:\Korunan\MerkezVerisi C:\KorunanYedekler\merkez.json
PAROLA_GIRDİSİ | node tools/central-backup.cjs restore C:\KorunanYedekler\merkez.json C:\Korunan\YeniMerkezVerisi
```

Kaynak/hedef tam yol olmalıdır. Var olan hedef dosyanın veya klasörün üzerine yazılmaz. Geri yüklemede üst klasör mevcut, hedef klasör ise yeni olmalıdır. Araç parolayı veya anahtarları çıktıya yazmaz.

## İçerik ve doğrulama

İki SQLite veritabanı, denetim anahtarı/zincir sonu, MFA şifreleme anahtarı ve Ed25519 politika imzalama anahtarı birlikte yedeklenir. SQLite anlık görüntüleri uygulama kilidi altında alınır. Yedek SHA-256 tabanlı scrypt ile türetilen anahtar ve AES-256-GCM ile şifrelenir. Parola yanlışsa veya şifreli içerik değiştirilmişse geri yükleme reddedilir. Toplam açık dosya içeriği sınırı 256 MB'dir.

Şirketler, üyelikler, cihaz kimlikleri, politikalar, olaylar, MFA sayaçları ve kalan kurtarma kodları korunur. Kullanıcı oturumları, giriş deneme sayaçları, tamamlanmamış MFA kurulumları ve kullanılmamış ajan kayıt anahtarları taşınmaz. Kullanıcı tekrar giriş yapar; yeni cihazlar için yeni kayıt anahtarı gerekir. TLS sertifikası/özel anahtarı ve işletim ortamı ayarları bu yedeğe dahil değildir; ayrıca korunmalıdır.

Geri yükleme önce hedefin yanındaki ayrı geçici klasörde yapılır. Veritabanı bütünlüğü, yabancı anahtarlar, veritabanları arasında üyelik-kullanıcı eşleşmesi, denetim zinciri, MFA sırlarının açılması ve politika anahtarının türü doğrulanır. Kontroller geçmeden hedef klasör oluşturulmaz. Başarılı kurtarma denetim zincirine eklenir.

Geri yüklenen merkezi üretime almadan önce eski merkezi kapatın. Aynı cihaz/sunucu kimliğinin iki kopyası eşzamanlı işletilmemelidir. DNS, TLS, hizmet hesabı ve klasör erişimlerini yeni ortamda doğrulayın; sonra `DLP_CENTRAL_DATA_DIR` değerini kurtarılan klasöre yönlendirip merkezi başlatın. Ajanlar aynı güvenilir HTTPS adresi ve politika anahtarı korunursa mevcut kimlikleriyle bağlanabilir.

Bir yedek geçmişteki yetki ve kimlik durumunu içerir. Yedekten sonra kaldırılmış kullanıcılar veya iptal edilmiş cihazlar geri gelebilir; kullanılmış kurtarma kodları da yedek anındaki duruma döner. Olay müdahalesinde bu değişiklikleri yeniden uygulayın ve şüpheli kimlikleri yenileyin. Bu sürüm TPM destekli geçmişe dönüş engeli sağlamaz.

## Kabul kanıtı ve kalan eksikler

`tests/central-backup.test.js` yanlış parola, değişiklik, çalışan merkez kilidi, var olan hedefi koruma, MFA anahtarı uyumsuzluğu, bozuk denetim zinciri ve geçici dosya temizliğini sınar. Geri yüklenen gerçek merkez başlatılıp aynı cihazla imzalı politika alınır ve korunmuş MFA kurtarma koduyla giriş yapılır. Komut satırı aracı boşluk içeren yollarla ayrıca denenir.

Zamanlanmış çevrimiçi yedek, harici depoya teslim, yedek saklama/silme politikası, işletim sistemi izinlerini otomatik hazırlama, kaybolmuş tüm MFA faktörleri için onaylı çevrimdışı kimlik kurtarma ve ayrı temiz Windows makinesinde felaket kurtarma tatbikatı henüz tamamlanmadı. Bu testler onların tamamlandığını kanıtlamaz.
