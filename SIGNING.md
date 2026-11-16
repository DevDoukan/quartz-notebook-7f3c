# Windows yayıncı imzası

Yayıncı olarak hedeflenen ad: **MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN**. Destek: **destek@dkavis.com.tr**. Sertifikanın Subject/Publisher adı, CA'nın doğruladığı resmi tüzel veya ticari unvanla aynı olmalıdır. Başvurudan önce unvanı vergi levhası/ticaret sicilindeki biçimiyle teyit edin; CA doğrulamasından sonra `product-config.json` içindeki `signing.validatedSubject` alanını sertifikanın tam Subject değeriyle doldurun.

## Türkiye için yol

Türkiye şu anda Microsoft Artifact Signing'in desteklenen Public Trust kuruluş bölgeleri listesinde yer almıyor. Bu yüzden pratik yol, Windows uygulamalarına yönelik herkese açık güven zincirli **OV Code Signing** sertifikasını yetkili bir CA veya Türkiye'deki yetkili satıcısı üzerinden almaktır. DigiCert, Sectigo ve GlobalSign bu sertifika türünü sunan örnek sağlayıcılardır. CA, kuruluşu ve yetkili kişiyi doğrular; CA'ya göre kayıt/vergi belgeleri, doğrulanabilir telefon/e-posta ve yetkili kişi onayı istenebilir. Özel anahtarın donanım token/HSM üzerinde saklanması gerekir. Sertifika satın almadan önce yayıncı adını, Türkiye başvuru kabulünü, donanım teslim/uzak imzalama yöntemini, zaman damgasını ve toplam yıllık fiyatı yazılı teyit edin.

EV almak SmartScreen uyarılarını ilk sürümde kaldırmayı garanti etmez; Microsoft 2024'te EV için önceki anlık SmartScreen ayrıcalığını kaldırdı. Yeni yayıncıda OV/EV imzalı dosyalar için bile itibar zamanla oluşur. Öncelik sertifikanın doğru yayıncıya ait olması, imzanın doğrulanması ve aynı kimlikle düzenli sürüm çıkarmaktır.

DigiCert'in güncel belge koşullarında kuruluşun CS (Code Signing Organization Validation) ile doğrulanması ve kod imzalama özel anahtarlarının FIPS 140-2 Level 2, Common Criteria EAL 4+ veya eşdeğer donanımda tutulması istenir. Genel güven zincirli sertifikaların en fazla geçerlilik süresi 24 Şubat 2026'dan itibaren 459 gündür. Her CA'nın iş akışı farklı olabileceği için siparişten önce uygunluk ve fiyat doğrulanmalıdır.

## İmzalama adımları

1. CA başvurusunu şirketin resmi unvanı ve yetkili temsilcisiyle tamamlayın. Kimlik ve şirket belgelerini yalnızca CA'nın resmi doğrulama portalına verin.
2. CA'nın token/HSM yazılımını sadece yayın makinesine kurun. Özel anahtarı PFX olarak dışarı aktarmayın ve proje/sohbet içine koymayın.
3. CA tarafından doğrulanmış Subject'i `product-config.json` içindeki `signing.validatedSubject` alanına yazın.
4. Windows SDK SignTool yolunu ve sertifika thumbprint'ini kullanarak yeni sürüm kurulumlarını imzalayın:

```powershell
$thumb = 'SERTIFIKANIN_THUMBPRINT_DEGERI'
$signTool = 'C:\Program Files (x86)\Windows Kits\10\bin\SDK_SURUMU\x64\signtool.exe'
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-central.ps1 -CertificateThumbprint $thumb -SignTool $signTool
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-server-setup.ps1 -CertificateThumbprint $thumb -SignTool $signTool
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-release.ps1 -Machine -CertificateThumbprint $thumb -SignTool $signTool
```

Bu sıra önce merkez hizmet yürütücüsünü ve yönetim betiğini, sonra Server setup'ını, en son Client Agent setup'ını üretip imzalar. Her derleme aynı kaynak sürümünden yapılmalıdır; sertifika verildikten sonra build receipt ve imza doğrulaması baştan alınır.

İmzalama kodu beklenen Subject'i, Code Signing EKU'sunu, sertifika süresini ve imza doğrulamasını kontrol eder. EXE ve installer dosyaları SHA-256 ile imzalanır ve timestamp alır; PowerShell kurulum betikleri de imzalanır. HSM/token üretici ara yazılımı, yayın makinesinde PIN/onay isteyebilir. PIN'i komut satırına veya yapılandırmaya yazmayın.

SignTool için Microsoft SHA-256 (`/fd SHA256`) ve RFC 3161 zaman damgasını (`/tr` ve `/td SHA256`) önerir. Zaman damgası sertifika süresi bittikten sonra imza doğrulanabilirliğini korur. Bu depodaki yayın komutu Digicert timestamp uç noktasını kullanır; CA'nın sağladığı uyumlu endpoint farklıysa yayın ayarı ona göre değiştirilebilir.

## Şu anki durum

Sürüm adayı kurucular imzasızdır. OV sertifikası, token/HSM ve doğrulanmış publisher Subject henüz yoktur; imzalı yayın yapılmış değildir. Inno Setup derleyicisinin ticari kullanım lisansı da ayrıca çözülmelidir. Sertifika alımı ve yayın imzalama kabul edilmeden `readyForSale` kapısı kapalı kalır.

## Kaynaklar

- [Microsoft — Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft — Artifact Signing ülke/kimlik önkoşulları](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- [Microsoft — Authenticode zaman damgası](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
- [Microsoft — SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [DigiCert — Code Signing/EV Code Signing başvuru ve anahtar koşulları](https://docs.digicert.com/en/certcentral/order-and-manage-certificates/request-certificates/request-a-code-signing-or-ev-code-signing-certificate/request-code-signing-certificate.html)
