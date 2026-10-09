import {test,expect,_electron as electron} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createPackage} from './fixtures.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const evidence=process.env.WB_EVIDENCE_DIR??resolve(root,'..','evidence','electron');
const packagedExecutable=join(root,'release','desktop','Open-K-Folds Workbench-win32-x64','Open-K-Folds Workbench.exe');
const packagedBackend=join(root,'release','desktop','Open-K-Folds Workbench-win32-x64','resources','backend','corpus-workbench.exe');
const executablePath=process.env.WB_ELECTRON_EXECUTABLE??packagedExecutable;
const binary=process.env.WB_DESKTOP_BACKEND??process.env.WB_BINARY??(existsSync(packagedBackend)?packagedBackend:join(root,'target','debug','corpus-workbench.exe'));
let serial=0;
function workspace(label){const directory=join(evidence,`${label}-${process.pid}-${++serial}`);mkdirSync(directory,{recursive:true});return directory}
async function launch(profile,store,project){
  const env={...process.env,WB_DESKTOP_USER_DATA:profile,WB_DESKTOP_BACKEND:binary};
  if(executablePath&&!process.env.WB_DESKTOP_BACKEND)delete env.WB_DESKTOP_BACKEND;
  delete env.ELECTRON_RUN_AS_NODE;delete env.WB_DESKTOP_STORE;delete env.WB_DESKTOP_PROJECT;
  if(store){env.WB_DESKTOP_STORE=store;env.WB_DESKTOP_PROJECT=project}
  // Explicit executable avoids Playwright's readiness loader with newer Electron.
  const application=await electron.launch({executablePath,args:[],cwd:root,env,timeout:30000});
  application.__qaPid=await application.evaluate(()=>process.pid);
  application.__qaProfile=profile;
  const page=await application.firstWindow();
  // Electron's native departure guard owns this decision. Chromium may emit an
  // unload dialog while a permitted window closes; handle its CDP close race.
  page.on('dialog',dialog=>{void dialog.accept().catch(()=>{})});
  await application.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setContentSize(1440,1000)});
  await application.evaluate(({dialog,app})=>{
    globalThis.__desktopQA={open:[],save:[],message:[],calls:[]};
    const {Backend}=process.mainModule.require(app.getAppPath()+'/desktop/backend.cjs');
    const originalRequest=Backend.prototype.request;
    Backend.prototype.request=function(...args){globalThis.__desktopQA.backendPid=this.child?.pid;return originalRequest.apply(this,args)};
    dialog.showOpenDialog=async(_window,options)=>{const q=globalThis.__desktopQA;q.calls.push({kind:'open',title:options?.title});const file=q.open.shift();return file?{canceled:false,filePaths:[file]}:{canceled:true,filePaths:[]}};
    dialog.showSaveDialog=async(_window,options)=>{const q=globalThis.__desktopQA;q.calls.push({kind:'save',title:options?.title});const file=q.save.shift();return file?{canceled:false,filePath:file}:{canceled:true}};
    dialog.showMessageBox=async(_window,options)=>{const q=globalThis.__desktopQA;q.calls.push({kind:'message',message:options?.message,buttons:options?.buttons});return {response:q.message.shift()??0,checkboxChecked:false}};
    dialog.showErrorBox=(title,content)=>globalThis.__desktopQA.calls.push({kind:'error',title,content});
  });
  return {application,page};
}
async function queue(application,kind,values){await application.evaluate((_electron,{kind,values})=>{globalThis.__desktopQA[kind]=values},{kind,values})}
async function state(page){return page.evaluate(()=>window.workbenchDesktop.state())}
async function head(page){return page.evaluate(async()=>{const response=await fetch('/api/view');if(!response.ok)throw new Error(await response.text());return response.json()})}
async function records(page){return page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('wb-correction-v1:journal')??'{}')))}
async function ready(page){await expect(page.locator('#save-state')).not.toBeEmpty();await expect(page.locator('[data-token="w1"]')).toBeVisible()}
async function draft(page,replacement,token='w2',backward=false){
  await page.locator('#tokens').focus();
  await page.evaluate(({token,backward})=>{const node=document.querySelector(`[data-token="${token}"] .reading-text`).firstChild;const end=node.textContent.length;window.getSelection().setBaseAndExtent(node,backward?end:0,node,backward?0:end)},{token,backward});
  await expect(page.locator('.selection-tools')).toBeVisible();
  await page.getByRole('button',{name:'Correct',exact:true}).click();
  await page.getByLabel('Proposed correction').fill(replacement);
  await expect(page.locator('#draft-explanation')).not.toContainText('Updating local draft');
  await expect.poll(async()=>{const saved=await records(page);return saved.some(record=>record.replacement===replacement)}).toBe(true);
}
async function sidecars(application){
  const pid=await application.evaluate(()=>globalThis.__desktopQA.backendPid);
  return Number.isSafeInteger(pid)?[pid]:[];
}
function alive(pid){try{process.kill(pid,0);return true}catch{return false}}
async function quit(application,pids=[]){
  await application.close();
  for(const pid of pids)await expect.poll(()=>alive(pid),{message:`Backend ${pid} stops with desktop`}).toBe(false);
  const runtime=join(application.__qaProfile,'runtime');
  expect(existsSync(runtime)?readdirSync(runtime):[], 'Normal shutdown removes private sidecar runtime files').toEqual([]);
}
async function interrupt(application,pids=[]){
  // Playwright starts cmd.exe on Windows; kill the real Electron parent, not cmd.
  const pid=application.__qaPid;process.kill(pid);
  await expect.poll(()=>alive(pid)).toBe(false);
  for(const child of pids)await expect.poll(()=>alive(child),{message:`Backend ${child} exits after parent interruption`}).toBe(false);
}
async function settleLayout(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function dragSplitter(page,selector,dx,dy){
  const r=await page.locator(selector).boundingBox();expect(r,`${selector} has a visible drag rail`).not.toBeNull();
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
  await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:3});await page.mouse.up();await settleLayout(page);
}
async function paneGeometry(application,page){
  const native=await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return {bounds:window.getBounds(),content:window.getContentBounds(),zoom:window.webContents.getZoomFactor()}});
  return {native,...await page.evaluate(()=>{
    const box=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}};
    return {viewport:{width:innerWidth,height:innerHeight,ratio:devicePixelRatio},navigation:box('#projects-pane'),properties:box('#properties-pane'),transcript:box('.transcript'),recording:box('#recording-pane'),preferred:{navigation:localStorage.getItem('wb-navigation-width'),properties:localStorage.getItem('wb-properties-width'),recording:localStorage.getItem('wb-recording-height')},recordingControl:{value:Number(document.querySelector('#timeline-resizer').getAttribute('aria-valuenow')),min:Number(document.querySelector('#timeline-resizer').getAttribute('aria-valuemin')),max:Number(document.querySelector('#timeline-resizer').getAttribute('aria-valuemax'))}};
  })};
}
async function captureNative(application,filename){
  // Electron zoom changes CSS pixels; native capture preserves the complete
  // content surface instead of cropping a CDP screenshot to CSS dimensions.
  await application.evaluate(async({BrowserWindow},filename)=>{const captured=await BrowserWindow.getAllWindows()[0].webContents.capturePage();process.mainModule.require('node:fs').writeFileSync(filename,captured.toPNG())},filename);
}
function nearPixels(actual,expected){expect(Math.abs(actual-expected)).toBeLessThanOrEqual(1)}

