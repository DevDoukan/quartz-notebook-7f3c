'use strict';
const fs=require('node:fs'),path=require('node:path'),tls=require('node:tls');
function loadCentralConfig(env=process.env,root=__dirname){
 const configFile=env.DLP_CENTRAL_SERVER_CONFIG?path.resolve(env.DLP_CENTRAL_SERVER_CONFIG):null;
 let input={};if(configFile){if(fs.statSync(configFile).size>16384)throw Error('Merkez yapılandırması çok büyük.');input=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));if(!input||Array.isArray(input)||typeof input!=='object')throw Error('Geçersiz merkez yapılandırması.');}
 const base=configFile?path.dirname(configFile):root;
 const resolve=value=>{if(typeof value!=='string'||!value.trim())throw Error('Geçersiz dosya yolu.');return path.resolve(base,value);};
 const port=Number(env.DLP_CENTRAL_PORT??input.port??4417);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Merkez portu 1–65535 arasında olmalı.');
 const certFile=env.DLP_CENTRAL_CERT??input.tlsCertFile,keyFile=env.DLP_CENTRAL_KEY??input.tlsKeyFile;
 if(!!certFile!==!!keyFile)throw Error('TLS sertifikası ve özel anahtarı birlikte belirtilmeli.');
 let tlsOptions;if(certFile){const certPath=resolve(certFile),keyPath=resolve(keyFile);for(const file of [certPath,keyPath])if(fs.statSync(file).size>65536)throw Error('TLS dosyası çok büyük.');tlsOptions={cert:fs.readFileSync(certPath),key:fs.readFileSync(keyPath)};tls.createSecureContext({...tlsOptions,minVersion:'TLSv1.2'});}
 const suppliedOrigin=env.DLP_CENTRAL_ORIGIN??input.origin;
 if(tlsOptions&&!suppliedOrigin)throw Error('TLS merkezi için HTTPS adresi gerekiyor.');
 const origin=new URL(suppliedOrigin||`http://127.0.0.1:${port}`);
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||origin.protocol!==(tlsOptions?'https:':'http:'))throw Error('Geçersiz merkez adresi veya TLS eşleşmesi.');
 if(Number(origin.port||(tlsOptions?443:80))!==port)throw Error('Merkez adresinin portu dinleme portuyla eşleşmeli.');
 if(tlsOptions){
  const certificate=new (require('node:crypto').X509Certificate)(tlsOptions.cert),now=Date.now();
  if(now<Date.parse(certificate.validFrom)||now>=Date.parse(certificate.validTo))throw Error('TLS sertifikasının geçerlilik süresi uygun değil.');
  const hostname=origin.hostname.replace(/^\[|\]$/g,'');
  const match=require('node:net').isIP(hostname)?certificate.checkIP(hostname):certificate.checkHost(hostname,{subject:'never',partialWildcards:false});
  if(!match)throw Error('TLS sertifikası merkez adresini kapsamıyor.');
 }
 if(!tlsOptions&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Uzak merkez erişimi TLS gerektirir.');
 let required=env.DLP_CENTRAL_REQUIRE_MFA===undefined?input.requireMfa:env.DLP_CENTRAL_REQUIRE_MFA!=='0';if(required===undefined)required=!!tlsOptions;if(typeof required!=='boolean')throw Error('requireMfa mantıksal değer olmalı.');
 const serviceMode=env.DLP_CENTRAL_SERVICE||null;if(serviceMode&&!['console-test','windows-service','systemd'].includes(serviceMode))throw Error('Geçersiz merkez hizmet kipi.');if(serviceMode&&(!tlsOptions||!required))throw Error('Merkez hizmeti TLS ve zorunlu MFA gerektirir.');
 const bundled=fs.existsSync(path.join(root,'runtime','node.exe'));
 const defaultDir=bundled?path.join(env.LOCALAPPDATA||require('node:os').homedir(),'KalkanDLPCentral','Data'):path.join(root,'central-data');
 const dataDir=env.DLP_CENTRAL_DATA_DIR??input.dataDir;
 return {dataDir:dataDir?resolve(dataDir):defaultDir,port,origin:origin.origin,host:tlsOptions?'0.0.0.0':'127.0.0.1',tls:tlsOptions,requireMfa:required,ca:input.caFile?fs.readFileSync(resolve(input.caFile)):undefined,configFile,serviceMode};
}
module.exports={loadCentralConfig};
