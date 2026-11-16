# Kalkan DLP test ortamı ve ağ düzeni

## Mevcut yerel hazırlık

1 Kasım 2026 kontrolünde `KalkanDLP-Test` makinesi çalışıyor. 4 GB RAM, üç sanal işlemci, EFI ve 64 GB dinamik disk tanımlıdır. Windows değerlendirme ISO’su sanal DVD’ye bağlandı. Sanal ağ, pano, sürükle/bırak ve paylaşılan klasörler kapalıdır. Ana bilgisayarın Hyper-V ve güvenlik ayarları değiştirilmedi. Windows kurulumu henüz doğrulanmadı.

Windows medyası `D:\KalkanDLP-Test\26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso` dosyasıdır. Ölçülen SHA-256: `BC3F24086EBADC94489066B5AD78089E2CF5C3491E90E790BB81A2B199C10E38`. Resmi ISO özetiyle karşılaştırma yapılmadı; medyadaki setup.exe imzasının geçerliliği tüm ISO’nun doğrulandığını kanıtlamaz. Ana bilgisayarda setup.exe çalıştırılmadı. EWDK ISO’su Windows kurulum medyası değildir.

İki işlemcili EFI takılması yalnızca bu VM üç işlemciye geçirilince aşıldı. Son kayıt DVD önyükleyicisine ulaşıldıktan sonra VMBootFail gösteriyor; tuşa basma süresinin kaçması olasıdır fakat görsel olarak doğrulanmadı. Ekran kontrol aracı görüntü yakalamada zaman aşımına uğruyor. Yerel Windows testi hazır sayılmaz. Kullanıcının açık talebiyle **snapshot alınmayacak**; geri dönüş yöntemi atılabilir test VM’sini ISO’dan yeniden kurmaktır. Kurulum öncesi D sürücüsünün boş alanı yeniden ölçülmelidir; 64 GB dinamik kapasite ayrılmış fiziksel alan değildir.

## Sabit IP veya açık modem portu gerekiyor mu?

Yerel sürücü, yeniden başlatma ve fiziksel USB testleri için gerekmez. Server ve Client aynı test Windows ortamında çalıştırılabilir; bu yalnızca tek makine kabulüdür. Ayrı cihazdan HTTPS bağlantı ve şirketler arası izolasyon ayrıca sınanmalıdır.

Client kendi şirket Server'ına erişir. Üretici lisans servisine yalnızca Server HTTPS bağlantısı kurar. Test bilgisayarının internetten erişilebilir olması gerekmez. Aynı yerel ağdaki iki cihaz arasında modem port yönlendirmesi gerekmez; Server'ın seçilen HTTPS portuna Windows güvenlik duvarı izni, doğru DNS ve güvenilir sertifika gerekir.

Uzak arkadaş bilgisayarı kullanıcıya ait Server'a doğrudan erişemiyorsa bu yerel USB testini engellemez. Uçtan uca uzak bağlantı testi için ayrıca özel ağ/VPN veya erişilebilir bir test Server'ı hazırlanmalıdır. Sabit IP gereksinimi seçilen ağ çözümüne bağlıdır; modemden yönetim panelini internete açmak bu testin önkoşulu değildir. Uzaktan erişim aracı tek başına Client'ın Server'a ağ erişimini kanıtlamaz.

## İlk sürücü yüklemesinden önce

### Sanal Windows medyası

Microsoft'un [Windows 11 Enterprise Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise) sayfası 90 günlük değerlendirme ve indirmeden önce kayıt adımını belirtir. Bu süreli test lisansıdır; müşteri ürününe Windows lisansı dahil edildiği anlamına gelmez. Kayıt veya Microsoft hesabı bilgileri bu sohbette paylaşılmamalıdır. Alternatif olarak sanal makinede kullanıma uygun mevcut Windows lisansı ve resmi ISO kullanılabilir.

1. x64 Windows ISO'sunu resmi kaynaktan temin edin; indirme kaynağını ve varsa Microsoft SHA-256 değerini kaydedin.
2. ISO'yu geliştirme EWDK ISO'sundan ayrı adlandırın. ISO'nun ana bilgisayarda `setup.exe` dosyasını çalıştırmayın; hedef yalnızca `KalkanDLP-Test` sanal makinesidir.
3. İndirme ve sanal disk büyümesi için boş alanı yeniden ölçün. ISO'yu ve VM'yi aynı diskte tutmak boş alan ihtiyacını artırır.
4. ISO sanal DVD'ye bağlandıktan sonra Windows kurulumundaki disk seçimini doğrulayın: hedef VM'nin 64 GB sanal diskidir. Ana bilgisayarın fiziksel diskine raw erişim eklemeyin.
5. Lisans koşulları ve hesap adımları tamamlanıp Windows açıldıktan sonra konuk sürüm/build bilgisini doğrulayın. Bu ortamda snapshot almayın; kullanıcı yeniden kurulumla geri dönmeyi seçti. Yalnızca atılabilir test verisi kullanın.

ISO sanal DVD’ye bağlandı; Windows kurulumu, lisans kabulü ve konuk işletim sistemi doğrulaması henüz tamamlanmadı.

- Üretim verisi olmayan, sahibi tarafından teste ayrılmış Windows x64 ortamı kullanın. Arkadaşın günlük kullanılan bilgisayarı yalnızca başka bilgisayar olduğu için uygun test ortamı sayılmaz.
- İlk geliştirme testi sanal Windows'ta yapılabilir; fiziksel USB kabulü ayrıca gerçek aygıt veya doğrulanmış USB yönlendirmesi gerektirir.
- Yönetici erişimi, yerel konsol/kurtarma erişimi ve yeniden kurulum medyası hazır olmalıdır. Kullanıcının talebiyle snapshot alınmayacaktır. Sürücü hatası yeniden başlatma veya mavi ekran oluşturabilir; yalnızca uzaktan bağlantıya güvenilmemelidir.
- Şimdiki teslim kurucuları geliştirme SYS dosyasını içermez. INF/altitude, imza ve yükleme/kaldırma akışı tamamlanmadan elle SYS kopyalayıp hizmet oluşturmayın. Bu kılavuz yükleme yetkilendirmesi veya sürücünün hazır olduğu iddiası değildir.

## Ayrı kabul kanıtları

1. Sürücüsüz Server/Client kurulum, yükseltme ve veri koruma.
2. Test ortamında sürücü yükleme/kaldırma, yeniden başlatma ve Driver Verifier.
3. Aynı makinede gerçek temiz/hassas dosya, USB, eşzamanlı yazma ve bellek eşleme davranışı.
4. Ayrı cihazdan Server HTTPS, kayıt, politika ve lisans yenilemesi.
5. Bağlantı kesilmesi, lisans süresi dolması ve yeniden bağlantı.

Bir aşamanın geçmesi diğer aşamaları geçmiş sayılmaz. Günlük kullanılan mevcut PC'de yalnızca rc.29 Client/Server hizmetlerinin yeniden başlatma sonrası çalışması doğrulandı; geliştirme çekirdek sürücüsü yüklenmedi.
