# Kalkan DLP: rekabet ve geliştirme hedefi

Karar tarihi: 30 Ekim 2026. Hedef müşteri: şirket BT ekipleri ve birden fazla müşteriyi yöneten BT bayileri. Bu belge hedefleri tanımlar; özelliklerin tamamlandığı veya rakiplerden üstün olduğumuz anlamına gelmez. Mevcut kabul kapıları PRODUCT-READINESS.md içinde korunur.

## Ürün ilkesi

Tek ajan ve tek yönetim deneyimi ile veri kaybını azaltmak, BT operasyonunu kolaylaştırmak ve korumanın gerçekten çalıştığını kanıtlamak. Her kanalda desteklenen, yalnızca izlenen, engellenen ve desteklenmeyen işlemler ayrı gösterilecek. Bağlantı veya ayrıştırma hatası temiz sonuç gibi sunulmayacak.

## Önce kapatılacak açıklar

| Öncelik | İş | Kabul kanıtı |
| --- | --- | --- |
| P0 | Windows hizmeti kurulumu ve cihaz kimliğinin güvenli kurtarılması | Temiz Windows üzerinde yönetici kurulumu, standart kullanıcı, yeniden başlatma, kesintili kayıt ve yedekten dönüş senaryoları |
| P0 | Sistem genelinde USB ve dosya aktarımı denetimi | Explorer ve farklı uygulamalardan aktarımlarda içerik kararının uygulanması; sürücü, imza ve fiziksel USB testleri |
| P0 | Güvenli dağıtım ve güncelleme | İmzalı paket, bütünlük kontrolü, kesintili güncelleme, veri göçü ve desteklenen geri dönüş prosedürü |
| P0 | Merkezi dağıtım ve bayi yetkileri | Müşteriler arası erişim sızıntısı testleri; cihaz, lisans ve yetki yaşam döngüsü; merkez hizmeti kurulumu |
| P0 | Bağımsız güvenlik incelemesi | Kritik ve yüksek bulguların kapatılması ve tekrar doğrulanması |
| P1 | Pano, yazdırma, ağ paylaşımı, tarayıcı ve uygulama kanalları | Kanal/uygulama/sürüm bazında pozitif ve kaçış testleri; kapsam dışı akışların açık gösterimi |
| P1 | Belge kapsamı | OCR, arşiv ve şifreli belge politikasının kaynak sınırlarıyla test edilmesi; okunamayan içerikte açık karar |
| P1 | Kurumsal operasyon | SSO, SIEM/API, saklama süresi, kota, bildirim, yedekleme ve kurtarma; yetki ve yük testleri |

## Fark yaratması hedeflenen işler

Rakiplerde bulunmadığı doğrulanmadan hiçbir özelliğe “dünyada ilk” veya “yalnızca bizde” denmeyecek. Aşağıdaki birleşimin kullanışlılığı pilot müşterilerle ölçülecek.

1. **Koruma doğrulama ekranı:** Her cihaz için atanmış politika, uygulanan sürüm, son bağlantı ve kanal sağlığı; güvenli sentetik veriyle yapılan kontrolün sonucu. Kalp atışı tek başına koruma kanıtı sayılmaz.
2. **Yayınlamadan önce politika denemesi:** Etiketli örneklerde yeni kuralı çalıştırıp yanlış alarm ve kaçırma farkını göstermek; gözlem modu, küçük cihaz grubunda deneme ve onaylı yaygınlaştırma. Gerçek hassas içerik test merkezine otomatik gönderilmez.
3. **Bayi için müşteri izolasyonlu işletim:** Yetki devri, müşteri bazında şablonlar, cihaz/lisans havuzu, değişiklik geçmişi ve çapraz müşteri erişim testleri. Müşterinin yönetim yetkisi ve bayi yetkisi açıkça ayrılır.
4. **Türkçe veri ve iş akışı kalitesi:** TCKN, IBAN ve kurumsal belge örneklerinde doğrulama, bağlam ve maskeleme; müşteri verisi yerine izinli veya sentetik etiketli veri kümesiyle ölçüm. KVKK için yardımcı raporlar hukuki uygunluk garantisi sayılmaz.
5. **Açıklanabilir karar ve süreli istisna:** Kullanıcıya kuralın gerekçesini hassas veriyi ifşa etmeden göstermek; gerekçeli, onaylı, kapsamı dar ve süre sonunda kapanan istisnalar.
6. **Yapay zekâya güvenli paylaşım:** Desteklenen uygulamalarda hassas veriyi gönderimden önce maskelemek veya engellemek; orijinal içeriğin dış servise gitmediğini ağ düzeyinde doğrulamak. Desteklenmeyen akışlar kapsam dışında gösterilir.
7. **Yerel veri işleme ve çevrimdışı süreklilik:** İçerik yerelde kalırken merkezde maskeli olaylar; imzalı politika, yeniden bağlantı ve kota dolması senaryoları. Yerel yöneticiye karşı mutlak koruma vaat edilmez.

