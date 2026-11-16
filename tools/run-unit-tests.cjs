'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),files=fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.js')).map(name=>path.join('tests',name));
if(process.platform==='win32'){const build=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools','build-agent.ps1')],{cwd:root,stdio:'inherit',windowsHide:true});if(build.status!==0)process.exit(1);}
const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;
