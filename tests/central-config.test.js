'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {loadCentralConfig}=require('../central-config');
test('TLS configuration rejects a different host and expired or not-yet-valid certificates',t=>{
 const env={DLP_CENTRAL_PORT:'9443',DLP_CENTRAL_ORIGIN:'https://localhost:9443',DLP_CENTRAL_CERT:path.join(__dirname,'fixtures','central-test-cert.pem'),DLP_CENTRAL_KEY:path.join(__dirname,'fixtures','central-test-key.pem')};
 assert.throws(()=>loadCentralConfig({...env,DLP_CENTRAL_ORIGIN:'https://different.example:9443'}),/kapsamıyor/);
 assert.throws(()=>loadCentralConfig({...env,DLP_CENTRAL_ORIGIN:'https://127.0.0.2:9443'}),/kapsamıyor/);
 assert.equal(loadCentralConfig({...env,DLP_CENTRAL_ORIGIN:'https://127.0.0.1:9443'}).requireMfa,true);
 const certificate=new(require('node:crypto').X509Certificate)(fs.readFileSync(env.DLP_CENTRAL_CERT));
 t.mock.method(Date,'now',()=>Date.parse(certificate.validTo));
 assert.throws(()=>loadCentralConfig(env),/geçerlilik/);
 Date.now.mock.mockImplementation(()=>Date.parse(certificate.validFrom)-1);
 assert.throws(()=>loadCentralConfig(env),/geçerlilik/);
});
test('central configuration rejects partial TLS, mismatched ports and remote plaintext',()=>{
 assert.throws(()=>loadCentralConfig({DLP_CENTRAL_SERVICE:'windows-service'}),/TLS/);assert.throws(()=>loadCentralConfig({DLP_CENTRAL_SERVICE:'invalid'}),/hizmet kipi/);
 for(const env of [{DLP_CENTRAL_CERT:'missing.pem'},{DLP_CENTRAL_KEY:'missing.pem'},{DLP_CENTRAL_PORT:'0'},{DLP_CENTRAL_PORT:'4417evil'},{DLP_CENTRAL_ORIGIN:'http://remote.example:4417'},{DLP_CENTRAL_ORIGIN:'http://127.0.0.1:9999'},{DLP_CENTRAL_ORIGIN:'http://user:secret@127.0.0.1:4417'}])assert.throws(()=>loadCentralConfig(env));
});
test('central file configuration resolves protected paths and defaults TLS to mandatory MFA',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-central-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');
 fs.writeFileSync(file,JSON.stringify({dataDir:'data',port:9443,origin:'https://localhost:9443',tlsCertFile:path.join(__dirname,'fixtures','central-test-cert.pem'),tlsKeyFile:path.join(__dirname,'fixtures','central-test-key.pem')}));const config=loadCentralConfig({DLP_CENTRAL_SERVER_CONFIG:file},dir);assert.equal(config.requireMfa,true);assert.equal(config.dataDir,path.join(dir,'data'));assert.equal(config.host,'0.0.0.0');assert.equal(fs.existsSync(config.dataDir),false);
 assert.throws(()=>loadCentralConfig({DLP_CENTRAL_SERVER_CONFIG:file,DLP_CENTRAL_SERVICE:'windows-service',DLP_CENTRAL_REQUIRE_MFA:'0'},dir),/MFA/);assert.equal(loadCentralConfig({DLP_CENTRAL_SERVER_CONFIG:file,DLP_CENTRAL_SERVICE:'console-test'},dir).serviceMode,'console-test');
 fs.writeFileSync(file,JSON.stringify({requireMfa:'false'}));assert.throws(()=>loadCentralConfig({DLP_CENTRAL_SERVER_CONFIG:file},dir),/mantıksal/);
});
