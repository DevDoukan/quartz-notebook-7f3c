'use strict';
function assessReboot(before, after, version) {
 const previous=Date.parse(before.bootTime), boot=Date.parse(after.bootTime), checked=Date.parse(after.checkedAt);
 const services=['KalkanDlpAgent','KalkanDlpCentral'];
 const observed=after.passed===true&&after.newBootObserved===true&&Array.isArray(after.failures)&&after.failures.length===0&&
  Number.isFinite(previous)&&Number.isFinite(boot)&&Number.isFinite(checked)&&boot>previous&&checked>=boot&&
  services.every(name=>Array.isArray(after.services)&&after.services.filter(s=>s.Name===name).length===1&&after.services.some(s=>s.Name===name&&s.State==='Running'&&s.StartMode==='Auto'&&s.StartName==='NT SERVICE\\'+name))&&
  after.clientHealth?.application==='Kalkan DLP'&&after.clientHealth?.deployment==='service';
 return {passed:observed&&after.clientHealth.version===version,observed,installedVersion:after.clientHealth?.version||null,targetVersion:version,
  reason:!observed?'Yeniden başlatma kanıtı eksik veya tutarsız.':after.clientHealth.version!==version?'Yeniden başlatma doğrulandı; kurulu Client sürümü yayın adayından farklı.':'Yayın adayı Client ve iki hizmet oturum açıldıktan sonra doğrulandı.',
  scope:'Post-login service state and Client health only; Server binary version, TLS, pre-login startup and enforcement require separate evidence.'};
}
module.exports={assessReboot};
