'use strict';
const $=id=>document.getElementById(id);
chrome.storage.local.get({key:'',domains:[],enabled:false}).then(s=>{$('key').value=s.key;$('domains').value=s.domains.join('\n');$('enabled').checked=s.enabled;});
$('settings').onsubmit=async event=>{
  event.preventDefault();const domains=$('domains').value.split(/\s+/).map(s=>s.trim().toLowerCase()).filter(Boolean),key=$('key').value.trim();
  if(!/^[a-f0-9]{64}$/.test(key)){$('status').textContent='Paneldeki 64 karakterlik anahtarı girin.';return;}
  if(domains.some(d=>! /^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(d))){$('status').textContent='Yalnızca alan adı girin. Örnek: portal.example.com';return;}
  if($('enabled').checked&&!domains.length){$('status').textContent='En az bir alan adı girin.';return;}
  await chrome.storage.local.set({key,domains,enabled:$('enabled').checked});
  const result=await chrome.runtime.sendMessage({action:'status'});
  $('status').textContent=result.error?'Ayarlar kaydedildi. '+result.error:`Bağlandı. ${result.policy.mode==='block'?'Engelleme':'İzleme'} modu. ${domains.length} alan adı tanımlı.`;
};
