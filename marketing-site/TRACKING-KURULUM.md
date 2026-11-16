# Kalkan DLP site: SEO, GEO ve dönüşüm ölçümü

Site Türkçe başlık/açıklama, canonical ve Open Graph etiketleri, Organization/SoftwareApplication/WebSite JSON-LD, `robots.txt`, `sitemap.xml` ve `llms.txt` içerir. GEO içeriği ürünün mevcut kabiliyetleriyle sınırlıdır; Explorer genelinde USB engellemesi gibi henüz bulunmayan özellikleri iddia etmez.

## Reklam ve analitik

`tracking-config.js` içine yalnızca gerçek ve doğrulanmış hesap kimliklerini yazın: Google Analytics `G-…`, Tag Manager `GTM-…`, Google Ads `AW-…` + dönüşüm etiketi, Meta Pixel numarası. Değerler boşken üçüncü taraf takip isteği yapılmaz. Ziyaretçi analitik ve reklam kategorilerine ayrı izin vermeden etiketler yüklenmez; izin tercihi sayfanın altındaki “Ölçüm tercihlerini değiştir” düğmesinden güncellenir.

`generate_lead` olayı demo/bayi e-posta bağlantısı tıklamasında kaydedilir. Bu, gönderilmiş e-posta veya nitelikli satış değil, talep başlatma tıklamasıdır. Gerçek form/CRM eklendiğinde dönüşümü sunucu tarafından başarıyla kaydedilen forma bağlayın. UTM source/medium/campaign alanları izin varsa analitik olaya eklenir. GTM kullanılıyorsa Ads ve Meta dönüşüm etiketlerinin kendi konsolunda yapılandırılması gerekir.

Yayından önce gerçek Analytics/Ads/Meta hesap kimliklerini, Search Console sahipliğini, işletme iletişim/yasal metnini ve KVKK/çerez politikasını tamamlayın. Site Ads etiketi uydurmaz ve yönetim panelinde pazarlama takibi çalıştırmaz.
