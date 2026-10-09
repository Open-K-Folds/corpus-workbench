import {test,expect,_electron as electron} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPackage} from './fixtures.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const evidence=process.env.WB_EVIDENCE_DIR??resolve(root,'..','evidence','electron');
const packagedExecutable=join(root,'release','desktop','Open-K-Folds Workbench-win32-x64','Open-K-Folds Workbench.exe');
const packagedBackend=join(root,'release','desktop','Open-K-Folds Workbench-win32-x64','resources','backend','corpus-workbench.exe');
const binary=process.env.WB_DESKTOP_BACKEND??process.env.WB_BINARY??(existsSync(packagedBackend)?packagedBackend:join(root,'target','debug','corpus-workbench.exe'));
let serial=0;
function workspace(label){const directory=join(evidence,`${label}-${process.pid}-${++serial}`);mkdirSync(directory,{recursive:true});return directory}
async function launch(profile,store,project){
  const env={...process.env,WB_DESKTOP_USER_DATA:profile,WB_DESKTOP_BACKEND:binary};
  const executablePath=process.env.WB_ELECTRON_EXECUTABLE??(process.platform==='win32'&&existsSync(packagedExecutable)?packagedExecutable:undefined);
  if(executablePath&&!process.env.WB_DESKTOP_BACKEND)delete env.WB_DESKTOP_BACKEND;
  delete env.ELECTRON_RUN_AS_NODE;delete env.WB_DESKTOP_STORE;delete env.WB_DESKTOP_PROJECT;
  if(store){env.WB_DESKTOP_STORE=store;env.WB_DESKTOP_PROJECT=project}
  // Explicit executable avoids Playwright's readiness loader with newer Electron.
  const application=await electron.launch({executablePath:executablePath??join(root,'node_modules','electron','dist','electron.exe'),args:executablePath?[]:[root],cwd:root,env,timeout:30000});
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

test.beforeAll(()=>{mkdirSync(evidence,{recursive:true});if(!existsSync(binary))throw new Error('Build the Windows Rust sidecar first, or set WB_DESKTOP_BACKEND to its local executable')});

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
    expect(errors).toEqual([]);
    const pids=await sidecars(application);expect(pids).toHaveLength(1);await quit(application,pids);application=null;
    ({application,page}=await launch(profile));await ready(page);expect((await head(page)).revision.id).toBe(2);
    await expect(page.locator('[data-token="w2"] .reading-text')).toHaveText('strolled');
    const evidenceRecord={platform:process.platform,app_version:await application.evaluate(({app})=>app.getVersion()),origin:page.url(),import_source_unchanged:true,correction_revision:2,reviewed_contract:true,native_menu_export:exported,complete_export_reimport:true,opaque_bytes_preserved:true,repeated_open:true,dirty_open_cancel:true,dirty_close_cancel:true,backend_interruption_preserves_form:true,relaunch_exact_head:true,sidecar_shutdown:true,renderer_preferences:preferences,page_errors:errors};
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
