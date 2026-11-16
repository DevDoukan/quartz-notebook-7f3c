'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('central service installer parses in Windows PowerShell and rejects unprivileged or untrusted validation',{skip:process.platform!=='win32'},()=>{
 const file=path.resolve(__dirname,'..','scripts','Manage-CentralService.ps1'),env={...process.env};delete env.PSModulePath;
 const parse=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:KALKAN_PARSE_FILE,[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){$errors | ForEach-Object Message; exit 1}"],{env:{...env,KALKAN_PARSE_FILE:file},encoding:'utf8',windowsHide:true});assert.equal(parse.status,0,parse.stderr+parse.stdout);
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,'-Action','Validate','-AppRoot',path.resolve(__dirname,'..')],{env,encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);assert.match(result.stderr,/administrator|Program Files/);
});
