'use strict';
function matchesHost(host,pattern){return pattern.startsWith('*.')?(host.endsWith(pattern.slice(1))||host===pattern.slice(2)):host===pattern;}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    const settings=await chrome.storage.local.get({key:'',domains:[],enabled:false});
    if(message.action==='status'){
      if(sender.tab)throw Error('İzin verilmeyen işlem.');
      const response=await fetch('http://127.0.0.1:4317/api/extension/policy',{headers:{'X-DLP-Key':settings.key},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Yerel servis veya eşleştirme anahtarı doğrulanamadı.');
      return {...await response.json(),connected:true};
    }
    if(!sender.tab||!sender.url)throw Error('Geçersiz sayfa.');
    const url=new URL(sender.url);
    const enabled=settings.enabled&&settings.domains.some(domain=>matchesHost(url.hostname,domain));
    if(message.action==='scope')return {enabled};
    if(!enabled)return {decision:'allow',findings:[],inactive:true};
    if(message.action!=='check')throw Error('Geçersiz işlem.');
    const response=await fetch('http://127.0.0.1:4317/api/extension/check',{method:'POST',headers:{'Content-Type':'application/json','X-DLP-Key':settings.key},body:JSON.stringify({text:message.text,files:message.files}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Yerel kontrol başarısız.');return result;
  })().then(respond).catch(error=>respond({decision:'block',error:error.message||'DLP servisine erişilemedi. İşlem durduruldu.'}));
  return true;
});
if(typeof module!=='undefined')module.exports={matchesHost};
