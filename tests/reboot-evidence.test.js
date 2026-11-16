'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessReboot}=require('../tools/reboot-evidence.cjs');
test('reboot acceptance requires a newer boot, both service identities and the target Client version',()=>{
 const before={bootTime:'2026-10-01T00:00:00Z'};
 const after={bootTime:'2026-10-02T00:00:00Z',checkedAt:'2026-10-02T00:01:00Z',passed:true,newBootObserved:true,failures:[],
  services:['KalkanDlpAgent','KalkanDlpCentral'].map(Name=>({Name,State:'Running',StartMode:'Auto',StartName:'NT SERVICE\\'+Name})),
  clientHealth:{application:'Kalkan DLP',deployment:'service',version:'1.2.0-rc.31'}};
 assert.equal(assessReboot(before,after,'1.2.0-rc.31').passed,true);
 const old=assessReboot(before,after,'1.2.0-rc.32');assert.equal(old.observed,true);assert.equal(old.passed,false);
 for(const patch of [{bootTime:before.bootTime},{bootTime:'invalid'},{checkedAt:before.bootTime},{services:[]},
  {services:[...after.services,after.services[0]]},{services:after.services.map(s=>({...s,StartName:'LocalSystem'}))},
  {services:after.services.map(s=>({...s,State:'Stopped'}))},{failures:['health failed']},{newBootObserved:false},
  {clientHealth:{...after.clientHealth,deployment:'desktop'}}]) {
  assert.equal(assessReboot(before,{...after,...patch},'1.2.0-rc.31').passed,false,JSON.stringify(patch));
 }
});
