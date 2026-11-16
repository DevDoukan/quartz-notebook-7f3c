'use strict';
const fs = require('node:fs');

function outlookManifest(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Outlook için şirket HTTPS kök adresi gereklidir.');
  }
  const base = url.origin.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const version = require('../package.json').version;
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
  if (!parts || parts.slice(1).some(value => value !== undefined && Number(value) > 65535)) {
    throw new Error('Ürün sürümü Outlook manifest sürümüne dönüştürülemedi.');
  }
  const manifestVersion = parts.slice(1).map(value => String(Number(value || 0))).join('.');
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xsi:type="MailApp">
 <Id>7412231d-dbb5-4671-b305-fd50ac63c5b2</Id>
 <Version>${manifestVersion}</Version>
 <ProviderName>MTB Güvenlik Ve Bilişim Sistemleri - Enez ERCAN</ProviderName>
 <DefaultLocale>tr-TR</DefaultLocale>
 <DisplayName DefaultValue="Kalkan DLP"/>
 <Description DefaultValue="Şirket politikasına göre gönderim öncesi e-posta denetimi."/>
 <IconUrl DefaultValue="${base}/outlook/icon-64.png"/>
 <HighResolutionIconUrl DefaultValue="${base}/outlook/icon-128.png"/>
 <SupportUrl DefaultValue="https://kalkandlp.com.tr"/>
 <AppDomains><AppDomain>${base}</AppDomain></AppDomains>
 <Hosts><Host Name="Mailbox"/></Hosts>
 <Requirements><Sets><Set Name="Mailbox" MinVersion="1.1"/></Sets></Requirements>
 <FormSettings><Form xsi:type="ItemRead"><DesktopSettings>
  <SourceLocation DefaultValue="${base}/outlook/status.html"/>
  <RequestedHeight>250</RequestedHeight>
 </DesktopSettings></Form></FormSettings>
 <Permissions>ReadWriteMailbox</Permissions>
 <Rule xsi:type="ItemIs" ItemType="Message" FormType="Read"/>
 <DisableEntityHighlighting>false</DisableEntityHighlighting>
 <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
   <Requirements><bt:Sets DefaultMinVersion="1.12"><bt:Set Name="Mailbox"/></bt:Sets></Requirements>
   <Hosts><Host xsi:type="MailHost">
    <Runtimes><Runtime resid="WebRuntime"><Override type="javascript" resid="JSRuntime"/></Runtime></Runtimes>
    <DesktopFormFactor>
     <ExtensionPoint xsi:type="MessageComposeCommandSurface">
      <OfficeTab id="TabDefault"><Group id="KalkanGroup">
       <Label resid="KalkanLabel"/>
       <Control xsi:type="Button" id="KalkanConnect">
        <Label resid="KalkanLabel"/>
        <Supertip><Title resid="KalkanLabel"/><Description resid="KalkanDescription"/></Supertip>
        <Icon><bt:Image size="16" resid="KalkanIcon"/><bt:Image size="32" resid="KalkanIcon"/><bt:Image size="80" resid="KalkanIcon"/></Icon>
        <Action xsi:type="ShowTaskpane"><SourceLocation resid="KalkanConnectUrl"/></Action>
       </Control>
      </Group></OfficeTab>
     </ExtensionPoint>
     <ExtensionPoint xsi:type="LaunchEvent">
      <LaunchEvents><LaunchEvent Type="OnMessageSend" FunctionName="kalkanOnMessageSend" SendMode="Block"/></LaunchEvents>
      <SourceLocation resid="WebRuntime"/>
     </ExtensionPoint>
    </DesktopFormFactor>
   </Host></Hosts>
   <Resources>
   <bt:Images><bt:Image id="KalkanIcon" DefaultValue="${base}/outlook/icon-64.png"/></bt:Images>
   <bt:Urls>
    <bt:Url id="WebRuntime" DefaultValue="${base}/outlook/runtime.html"/>
    <bt:Url id="JSRuntime" DefaultValue="${base}/outlook/runtime.js"/>
    <bt:Url id="KalkanConnectUrl" DefaultValue="${base}/outlook/status.html"/>
   </bt:Urls>
   <bt:ShortStrings><bt:String id="KalkanLabel" DefaultValue="Kalkan DLP"/></bt:ShortStrings>
   <bt:LongStrings><bt:String id="KalkanDescription" DefaultValue="Bu iletiyi şirket DLP denetimine bağlayın."/></bt:LongStrings>
   </Resources>
  </VersionOverrides>
 </VersionOverrides>
</OfficeApp>
`;
}

if (require.main === module) {
  try {
    const [origin, output] = process.argv.slice(2);
    if (!output || process.argv.length !== 4) throw new Error('Kullanım: node tools/outlook-manifest.cjs HTTPS_ORIGIN OUTPUT.xml');
    fs.writeFileSync(output, outlookManifest(origin), { encoding: 'utf8', flag: 'wx' });
    console.log('Outlook manifesti oluşturuldu. Office şema ve gerçek dağıtım kabulü gereklidir.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { outlookManifest };
