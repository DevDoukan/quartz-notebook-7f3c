'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {openCentral}=require('../central-store');
test('device policy reports are scoped to credentials, validated, persistent and compared with current policy',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalkan-device-status-'));let clock=1000,central=openCentral(dir,{now:()=>clock});t.after(()=>{central.close();fs.rmSync(dir,{recursive:true,force:true});});
 const tenant=central.createTenant('owner','A'),other=central.createTenant('other','B'),a=central.enroll(central.issueEnrollment('owner',tenant.id).token,'PC-A'),b=central.enroll(central.issueEnrollment('owner',tenant.id).token,'PC-B');
 const state=()=>central.devices('owner',tenant.id).find(device=>device.id===a.id).policyStatus;
 assert.equal(state(),null);const status={protocol:1,agentVersion:'1.2.0-rc.13',policyRevision:0,policyHash:null,queuedEvents:3};
 central.heartbeat(a.credential,{status});assert.equal(state().state,'unassigned');assert.equal(central.devices('owner',tenant.id).find(device=>device.id===b.id).policyStatus,null);
 central.setPolicy('owner',tenant.id,{mode:'block',enabled:['card']});assert.equal(state().state,'awaiting');
 const policy=central.heartbeat(a.credential).policy;status.policyRevision=policy.revision;status.policyHash=crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');clock++;
 central.heartbeat(a.credential,{status,id:b.id,tenant:other.id});assert.equal(state().state,'current');assert.equal(state().queuedEvents,3);assert.equal(state().reportedAt,clock);assert.throws(()=>central.devices('other',tenant.id),/yetkiniz/);
 for(const changes of [{protocol:2},{agentVersion:'<script>'},{queuedEvents:10001},{queuedEvents:-1},{policyRevision:1.5},{policyHash:'broken'},{policyRevision:0}]){assert.throws(()=>central.heartbeat(a.credential,{status:{...status,...changes}}),/Geçersiz/);assert.equal(state().state,'current');}
 central.heartbeat(a.credential,{status:{...status,policyHash:'0'.repeat(64)}});assert.equal(state().state,'mismatch');
 central.heartbeat(a.credential,{status:{...status,policyRevision:2}});assert.equal(state().state,'ahead');central.heartbeat(a.credential,{status});
 central.setPolicy('owner',tenant.id,{mode:'audit',enabled:['card']});assert.equal(state().state,'outdated');
 central.close();central=openCentral(dir,{now:()=>clock});assert.equal(state().state,'outdated');assert.equal(state().agentVersion,status.agentVersion);
 central.revoke('owner',tenant.id,a.id);assert.throws(()=>central.heartbeat(a.credential,{status}),/kimliği/);assert.equal(state().reportedAt,clock);
});
