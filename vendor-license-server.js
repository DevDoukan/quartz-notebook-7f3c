'use strict';
const https=require('node:https');
function createVendorLicenseServer({licenses,tls,origin}={}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!tls?.cert||!tls?.key)throw Error('Üretici lisans API HTTPS gerektirir.');
 let busy=0;
 const server=https.createServer({...tls,minVersion:'TLSv1.2'},async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(busy>=16){req.resume();return send(503,{error:'Service busy'});}busy++;
  try{if(req.headers.host!==url.host||req.headers.origin||req.headers.cookie)return send(403,{error:'Request rejected'});if(req.method!=='POST'||req.url!=='/api/v1/server/lease')return send(404,{error:'Not found'});
   const credential=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];if(!credential){try{licenses.lease(null,null);}catch(error){return send(error.status===429?429:401,{error:'Activation rejected'});}return send(401,{error:'Activation rejected'});}
   let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>4096)return send(413,{error:'Request too large'});parts.push(part);}let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return send(400,{error:'Invalid JSON'});}
   try{return send(200,licenses.lease(credential,input));}catch(error){return send(error.status===429?429:401,{error:'Activation rejected'});}
  }catch{if(!res.headersSent)send(400,{error:'Request failed'});}finally{busy--;if(!req.readableEnded)req.resume();}
 });server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;server.maxConnections=100;
 return {server,async close(){if(server.listening)await new Promise(resolve=>server.close(resolve));}};
}
module.exports={createVendorLicenseServer};
