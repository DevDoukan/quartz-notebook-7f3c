'use strict';
(()=>{
  const replay=new WeakSet(),pending=new WeakSet();
  async function ask(message){try{return await chrome.runtime.sendMessage(message);}catch{return {decision:'block',error:'DLP uzantısı kullanılamıyor. Sayfayı yenileyin.'};}}
  async function inScope(){const result=await ask({action:'scope'});return result.enabled===true||!!result.error;}
  function message(text){alert('Kalkan DLP\n\n'+text);}
  function values(form){
    const fields=[...form.elements].filter(el=>el.matches('input:not([type=password]):not([type=file]):not([type=hidden]):not([type=submit]),textarea,select'));
    return [...fields,...form.querySelectorAll('[contenteditable=true]')].filter(el=>!el.matches(':disabled')).map(el=>el.value??el.textContent??'').join('\n');
  }
  function fileInputs(form){return [...form.elements].filter(el=>el.matches('input[type=file]:not(:disabled)'));}
  async function files(inputs){const selected=inputs.flatMap(el=>[...el.files]);if(selected.length>5||selected.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw Error('En fazla 5 dosya ve toplam 10 MB denetlenebilir.');return Promise.all(selected.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:String(reader.result).split(',')[1]||''});reader.onerror=()=>reject(Error('Dosya okunamadı.'));reader.readAsDataURL(file);})) );}
  function approved(result){if(result.error){message(result.error+'\nİşlem durduruldu.');return false;}if(result.decision==='block'){message(`${result.findings?.length||0} hassas veri bulgusu. Politika bu aktarımı engelledi.`);return false;}if(result.decision==='warn')return confirm(`Kalkan DLP\n\n${result.findings.length} hassas veri bulgusu var. İzleme modunda devam etmek istiyor musunuz?`);return true;}
  // Stop synchronously before any page handler receives the original event.
  // Scope is evaluated afterwards. Unprotected pages receive a replayed event.
  window.addEventListener('submit',event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement)||replay.has(form))return;
    event.preventDefault();event.stopImmediatePropagation();if(pending.has(form))return;pending.add(form);
    (async()=>{
      if(await inScope()){
        const text=values(form);
        const selected=await files(fileInputs(form)),snapshot=JSON.stringify({text,files:selected});
        const result=await ask({action:'check',text,files:selected});
        if(!approved(result))return;
        if(snapshot!==JSON.stringify({text:values(form),files:await files(fileInputs(form))})){message('Kontrol sırasında içerik değişti. Formu tekrar gönderin.');return;}
      }
      replay.add(form);try{form.requestSubmit(event.submitter?.isConnected?event.submitter:undefined);}finally{replay.delete(form);}
    })().catch(error=>message(error.message+'\nİşlem durduruldu.')).finally(()=>pending.delete(form));
  },true);
  window.addEventListener('change',event=>{
    const input=event.target;if(!(input instanceof HTMLInputElement)||input.type!=='file'||replay.has(input))return;
    event.stopImmediatePropagation();if(pending.has(input))return;pending.add(input);
    (async()=>{if(await inScope()){const selected=await files([input]),result=await ask({action:'check',text:'',files:selected});if(!approved(result)){input.value='';return;}if(JSON.stringify(selected)!==JSON.stringify(await files([input]))){input.value='';message('Kontrol sırasında dosya seçimi değişti. Dosyayı yeniden seçin.');return;}}
      replay.add(input);try{input.dispatchEvent(new Event('change',{bubbles:true}));}finally{replay.delete(input);}
    })().catch(error=>{input.value='';message(error.message+'\nDosya seçimi kaldırıldı.');}).finally(()=>pending.delete(input));
  },true);
})();