test.beforeAll(()=>{
  mkdirSync(evidence,{recursive:true});
  if(!existsSync(executablePath))throw new Error('Run npm run package:windows first, or set WB_ELECTRON_EXECUTABLE to a locally packaged Workbench executable');
  if(!existsSync(binary))throw new Error('Run npm run package:windows first, or set WB_DESKTOP_BACKEND to a built local sidecar');
  const asar=join(executablePath,'..','resources','app.asar');
  const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(join(evidence,'tested-package.json'),JSON.stringify({platform:process.platform,architecture:process.arch,started_utc:new Date().toISOString(),executable:executablePath,cli_backend:binary,backend_sha256:sha(binary),asar_sha256:existsSync(asar)?sha(asar):null,sidecar_override:!!process.env.WB_DESKTOP_BACKEND},null,2));
});

test('real Electron imports, corrects, reviews, exports, reopens and protects memory-only drafts',async()=>{
  const work=workspace('workflow'),source=createPackage(join(work,'source-package'));
  const sourceXML=readFileSync(join(source,'xmlfiles/interview.xml'),'utf8');
  const second=createPackage(join(work,'second-package'),'Second synthetic authority');
  const secondStore=join(work,'second-authority');
  execFileSync(binary,['import','--store',secondStore,'--package',second,'--project','second-preview'],{windowsHide:true});
  const profile=join(work,'desktop-profile');let application,page;
  try{
    ({application,page}=await launch(profile));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await expect(page.getByRole('heading',{name:'Corpus workbench',exact:true})).toBeVisible();
    expect(page.url()).toBe('workbench://app/');
    await queue(application,'open',[source]);await page.locator('#desktop-import').click();await ready(page);
    const initial=await head(page),originalState=await state(page),originalId=originalState.project.id;
    expect(initial.revision.id).toBe(1);expect(initial.documents).toHaveLength(2);
    expect(await page.evaluate(()=>({node:typeof window.require,process:typeof window.process,ipc:typeof window.ipcRenderer,secure:isSecureContext,locks:!!navigator.locks}))).toEqual({node:'undefined',process:'undefined',ipc:'undefined',secure:true,locks:true});
    const preferences=await application.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,webSecurity:p.webSecurity}});
    expect(preferences).toEqual({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true});
    expect(await page.evaluate(async()=>{try{await window.workbenchDesktop.openRecent('../../private');return 'accepted'}catch{return 'rejected'}})).toBe('rejected');

    await page.keyboard.press('Control+k');await expect(page.getByLabel('Find tokens',{exact:true})).toBeFocused();
    await page.getByLabel('Find tokens',{exact:true}).fill('');
    await page.getByRole('radio',{name:'Source lines',exact:true}).check();
    await expect(page.locator('#tokens')).toHaveAttribute('data-layout','lines');
    await page.locator('[data-token="w2"]').click();await expect(page.getByLabel('Human-corrected reading')).toBeVisible();
    await expect(page.locator('#audio-play')).toBeEnabled();
    await page.keyboard.press('Escape');await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:join(evidence,'electron-light-1440x1000.png')});
    await page.locator('#toggle-theme').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.screenshot({path:join(evidence,'electron-dark-1440x1000.png')});
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,760));
    await page.screenshot({path:join(evidence,'electron-compact-1100x760.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const selector of ['#navigation-resizer','#properties-resizer']){await page.locator(selector).focus();await page.keyboard.press('End')}
    expect(await page.locator('.transcript').evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(300);
    for(const selector of ['#navigation-resizer','#properties-resizer']){await page.locator(selector).focus();await page.keyboard.press('Home')}
    for(const selector of ['#navigate-documents','#navigate-sources'])expect(await page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),p=element.closest('.documents').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&element.scrollWidth<=element.clientWidth}),`${selector} fits minimum sidebar width`).toBe(true);
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));

    await page.getByRole('radio',{name:'Flowing paragraphs',exact:true}).check();
    await draft(page,'strolled');await page.screenshot({path:join(evidence,'electron-inline-preview-1440x1000.png')});await page.locator('#accept-draft').click();
    await expect(page.locator('#save-state')).toContainText('Saved R2');
    await expect(page.locator('[data-token="w2"] .reading-text')).toHaveText('strolled');
    expect((await head(page)).documents[0].tokens.find(token=>token.id==='w2').original).toBe('walked');
    await page.getByRole('button',{name:'History',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Per-edit history',exact:true})).toBeVisible();
    await expect(page.locator('#inspector-content')).toContainText('Correct w2 in place');
    await page.getByRole('button',{name:'Review',exact:true}).click();
    await page.getByLabel('Review rationale').fill('Synthetic desktop acceptance review only');
    await page.getByRole('button',{name:'Record review',exact:true}).click();
    await expect(page.locator('#save-state')).toContainText('Approved exact revision');
    const savedHead=(await head(page)).revision;
    await page.getByRole('button',{name:'Inspect approved export contract',exact:true}).click();
    await expect(page.locator('#contract-preview')).not.toBeEmpty();
    const exported=join(work,'desktop-export.zip');await queue(application,'save',[exported]);
    await application.evaluate(({Menu})=>{const menu=Menu.getApplicationMenu().items.find(item=>item.label.includes('File'));const command=menu.submenu.items.find(item=>item.label.startsWith('Export exact revision'));command.click()});
    await expect.poll(()=>existsSync(exported)).toBe(true);expect(readFileSync(exported).subarray(0,2).toString()).toBe('PK');
    const exportedFolder=join(work,'exported-package'),exportedStore=join(work,'reimported-authority');
    execFileSync('python',['-c','import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',exported,exportedFolder],{windowsHide:true});
    execFileSync(binary,['import','--store',exportedStore,'--package',exportedFolder,'--project','reimport-preview'],{windowsHide:true});
    const exportedView=JSON.parse(execFileSync(binary,['view','--store',exportedStore,'--project','reimport-preview'],{encoding:'utf8',windowsHide:true}));
    expect(exportedView.documents[0].tokens.find(token=>token.id==='w2')).toMatchObject({original:'walked',corrected:'strolled'});
    expect(readFileSync(join(exportedFolder,'Other/preserved.bin'))).toEqual(readFileSync(join(source,'Other/preserved.bin')));
    expect(readFileSync(join(source,'xmlfiles/interview.xml'),'utf8')).toBe(sourceXML);

    await page.locator('[data-token="w2"]').click();await page.getByRole('button',{name:'Token',exact:true}).click();
    await page.getByLabel('Human-corrected reading').fill('memory-only-form');
    const [interruptedBackend]=await sidecars(application);expect(interruptedBackend).toBeGreaterThan(0);process.kill(interruptedBackend);
    await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
    await expect(page.getByLabel('Human-corrected reading')).toHaveValue('memory-only-form');
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();
    await expect.poll(async()=>(await state(page)).status).toBe('ready');
    await expect(page.getByLabel('Human-corrected reading')).toHaveValue('memory-only-form');
    expect((await head(page)).revision).toEqual(savedHead);
    await page.locator('.desktop-project-switcher summary').click();
    await queue(application,'open',[secondStore]);await queue(application,'message',[0]);
    await page.evaluate(()=>window.workbenchDesktop.chooseOpen());
    await expect.poll(async()=>application.evaluate(()=>globalThis.__desktopQA.calls.filter(call=>call.kind==='message').length)).toBeGreaterThan(0);
    expect((await state(page)).project.id).toBe(originalId);
    await expect(page.getByLabel('Human-corrected reading')).toHaveValue('memory-only-form');
    const count=await application.evaluate(()=>globalThis.__desktopQA.calls.filter(call=>call.kind==='message').length);
    await queue(application,'message',[0]);await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
    await expect.poll(async()=>application.evaluate(()=>globalThis.__desktopQA.calls.filter(call=>call.kind==='message').length)).toBeGreaterThan(count);
    await expect(page.getByLabel('Human-corrected reading')).toHaveValue('memory-only-form');
    await page.getByRole('button',{name:'Undo unsaved edits',exact:true}).click();
    await queue(application,'open',[secondStore]);await page.locator('#desktop-open').click();
    await expect.poll(async()=>(await state(page)).project.project).toBe('second-preview');await ready(page);
    await expect(page.locator('#project-title')).toHaveText('second-preview');
    await page.locator('.desktop-project-switcher summary').click();
    await page.locator(`[data-desktop-project="${originalId}"]`).click();
    await expect.poll(async()=>(await state(page)).project.id).toBe(originalId);await ready(page);
    await expect(page.locator('[data-token="w2"] .reading-text')).toHaveText('strolled');
    expect((await head(page)).revision).toEqual(savedHead);
    const registry=JSON.parse(readFileSync(join(profile,'desktop-projects.json'),'utf8'));
    const authority=registry.recent.find(entry=>entry.id===originalId).store;
    await page.locator('.desktop-project-switcher summary').click();await queue(application,'open',[authority]);
    // Reopening the same authority leaves the DOM ready throughout native CLI
    // inspection. Await the IPC response before testing normal shutdown.
    await page.evaluate(()=>window.workbenchDesktop.chooseOpen());await ready(page);
    expect((await head(page)).revision.id).toBe(2);
    expect((await state(page)).recent.filter(entry=>entry.id===originalId)).toHaveLength(1);
    const backup=join(work,'verified-desktop-backup');await queue(application,'save',[backup]);
    expect(await page.evaluate(()=>window.workbenchDesktop.backup())).toMatchObject({cancelled:false});
    const backupCheck=JSON.parse(execFileSync(binary,['check','--store',backup],{encoding:'utf8',windowsHide:true}));
    expect(backupCheck.status).toBe('verified');
    const backupView=JSON.parse(execFileSync(binary,['view','--store',backup,'--project',originalState.project.project],{encoding:'utf8',windowsHide:true}));
    expect(backupView.revision).toEqual(savedHead);
    expect(errors).toEqual([]);
    const pids=await sidecars(application);expect(pids).toHaveLength(1);await quit(application,pids);application=null;
    ({application,page}=await launch(profile));await ready(page);expect((await head(page)).revision.id).toBe(2);
    expect((await state(page)).project.id).toBe(originalId);
    await expect(page.locator('[data-token="w2"] .reading-text')).toHaveText('strolled');
    const evidenceRecord={platform:process.platform,app_version:await application.evaluate(({app})=>app.getVersion()),origin:page.url(),import_source_unchanged:true,correction_revision:2,reviewed_contract:true,native_menu_export:exported,complete_export_reimport:true,opaque_bytes_preserved:true,repeated_open:true,dirty_open_cancel:true,dirty_close_cancel:true,backend_interruption_preserves_form:true,verified_native_backup:backup,backup_exact_head:true,relaunch_exact_head:true,sidecar_shutdown:true,renderer_preferences:preferences,page_errors:errors};
    writeFileSync(join(evidence,'workflow-evidence.json'),JSON.stringify(evidenceRecord,null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('stable desktop origin recovers backward Unicode draft and identical response-loss command after relaunch',async()=>{
  const work=workspace('recovery'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  execFileSync(binary,['import','--store',store,'--package',source,'--project','recovery-preview'],{windowsHide:true});
  let application,page;const origins=[];
  try{
    ({application,page}=await launch(profile,store,'recovery-preview'));await ready(page);origins.push(page.url());
    const before=await head(page);await draft(page,'étendu','w41',true);
    const [unsaved]=await records(page);expect(unsaved.backward).toBe(true);expect(unsaved.command).toBeNull();
    await queue(application,'message',[1]);await quit(application,await sidecars(application));application=null;
    ({application,page}=await launch(profile,store,'recovery-preview'));await ready(page);origins.push(page.url());
    await expect(page.getByRole('button',{name:'Recover correction',exact:true})).toBeVisible();
    expect((await head(page)).revision).toEqual(before.revision);expect((await records(page))[0]).toEqual(unsaved);
    await page.getByRole('button',{name:'Recover correction',exact:true}).click();
    await expect(page.getByLabel('Proposed correction')).toHaveValue('étendu');
    await page.locator('#undo-draft').click();await expect.poll(()=>records(page)).toEqual([]);
    await draft(page,'wandered');
    await page.evaluate(()=>{const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const command=new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/command';const response=await original(input,init);if(command&&response.ok){window.__lostCommand=init.body;throw new TypeError('Synthetic committed response loss')}return response}});
    await page.locator('#accept-draft').click();await expect(page.locator('#save-state')).toContainText('Save outcome unknown');
    const [pending]=await records(page),body=await page.evaluate(()=>window.__lostCommand);
    expect(pending.command).toEqual(JSON.parse(body));expect((await head(page)).revision.id).toBe(before.revision.id+1);
    await interrupt(application,await sidecars(application));application=null;
    ({application,page}=await launch(profile,store,'recovery-preview'));await ready(page);origins.push(page.url());
    writeFileSync(join(evidence,'response-loss-relaunch-diagnostic.json'),JSON.stringify({before:pending,after:await records(page),head:(await head(page)).revision,body:await page.locator('.local-draft-recovery').textContent()},null,2));
    await expect(page.getByRole('button',{name:'Resolve original save',exact:true})).toBeVisible();
    expect((await records(page))[0].command).toEqual(pending.command);
    await page.evaluate(()=>{const original=window.fetch.bind(window);window.__retries=[];window.fetch=async(input,init)=>{if(new URL(typeof input==='string'?input:input.url,location.href).pathname==='/api/command')window.__retries.push(init.body);return original(input,init)}});
    await page.getByRole('button',{name:'Resolve original save',exact:true}).click();
    await expect(page.locator('#message')).toContainText('Original correction confirmed');
    expect(await page.evaluate(()=>window.__retries)).toEqual([body]);
    expect((await head(page)).revision.id).toBe(before.revision.id+1);await expect.poll(()=>records(page)).toEqual([]);
    expect(new Set(origins)).toEqual(new Set(['workbench://app/']));
    writeFileSync(join(evidence,'recovery-evidence.json'),JSON.stringify({platform:process.platform,origins,backward_unicode_recovery:true,authority:pending.authority,command_id:pending.command.command_id,identical_request_retry:true,no_duplicate_revision:true,interrupted_parent_cleanup:true,final_revision:(await head(page)).revision.id},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('real Electron custom audio keeps playback through pane drag and handles missing media',async()=>{
  const work=workspace('audio'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  execFileSync(binary,['import','--store',store,'--package',source,'--project','audio-preview'],{windowsHide:true});
  let application,page;
  try{
    ({application,page}=await launch(profile,store,'audio-preview'));await ready(page);
    const audio=page.locator('#audio');
    const diagnostic=await page.evaluate(async()=>{const a=document.querySelector('#audio');const response=await fetch(a.getAttribute('src'),{headers:{Range:'bytes=0-255'}});return {src:a.getAttribute('src'),currentSrc:a.currentSrc,readyState:a.readyState,networkState:a.networkState,error:a.error&&{code:a.error.code,message:a.error.message},duration:Number.isFinite(a.duration)?a.duration:null,range:{status:response.status,headers:Object.fromEntries(response.headers),bytes:(await response.arrayBuffer()).byteLength}}});
    writeFileSync(join(evidence,'audio-diagnostic.json'),JSON.stringify(diagnostic,null,2));
    await expect(page.locator('#audio-play')).toBeEnabled();
    expect(await audio.evaluate(a=>({paused:a.paused,controls:a.controls}))).toEqual({paused:true,controls:false});
    await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeGreaterThan(.1);
    const src=await audio.getAttribute('src');await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');
    expect(await audio.getAttribute('src')).toBe(src);expect(await audio.evaluate(a=>a.paused)).toBe(false);
    await page.getByRole('button',{name:'Pause recording',exact:true}).click();
    await page.screenshot({path:join(evidence,'electron-recording-expanded-1440x1000.png')});
    await page.getByRole('slider',{name:'Seek recording on waveform',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
    await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeCloseTo(1,1);
    const waveform=await page.locator('#recording-waveform').boundingBox();
    await page.mouse.move(waveform.x+waveform.width*.2,waveform.y+waveform.height/2);await page.mouse.down();
    await page.mouse.move(waveform.x+waveform.width*.55,waveform.y+waveform.height/2);await page.mouse.up();
    await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeCloseTo(4.4,1);
    await page.getByRole('button',{name:'Mute recording',exact:true}).click();await expect(page.getByRole('button',{name:'Unmute recording',exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'Speed',exact:true}).selectOption('1.5');expect(await audio.evaluate(a=>a.playbackRate)).toBe(1.5);
    await page.locator('#timeline-resizer').focus();await page.keyboard.press('Home');
    for(const width of [1440,1100]){
      await application.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,760),width);
      for(const selector of ['#audio-play','#audio-seek','#audio-mute','#audio-volume','#audio-speed'])expect(await page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),p=element.closest('#recording-pane').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom}),selector).toBe(true);
    }
    await page.locator('[data-document="xmlfiles/notes.xml"]').click();await expect(page.locator('#audio-availability')).toBeVisible();
    expect(await audio.getAttribute('src')).toBeNull();expect(await audio.evaluate(a=>a.paused)).toBe(true);
    await page.locator('[data-document="xmlfiles/interview.xml"]').click();await expect(page.locator('#audio-play')).toBeEnabled();
    await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');
    expect(await page.locator('#recording-waveform').evaluate(element=>{const r=element.getBoundingClientRect(),p=element.closest('#recording-pane').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom}), 'Expanded waveform fits compact recording pane').toBe(true);
    await page.screenshot({path:join(evidence,'electron-recording-compact-1100x760.png')});
    writeFileSync(join(evidence,'audio-evidence.json'),JSON.stringify({platform:process.platform,real_playback:true,resize_preserves_source:true,waveform_keyboard_seek:true,waveform_pointer_drag:true,mute_feedback:true,rate:1.5,compact_controls_fit:true,missing_media_clears_source:true},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('a cold unavailable authority can retry into its exact synthetic project',async()=>{
  const work=workspace('cold-retry'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  let application,page;
  try{
    ({application,page}=await launch(profile,store,'cold-preview'));
    await expect(page.locator('#desktop-retry')).toBeVisible();
    await page.screenshot({path:join(evidence,'electron-unavailable-authority.png')});
    execFileSync(binary,['import','--store',store,'--package',source,'--project','cold-preview'],{windowsHide:true});
    await page.locator('#desktop-retry').click();await ready(page);
    expect((await state(page)).project.project).toBe('cold-preview');expect((await head(page)).revision.id).toBe(1);
    writeFileSync(join(evidence,'cold-retry-evidence.json'),JSON.stringify({platform:process.platform,cold_error_visible:true,retry_renders_exact_project:true,revision:1},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('retrying a repaired native journal acknowledges subsequent inline drafts and cleans shutdown',async()=>{
  const work=workspace('journal-retry'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  execFileSync(binary,['import','--store',store,'--package',source,'--project','journal-retry-preview'],{windowsHide:true});
  const directory=join(profile,'drafts'),journal=join(directory,'correction-journal.json');
  mkdirSync(directory,{recursive:true});
  const malformed='{\n  synthetic retained journal bytes\n}\n';writeFileSync(journal,malformed,'utf8');
  let application,page;
  try{
    ({application,page}=await launch(profile,store,'journal-retry-preview'));
    await expect(page.getByRole('button',{name:'Retry draft recovery',exact:true})).toBeVisible();
    await expect(page.locator('#tokens')).toHaveCount(0);
    expect(readFileSync(journal,'utf8')).toBe(malformed);
    const before=(await head(page)).revision;
    await page.screenshot({path:join(evidence,'electron-journal-recovery-blocked.png')});
    // Repair only this synthetic profile's journal, simulating a successful
    // validated read on Retry. Opening the editor alone is insufficient: the
    // formerly unavailable native journal must acknowledge subsequent writes.
    writeFileSync(journal,'{}','utf8');
    await page.getByRole('button',{name:'Retry draft recovery',exact:true}).click();await ready(page);
    expect((await state(page)).project.project).toBe('journal-retry-preview');
    await draft(page,'resumed-journal');
    await expect.poll(()=>Object.values(JSON.parse(readFileSync(journal,'utf8'))).map(record=>record.replacement),{message:'Recovered native journal acknowledges the new inline correction'}).toEqual(['resumed-journal']);
    await expect(page.locator('#draft-explanation')).not.toContainText('Updating local draft');
    await expect(page.locator('#draft-explanation')).not.toContainText('unavailable');
    const canonical=JSON.parse(readFileSync(journal,'utf8')),retained=await records(page);
    expect(retained).toEqual(Object.values(canonical));expect(retained[0].command).toBeNull();
    expect((await head(page)).revision).toEqual(before);
    await queue(application,'message',[1]);await quit(application,await sidecars(application));application=null;
    expect(JSON.parse(readFileSync(journal,'utf8'))).toEqual(canonical);
    writeFileSync(join(evidence,'journal-retry-evidence.json'),JSON.stringify({platform:process.platform,barrier_visible:true,malformed_bytes_preserved:true,validated_repair_recovery:true,canonical_native_acknowledgement:true,browser_mirror_matches_native:true,unchanged_saved_revision:before.id,retained_on_normal_shutdown:true,sidecar_shutdown:true},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('pane drags use visible sizes, preserve preferred layouts and keep recording and drafts continuous',async()=>{
  const work=workspace('pane-drag'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  execFileSync(binary,['import','--store',store,'--package',source,'--project','pane-drag-preview'],{windowsHide:true});
  let application,page;const geometry=[];
  try{
    ({application,page}=await launch(profile,store,'pane-drag-preview'));await ready(page);await expect(page.locator('#audio-play')).toBeEnabled();
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await settleLayout(page);
    geometry.push({stage:'native default',...await paneGeometry(application,page)});
    await captureNative(application,join(evidence,'electron-panes-native-default.png'));
    const before=(await head(page)).revision;await draft(page,'pane-draft');
    await page.evaluate(()=>{window.__paneAudio=document.querySelector('#audio');window.__paneAudio.loop=true});await page.locator('#audio-play').click();
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,760));await settleLayout(page);
    const compact=await paneGeometry(application,page);geometry.push({stage:'before compact drag',...compact});
    await dragSplitter(page,'#timeline-resizer',0,-24);
    const dragged=await paneGeometry(application,page);geometry.push({stage:'after compact drag',...dragged});
    nearPixels(dragged.recording.height,compact.recording.height+24);nearPixels(dragged.recordingControl.value,dragged.recording.height);
    await captureNative(application,join(evidence,'electron-panes-compact-drag.png'));
    await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setZoomFactor(1.25);window.setSize(1000,700)});await settleLayout(page);
    await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');await settleLayout(page);
    const zoomed=await paneGeometry(application,page);geometry.push({stage:'minimum native window at 125 percent',...zoomed});
    expect(zoomed.transcript.height,'240px reading reservation allows subpixel rounding').toBeGreaterThanOrEqual(239.5);expect(zoomed.transcript.clientHeight).toBeGreaterThanOrEqual(240);expect(zoomed.transcript.width).toBeGreaterThanOrEqual(300);
    nearPixels(zoomed.recordingControl.value,zoomed.recording.height);expect(zoomed.recording.height).toBeLessThanOrEqual(zoomed.recordingControl.max+1);
    for(const [selector,side,dx] of [['#navigation-resizer','navigation',-12],['#properties-resizer','properties',12]]){
      const start=(await paneGeometry(application,page))[side].width;await dragSplitter(page,selector,dx,0);
      nearPixels((await paneGeometry(application,page))[side].width,start-12);
    }
    await captureNative(application,join(evidence,'electron-panes-minimum-zoom125.png'));
    await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setZoomFactor(1);window.setSize(1440,1000)});await settleLayout(page);
    for(const selector of ['#navigation-resizer','#properties-resizer']){await page.locator(selector).focus();await page.keyboard.press('End')}
    await settleLayout(page);const preferred=await paneGeometry(application,page);geometry.push({stage:'preferred wide layout',...preferred});
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,760));await settleLayout(page);
    const fitted=await paneGeometry(application,page);geometry.push({stage:'fitted narrow layout',...fitted});expect(fitted.transcript.width).toBeGreaterThanOrEqual(300);
    expect(fitted.preferred.navigation).toBe(preferred.preferred.navigation);expect(fitted.preferred.properties).toBe(preferred.preferred.properties);
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await settleLayout(page);
    for(const side of ['navigation','properties'])nearPixels((await paneGeometry(application,page))[side].width,preferred[side].width);
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,760));await settleLayout(page);
    const narrowStart=await paneGeometry(application,page);await dragSplitter(page,'#navigation-resizer',-50,0);
    const narrowDrag=await paneGeometry(application,page);nearPixels(narrowDrag.navigation.width,narrowStart.navigation.width-50);
    await page.locator('#navigation-resizer').focus();await page.keyboard.press('ArrowLeft');await settleLayout(page);
    const narrowKey=await paneGeometry(application,page);nearPixels(narrowKey.navigation.width,narrowDrag.navigation.width-12);
    expect(narrowKey.preferred.properties).toBe(preferred.preferred.properties);
    geometry.push({stage:'settled narrow pointer and keyboard resize',...narrowKey});
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await settleLayout(page);
    for(const selector of ['#navigation-resizer','#properties-resizer']){await page.locator(selector).focus();await page.keyboard.press('End')}
    await settleLayout(page);
    for(const [button,side] of [['#toggle-navigation','navigation'],['#toggle-properties','properties']]){
      await page.locator(button).click();await page.locator(button).click();await settleLayout(page);nearPixels((await paneGeometry(application,page))[side].width,preferred[side].width);
    }
    for(const [selector,side,target,direction] of [['#navigation-resizer','navigation',184,1],['#properties-resizer','properties',320,-1]]){
      const current=(await paneGeometry(application,page))[side].width;await dragSplitter(page,selector,(target-current)*direction,0);nearPixels((await paneGeometry(application,page))[side].width,target);
    }
    for(const [button,side,target] of [['#toggle-navigation','navigation',184],['#toggle-properties','properties',320]]){
      await page.locator(button).click();await page.locator(button).click();await settleLayout(page);nearPixels((await paneGeometry(application,page))[side].width,target);
    }
    for(const selector of ['#navigation-resizer','#properties-resizer']){await page.locator(selector).focus();await page.keyboard.press('End')}
    await settleLayout(page);
    const current=(await paneGeometry(application,page)).recording.height;await dragSplitter(page,'#timeline-resizer',0,current-310);
    nearPixels((await paneGeometry(application,page)).recording.height,310);
    await page.locator('#timeline-toggle').click();await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','minimal');
    for(let i=0;i<2&&await page.locator('#recording-pane').getAttribute('data-detail')!=='expanded';i++)await page.locator('#timeline-toggle').click();
    await settleLayout(page);nearPixels((await paneGeometry(application,page)).recording.height,310);
    expect(await page.evaluate(()=>window.__paneAudio===document.querySelector('#audio')&&!window.__paneAudio.paused)).toBe(true);
    await expect(page.getByLabel('Proposed correction')).toHaveValue('pane-draft');expect((await head(page)).revision).toEqual(before);
    const retained=await records(page);expect(Object.values(JSON.parse(readFileSync(join(profile,'drafts/correction-journal.json'),'utf8')))).toEqual(retained);
    geometry.push({stage:'restored custom recording and preferred sides',...await paneGeometry(application,page)});
    await queue(application,'message',[1]);await quit(application,await sidecars(application));application=null;
    ({application,page}=await launch(profile,store,'pane-drag-preview'));await ready(page);await settleLayout(page);
    for(const side of ['navigation','properties'])nearPixels((await paneGeometry(application,page))[side].width,preferred[side].width);
    await expect(page.getByRole('button',{name:'Recover correction',exact:true})).toBeVisible();expect(await records(page)).toEqual(retained);
    await queue(application,'message',[1]);await quit(application,await sidecars(application));application=null;
    writeFileSync(join(evidence,'pane-drag-evidence.json'),JSON.stringify({platform:process.platform,visible_origin_drag:true,zoom125_native_minimum:true,preferred_resize_and_collapse_restore:true,custom_recording_height_restore:310,audio_and_draft_continuity:true,persistence_and_shutdown:true,geometry},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});

test('scrolled panes keep splitters reachable and interrupted drags restore their saved sizes',async()=>{
  const work=workspace('pane-scroll'),source=createPackage(join(work,'source-package')),store=join(work,'authority'),profile=join(work,'desktop-profile');
  const original=readFileSync(join(source,'xmlfiles/interview.xml'),'utf8');
  for(let i=1;i<=28;i++)writeFileSync(join(source,`xmlfiles/zz-appendix-${String(i).padStart(2,'0')}.xml`),original.replace(/<title>.*?<\/title>/,`<title>Synthetic appendix ${i}</title>`));
  execFileSync(binary,['import','--store',store,'--package',source,'--project','pane-scroll-preview'],{windowsHide:true});
  let application,page;
  try{
    ({application,page}=await launch(profile,store,'pane-scroll-preview'));await ready(page);
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await settleLayout(page);
    await page.locator('[data-token="w2"]').click();await page.keyboard.press('Escape');await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');
    await page.evaluate(()=>{for(const selector of ['.documents','.inspector']){const pane=document.querySelector(selector);pane.scrollTop=pane.scrollHeight}});await settleLayout(page);
    for(const [selector,side,dx] of [['#navigation-resizer','navigation',-16],['#properties-resizer','properties',16]]){
      const hit=await page.evaluate(selector=>{const handle=document.querySelector(selector),r=handle.getBoundingClientRect(),workspace=document.querySelector('.workspace').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,workspace.y+workspace.height/2)?.closest(selector)?.id},selector);
      expect(hit,`${selector} is reachable halfway down its scrolled pane`).toBe(selector.slice(1));
      const start=(await paneGeometry(application,page))[side].width;await dragSplitter(page,selector,dx,0);nearPixels((await paneGeometry(application,page))[side].width,start-16);
    }
    for(const [pane,rail] of [['.documents','#navigation-resizer'],['.transcript','#properties-resizer']]){
      const hit=await page.evaluate(({pane,rail})=>{const element=document.querySelector(pane),r=element.getBoundingClientRect(),target=document.elementFromPoint(r.right-3,r.y+r.height/2);return {pane:!!target?.closest(pane),rail:!!target?.closest(rail)}},{pane,rail});
      expect(hit,`${pane} scrollbar edge is available independently of its splitter`).toEqual({pane:true,rail:false});
    }
    const navigationScroll=await page.locator('.documents').evaluate(element=>element.scrollTop),navigationBox=await page.locator('.documents').boundingBox();
    await page.mouse.move(navigationBox.x+navigationBox.width/2,navigationBox.y+navigationBox.height/2);await page.mouse.wheel(0,-96);
    await expect.poll(()=>page.locator('.documents').evaluate(element=>element.scrollTop)).toBeLessThan(navigationScroll);
    const readingScroll=await page.locator('.transcript').evaluate(element=>element.scrollTop),readingBox=await page.locator('.transcript').boundingBox();
    await page.mouse.move(readingBox.x+readingBox.width/2,readingBox.y+readingBox.height/2);await page.mouse.wheel(0,96);
    await expect.poll(()=>page.locator('.transcript').evaluate(element=>element.scrollTop)).toBeGreaterThan(readingScroll);
    await captureNative(application,join(evidence,'electron-panes-scrolled-light.png'));await page.locator('#toggle-theme').click();
    await page.locator('[data-tab="search"]').click();const textarea=page.getByLabel('Exact token sequence',{exact:true});
    await textarea.fill(Array(8).fill('walked').join('\n'));
    const outerScroll=await textarea.evaluate(element=>{element.scrollTop=0;return element.closest('.inspector').scrollTop});
    const textareaBox=await textarea.boundingBox();await page.mouse.move(textareaBox.x+textareaBox.width/2,textareaBox.y+textareaBox.height/2);await page.mouse.wheel(0,30);
    await expect.poll(()=>textarea.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
    nearPixels(await page.locator('.inspector').evaluate(element=>element.scrollTop),outerScroll);
    await captureNative(application,join(evidence,'electron-panes-scrolled-dark.png'));
    for(const interruption of ['lost capture','pointer cancel']){
      const originalGeometry=await paneGeometry(application,page),r=await page.locator('#navigation-resizer').boundingBox();
      await page.evaluate(()=>document.querySelector('#navigation-resizer').addEventListener('pointerdown',event=>{window.__panePointer=event.pointerId},{once:true}));
      await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+20,r.y+r.height/2,{steps:3});
      const pointer=await page.evaluate(()=>window.__panePointer);
      if(interruption==='lost capture')await page.evaluate(pointer=>document.querySelector('#navigation-resizer').releasePointerCapture(pointer),pointer);
      else await page.dispatchEvent('#navigation-resizer','pointercancel',{pointerId:pointer,pointerType:'mouse',isPrimary:true});
      await page.mouse.up();await settleLayout(page);await expect(page.locator('html')).not.toHaveAttribute('data-resizing','x');
      const restored=await paneGeometry(application,page);nearPixels(restored.navigation.width,originalGeometry.navigation.width);expect(restored.preferred.navigation).toBe(originalGeometry.preferred.navigation);
    }
    for(const dx of [8,-8,8]){const start=(await paneGeometry(application,page)).navigation.width;await dragSplitter(page,'#navigation-resizer',dx,0);nearPixels((await paneGeometry(application,page)).navigation.width,start+dx)}
    const final=await paneGeometry(application,page);nearPixels(Number(final.preferred.navigation),final.navigation.width);nearPixels(Number(final.preferred.properties),final.properties.width);
    await queue(application,'message',[1]);await quit(application,await sidecars(application));application=null;
    writeFileSync(join(evidence,'pane-scroll-evidence.json'),JSON.stringify({platform:process.platform,scrolled_rails_reachable:true,side_drag_tracks_pointer:true,scrollbar_edges_clear_of_rails:true,native_wheel_scroll:true,nested_textarea_scroll:true,lost_capture_rolls_back:true,pointer_cancel_rolls_back:true,repeated_quick_drag:true,preferred_matches_visible_geometry:true,shutdown_cleanup:true,geometry:final},null,2));
  }finally{if(application&&application.process().exitCode===null)await interrupt(application,await sidecars(application))}
});
