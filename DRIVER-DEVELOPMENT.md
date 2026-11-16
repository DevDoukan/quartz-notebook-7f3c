# Sistem genelinde Windows denetimi: açık geliştirme kapısı

Mevcut ürünün Windows dosya sistemi minifiltresi yoktur. Hizmetin çalışması, kayıt defterindeki USB yazma koruması veya başarılı uygulama içi kopyalama testi bu katmanın varlığına kanıt değildir. Bu belge bir sürücü uygulaması veya kabul raporu değildir.

## Mevcut ortamı doğrulama

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/check-driver-toolchain.ps1`

Araç Visual Studio C++/MSBuild, x64 derleyici ve eşleşen WDK fltKernel.h/FltMgr.lib dosyalarını arar. Sonuç `.test-artifacts/driver-toolchain.json` içine yazılır. Eksik araçta çıkış kodu 1 olur. Araç kurulum yapmaz; sürücü yüklemez, Windows güvenliğini veya imza zorlamasını değiştirmez. Araçları bulması bile başarılı derleme anlamına gelmez; derleme ve gerçek sürücü testleri ayrı kanıt gerektirir.

30 Ekim 2026 kontrolünde bu ortamda MSVC, Visual Studio MSBuild ve WDK kernel geliştirme dosyaları bulunamadı. Windows Kits altında hata ayıklama/performance araçlarının bulunması WDK derleme ortamı olduğu anlamına gelmez. Güncel yerel rapor esas alınır.

## Uygulama ve kabul gereksinimleri

31 Ekim 2026 tekrar kontrolünde MSBuild/MSVC/WDK hâlâ bulunamadı ve oturum yükseltilmiş değildi. Güncel Microsoft kılavuzu VS 2026 + WDK 28000.2526 eşleşmesini; VS 2022 ile devam edilecekse WDK 26100.6584 kullanımını belirtiyor. SDK/WDK build numaraları eşleşmeli. Resmi bileşen listesi `.build/tools/wdk-desktop.vsconfig` dosyasına indirildi; bu dosyanın indirilmesi araçların kurulduğu anlamına gelmez. Kaynak: https://learn.microsoft.com/en-us/windows-hardware/drivers/download-the-wdk ve https://learn.microsoft.com/en-us/windows-hardware/drivers/install-the-wdk-using-winget

Geliştirme bilgisayarında Visual Studio Installer ile uygun sürümü seçip Desktop development with C++, WDK ve kılavuzdaki Spectre bileşenlerini kurun. Ardından aynı build ailesinden SDK ve WDK'yı kurun ve `tools/check-driver-toolchain.ps1` kontrolünü yeniden çalıştırın. Alternatif EWDK, derleyici/SDK/WDK içeren bağımsız bir ISO ortamıdır; resmi kılavuzdaki LaunchBuildEnv.cmd adımıyla kullanılır. Ticari geliştirmede seçilen Visual Studio sürümünün kuruluş lisans uygunluğu ayrıca kontrol edilmelidir.

1. Desteklenen Windows/SDK/WDK/C++ araç zincirini sabitlemek; gerçek x64 sürücü derlemesi ve statik analiz raporu üretmek.
2. FltMgr iletişim portunu yalnızca yetkili hizmet kimliğine açmak; protokol sürümü, uzunluk, istek/yanıt bağı, zaman aşımı ve bozuk mesajları doğrulamak. FltSendMessage için STATUS_TIMEOUT başarı sınıfında olduğundan yalnızca NT_SUCCESS kontrolüyle izin verilmez.
3. İçerik kararını aktarılan gerçek dosya nesnesi ve sürümüyle bağlamak; yol adına dayanarak alınmış eski tarama kararını yeni içerikte kullanmamak. Parçalı/rastgele yazma, önbellek, memory-mapped I/O, rename, link, alternate data stream, yeniden adlandırılmış belge ve yarış durumlarını kapsamak.
4. USB sabit diskleri dahil aygıt kimliğini doğrulamak; işletim sistemi dosyalarını veya normal diskleri yanlışlıkla kilitlememek. Uygulama ve hizmet yeniden başlatma, port kopması, gecikme ve kaynak tükenmesinde açık hata politikası uygulamak.
5. İzole test Windows ortamında Driver Verifier, yeniden başlatma, yükleme/kaldırma, standart kullanıcı, Explorer/farklı uygulamalar, fiziksel USB ve antivirüs birlikte çalışma testlerini tamamlamak.
6. Microsoft tarafından atanmış ürün filtre sırası kimliğini (altitude), üretim imzasını ve güncelleme/kurtarma yolunu doğrulamak. Başka üreticinin veya örnek projenin altitude değeri üretim kimliği olarak kullanılmaz.

Gerçek minifilter kodu, derleme çıktısı ve yukarıdaki test kanıtları bulunmadan bu iş tamamlandı işaretlenmez. Kullanıcının mevcut Windows ortamında test imzası açılması veya doğrulanmamış sürücü yüklenmesi bu hazırlığın bir parçası değildir.

## Resmî teknik kaynaklar

- WDK araç zinciri: https://learn.microsoft.com/en-us/windows-hardware/drivers/install-the-wdk-using-nuget
- FltMgr kullanıcı/çekirdek iletişimi: https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/communication-between-user-mode-and-kernel-mode
- Yanıt ve zaman aşımı semantiği: https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltsendmessage
- Üretim altitude talebi: https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/minifilter-altitude-request
- Sürücü imzalama: https://learn.microsoft.com/en-us/windows-hardware/drivers/install/windows-driver-signing-tutorial
