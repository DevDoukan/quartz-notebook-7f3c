'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),net=require('node:net');
const {createCentralApp}=require('../central-server'),{createApp}=require('../server'),{transport}=require('../central-client'),{signedTestServerLicense}=require('./helpers');
test('real endpoint obtains central policy over HTTPS and reports a blocked operation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-connected-')),centralDir=path.join(root,'central'),endpointDir=path.join(root,'endpoint');
 const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const cert=fs.readFileSync(path.join(__dirname,'fixtures','central-test-cert.pem')),key=fs.readFileSync(path.join(__dirname,'fixtures','central-test-key.pem')),origin=`https://127.0.0.1:${port}`,license=signedTestServerLicense();
 const central=createCentralApp({dataDir:centralDir,publicOrigin:origin,tls:{cert,key},requireMfa:false,serverLicense:license.serverLicense});let endpoint;
 t.after(async()=>{await endpoint?.close();await central.close();fs.rmSync(root,{recursive:true,force:true});});await new Promise(resolve=>central.server.listen(port,'127.0.0.1',resolve));
 async function call(route,input,session){return new Promise((resolve,reject)=>{const data=JSON.stringify(input),req=https.request(origin+route,{method:'POST',ca:cert,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...(session?{Cookie:session.cookie,'X-DLP-Token':session.token}:{})}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text),cookie:res.headers['set-cookie']?.[0].split(';')[0]}));});req.on('error',reject);req.end(data);});}
 const setup=await call('/api/auth/setup',{setupKey:fs.readFileSync(path.join(centralDir,'setup-key.txt'),'utf8').trim(),username:'centraladmin',password:'Central-integration-2026'}),session={cookie:setup.cookie,token:setup.body.token};assert.equal(setup.status,200);
 const tenant=await call('/api/tenants',{name:'Integrated company'},session);assert.equal(tenant.status,201);
 assert.equal((await call(`/api/tenants/${tenant.body.id}/policy`,{mode:'block',enabled:['card']},session)).status,200);
 const ticket=await call(`/api/tenants/${tenant.body.id}/enrollment`,{},session),registered=await transport(origin,{ca:cert})('/api/agent/enroll',{token:ticket.body.token,name:'Integrated PC'});
 const caFile=path.join(root,'ca.pem'),configFile=path.join(root,'connection.json');fs.writeFileSync(caFile,cert);fs.writeFileSync(configFile,JSON.stringify({origin,...registered,caFile}));
 endpoint=createApp({dataDir:endpointDir,env:{DLP_CENTRAL_CONFIG:configFile},testVendorPublicKey:license.keys.publicKey});await new Promise(resolve=>endpoint.server.listen(0,'127.0.0.1',resolve));await endpoint.syncCentral();
 const base=`http://127.0.0.1:${endpoint.server.address().port}`;
 const first=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupKey:fs.readFileSync(path.join(endpointDir,'setup-key.txt'),'utf8').trim(),username:'endpointadmin',password:'Endpoint-integration-2026'})});const auth=await first.json();assert.equal(first.status,200);
 const headers={'Content-Type':'application/json',Cookie:first.headers.get('set-cookie').split(';')[0],'X-DLP-Token':auth.token};
 const state=await(await fetch(base+'/api/state',{headers})).json();assert.equal(state.policy.mode,'block');assert.equal(state.central.revision,1);
 const override=await fetch(base+'/api/policy',{method:'POST',headers,body:JSON.stringify({mode:'audit',enabled:[]})});assert.equal(override.status,409);
 const inspect=await fetch(base+'/api/inspect',{method:'POST',headers,body:JSON.stringify({channel:'web',text:'Card 4242424242424242'})});const result=await inspect.json();assert.equal(inspect.status,200);assert.equal(result.decision,'block');
 await endpoint.syncCentral();const events=await new Promise((resolve,reject)=>{https.get(origin+`/api/tenants/${tenant.body.id}/events`,{ca:cert,headers:{Cookie:session.cookie}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve(JSON.parse(text)));}).on('error',reject);});
 assert.equal(events.events.length,1);assert.equal(events.events[0].data.decision,'block');assert.equal(JSON.stringify(events).includes('424242'),false);
 async function devices(){return new Promise((resolve,reject)=>{https.get(origin+`/api/tenants/${tenant.body.id}/devices`,{ca:cert,headers:{Cookie:session.cookie}},res=>{let raw='';res.on('data',part=>raw+=part);res.on('end',()=>resolve(JSON.parse(raw).devices));}).on('error',reject);});}
 let report=(await devices())[0].policyStatus;assert.equal(report.state,'current');assert.equal(report.policyRevision,1);assert.equal(report.queuedEvents,1);assert.equal(report.agentVersion,require('../package.json').version);
 await endpoint.syncCentral();assert.equal((await devices())[0].policyStatus.queuedEvents,0);
 assert.equal((await call(`/api/tenants/${tenant.body.id}/policy`,{mode:'audit',enabled:['card']},session)).status,200);assert.equal((await devices())[0].policyStatus.state,'outdated');
 await endpoint.syncCentral();assert.equal((await devices())[0].policyStatus.state,'outdated');await endpoint.syncCentral();assert.equal((await devices())[0].policyStatus.state,'current');assert.equal((await devices())[0].policyStatus.policyRevision,2);
 const inspected=await fetch(base+'/api/inspect',{method:'POST',headers,body:JSON.stringify({channel:'web',text:'Card 4242424242424242'})});assert.equal((await inspected.json()).decision,'warn');
});