## Üstünlük nasıl ölçülecek?

Karşılaştırmalar aynı Windows sürümü, donanım, belge kümesi ve etkin politika kapsamıyla yapılacak. Üretici pazarlama sayfaları bağımsız başarı kanıtı değildir.

| Ölçüm | Raporlanacak sonuç |
| --- | --- |
| Tespit kalitesi | Veri türü başına precision/recall ve yanlış alarm; örnek sayısı, belirsizlik ve test kümesi sürümü |
| Kaçışlara dayanıklılık | Kanal başına denenen yöntemler, engellenenler ve açık kalanlar |
| Performans | Boşta ve yükte CPU/RAM, işlem gecikmesi p50/p95, büyük dosya ve eşzamanlılık |
| Güvenilirlik | Kesinti, yeniden başlatma, çevrimdışı politika, kuyruk, güncelleme ve geri yükleme sonuçları |
| BT iş yükü | İlk kurulum süresi, politika yayılım süresi, olay inceleme süresi ve destek ihtiyacı |
| Bayi ekonomisi | Müşteri başına işletim süresi ve açık lisans/donanım/destek varsayımlarıyla toplam maliyet |

Sayısal üstünlük hedefleri başlangıç ölçümü ve pilot sonuçlarıyla belirlenecek. Henüz ölçülmeyen performans veya tespit oranı satış iddiası olarak kullanılmayacak.

## Rekabet referansları

- Microsoft Purview Endpoint DLP: USB, pano, yazdırma, ağ paylaşımı ve desteklenen tarayıcı işlemleri gibi kanallar belgeleniyor. Bu alanlar yenilik iddiasından önce temel kapsam hedefidir: https://learn.microsoft.com/en-us/purview/endpoint-dlp-learn-about
- Netskope: üretici, üretken yapay zekâ veri koruması ve kullanıcı yönlendirmesi sunuyor. “AI DLP yalnızca bizde” iddiası kullanılamaz: https://www.netskope.com/products/securing-generative-ai

Bu iki referans tüm pazarın araştırıldığı anlamına gelmez. Forcepoint, Broadcom/Symantec, Fortra ve diğer adaylar için sürüm, lisans ve uygulamalı test kapsamı ayrı doğrulanacak.

## Mevcut durum ve sonraki uygulama

Mevcut kaynak sürümü 1.2.0-rc.11. Merkezi yönetim, belge taraması, kontrollü USB/SMTP akışları, sınırlı tarayıcı uzantısı ve yerel güvenlik temelleri mevcut. Sistem genelinde bütün kanalları kapsayan koruma tamamlanmadı. Geçmiş test raporları yalnızca kendi kaynak parmak izleri için geçerlidir.

İlk teknik iş: masaüstü ajanın şifreli yedeğine merkez kimliği ve yarım kalan kayıt durumunu tutarlı biçimde dahil etmek; eksik kimlikle bağımsız moda düşmeyi engellemek. Windows hizmetinin yöneticiye özel makine kimliği web panelinin yedeğine aktarılmayacak. Sonrasında temiz Windows hizmet kabulü ve kanal kapsamı üzerinde ilerlenir. Bu belgenin yazılması bu işlerin tamamlandığı anlamına gelmez.
