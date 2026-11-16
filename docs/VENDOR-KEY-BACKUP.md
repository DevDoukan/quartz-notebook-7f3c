# Üretici imza anahtarının şifreli yedeği

Windows PowerShell'de proje kökünden `tools\Backup-VendorKey.ps1 -Action Backup -BackupPath "E:\Kalkan-Guvenli-Yedek\vendor-key.json"` çalıştırın. Hedef klasör önceden mevcut olmalıdır. Parola gizli istemle iki kez alınır, Node işlemine standart girdiyle iletilir. Doğrulamak için aynı dosyayla `-Action Verify` kullanın. Örnekteki sürücüyü kendi çevrimdışı yedek ortamınızla değiştirin. Bu üretici aracını müşteri bilgisayarına dağıtmayın.

Üretici bilgisayarında `tools/vendor-key-backup.cjs` aracı `backup TOHUM YENI_YEDEK` ve `verify YEDEK` işlemlerini sunar. Parola yalnızca standart girdiden alınır; komut argümanına veya ortam değişkenine yazılmamalıdır. Parola en az 16 karakter olmalıdır. Kurumun onaylı parola yöneticisi veya gizli giriş sağlayan bir başlatıcıyla stdin'e iletin; kabuk geçmişine açık parola yazmayın.

Yedek AES-256-GCM ile şifrelenir; scrypt parola türetmesi kullanır. Oluşturulurken çözülerek doğrulanır; var olan hedef dosyanın üzerine yazılmaz. Verify işlemi özel tohumu dosyaya yazmadan çözer ve ürünün `vendor-license-public.pem` açık anahtarıyla eşleşmesini kontrol eder. Yanlış parola veya değiştirilmiş yedek reddedilir.

Şifreli dosyayı üretici bilgisayarı ve hostingden ayrı çevrimdışı ortamda saklayın. Parolayı ayrı parola yöneticisinde tutun. Dosya/klasör erişimini kurum politikasına göre sınırlandırın. Bu araç Windows NTFS erişim izinlerini otomatik yapılandırmaz. Şifreli yedeği müşteri kurulumuna eklemeyin.

Mevcut gerçek anahtar için yedek henüz oluşturulmadı: işletme sahibinin seçeceği parola ve çevrimdışı hedef gerekir. Bellekte üretilen deneme anahtarıyla çözme, yanlış parola ve değiştirilmiş doğrulama etiketi reddi kontrol edildi. Gerçek yedeğin ayrı kurtarma makinesinde kabulü ayrıca gereklidir.
