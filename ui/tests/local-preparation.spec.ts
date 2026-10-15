import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Synthetic renderer/control-plane qualification. Native preparation, source
// bytes, parsing and real import/reload are covered by the separate native suite.
const root=resolve('..'),binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
const evidence=process.env.WB_PREPARATION_EVIDENCE;
let runtime:string,service:ChildProcess|undefined,code='';
const raw='SYNTHETIC supplied transcript: their reading remains uncertain.\n';

function tone(){
  const rate=16000,count=rate*3,wav=Buffer.alloc(44+count*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)wav.writeInt16LE(Math.round(1200*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return wav;
}
test.beforeAll(async()=>{
  if(evidence)mkdirSync(evidence,{recursive:true});
  mkdirSync(resolve(root,'.private'),{recursive:true});runtime=mkdtempSync(resolve(root,'.private/browser-local-preparation-'));
  for(const folder of ['Resources','xmlfiles','Raw','Audio'])mkdirSync(resolve(runtime,'package',folder),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(runtime,'package/xmlfiles/existing.xml'),"<TEI><teiHeader><title>SYNTHETIC returning preparation project</title><media url='tone.wav'/></teiHeader><text><body><u id='u1' start='0' end='3'><tok id='w1'>Synthetic</tok> <tok id='w2' note='SYNTHETIC uncertainty remains authored evidence'>reading</tok>.</u></body></text></TEI>");
  writeFileSync(resolve(runtime,'package/Raw/supplied.txt'),raw);writeFileSync(resolve(runtime,'package/Audio/tone.wav'),tone());
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','preparation-ui']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','preparation-ui','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service!.once('exit',()=>done()))}});

async function api(page:Page,path:string){return page.evaluate(async path=>{const response=await fetch(path);if(!response.ok)throw new Error(await response.text());return response.json()},path)}
async function open(page:Page){await page.goto('/#session='+code)}
async function calls(page:Page,method:string){return page.evaluate(method=>(window as any).__preparationQA.calls.filter((call:any)=>call.method===method),method)}

function preview(format='utf8-text',duplicate=false){return {
  token:'1'.repeat(64),duplicate,key:'2'.repeat(64),
  sources:{audio:{name:'SYNTHETIC tone.wav',sha256:'a'.repeat(64),bytes:96044},transcript:{name:format==='utf8-text'?'SYNTHETIC supplied.txt':'SYNTHETIC Omnilingual.json',sha256:'b'.repeat(64),bytes:128}},
  summary:{format,segments:1,tokens:8,text:raw,timing:format==='utf8-text'?'Word timing remains unknown.':'Observed chunk 0.00–3.00 s; word timing remains unknown.',warnings:['SYNTHETIC fixture: preserve uncertainty for explicit review.']},
}}

async function mockDesktop(page:Page,ready=false){
  await page.addInitScript(({ready})=>{
    const clone=(value:any)=>JSON.parse(JSON.stringify(value));
    const project={id:'00000000-0000-4000-8000-000000000092',project:'preparation-ui',title:'SYNTHETIC existing working copy'};
    const state={status:ready?'ready':'idle',project:ready?project:null,recent:ready?[{...project,opened:1}]:[],error:null,version:'synthetic-test'};
    const qa=(window as any).__preparationQA={state,calls:[] as any[],preview:null,previewError:null,commitError:null,commitResult:{},holdPreview:false,holdCommit:false,cancelFailures:0};
    (window as any).workbenchDesktop={
      state:async()=>clone(qa.state),chooseOpen:async()=>{},importPackage:async()=>{},createDemo:async()=>{},openRecent:async()=>{},exportRevision:async()=>({cancelled:true}),backup:async()=>({cancelled:true}),retry:async()=>{},
      semanticaState:async()=>({status:'notconfigured',configured:false}),configureSemantica:async()=>({status:'notconfigured',configured:false}),runSemantica:async()=>{},exportSemantica:async()=>({cancelled:true}),revealSemantica:async()=>{},
      previewPreparation:async(payload:any)=>{qa.calls.push({method:'preview',payload:clone(payload)});if(qa.holdPreview)await new Promise<void>(resolve=>{qa.releasePreview=resolve});if(qa.previewError)throw new Error(qa.previewError);return clone(qa.preview)},
      commitPreparation:async(token:string)=>{qa.calls.push({method:'commit',token});if(qa.holdCommit)await new Promise<void>(resolve=>{qa.releaseCommit=resolve});if(qa.commitError)throw new Error(qa.commitError);return clone(qa.commitResult)},
      cancelPreparation:async(token:string)=>{qa.calls.push({method:'cancel',token});if(qa.cancelFailures>0){qa.cancelFailures--;throw new Error('SYNTHETIC preview cleanup failed; retry Cancel.')}},
      reportDraft:()=>{},reportAppearance:()=>{},readDraftJournal:async()=>localStorage.getItem('synthetic-preparation-native-journal'),persistDraftJournal:async(raw:string)=>{localStorage.setItem('synthetic-preparation-native-journal',raw)},
      onState:(listener:any)=>{qa.emitState=listener;return()=>{}},onMenu:(listener:any)=>{qa.menu=listener;return()=>{}},
    };
  },{ready});
}
async function setPreview(page:Page,value:ReturnType<typeof preview>|null){await page.evaluate(value=>{(window as any).__preparationQA.preview=value},value)}
async function dialog(page:Page){
  const trigger=page.locator('#desktop-prepare');
  if(!await trigger.isVisible())await page.locator('.desktop-project-switcher > details > summary').click();
  await trigger.click();await expect(page.getByRole('dialog',{name:'Recording + transcript',exact:true})).toBeVisible();
}

test('browser workbench never offers native file preparation or changes existing evidence',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page);await expect(page.locator('[data-token="w1"]')).toBeVisible();const before=await api(page,'/api/view');
  await expect(page.locator('#desktop-prepare')).toHaveCount(0);await expect(page.locator('#preparation-dialog')).toHaveCount(0);expect((await api(page,'/api/view')).revision).toEqual(before.revision);expect(before.approved).toBe(false);expect(errors).toEqual([]);
});

test('native dialog previews literal local evidence and commits only its opaque token after explicit confirmation',async({page})=>{
  await mockDesktop(page);await open(page);const errors:string[]=[],external:string[]=[],writes:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:18912/'))external.push(request.url());if(request.method()==='POST'&&/\/api\/(command|review)$/.test(new URL(request.url()).pathname))writes.push(request.url())});
  const literal='\nSYNTHETIC\t<tok id="literal">their & uncertain reading</tok>\r\n  <img src=x onerror="window.__preparationExecuted=true"><script>window.__preparationExecuted=true</script>\r\nSYNTHETIC uncertainty stays explicit.\t';const data=preview();data.summary.text=literal;await setPreview(page,data);
  const trigger=page.locator('#desktop-prepare');await trigger.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Recording + transcript',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'Transcript format',exact:true})).toBeFocused();await expect(page.locator('#preparation-confirm')).toBeDisabled();
  await page.getByLabel('Project title',{exact:false}).fill('SYNTHETIC listening project');await page.getByRole('button',{name:'Choose recording and transcript',exact:true}).click();await expect(page.locator('#preparation-preview')).toBeVisible();expect(await page.getByLabel('Transcript excerpt',{exact:true}).textContent()).toBe(literal);await expect(page.locator('#preparation-preview')).toContainText('SYNTHETIC tone.wav');await expect(page.locator('#preparation-preview')).toContainText('SYNTHETIC supplied.txt');await expect(page.locator('#preparation-preview')).toContainText('8 tokens');await expect(page.locator('#preparation-preview')).toContainText(/word timing remains unknown/i);await expect(page.locator('#preparation-preview')).toContainText(/explicitly review/i);
  await expect(page.locator('#preparation-preview img,#preparation-preview script')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__preparationExecuted)).toBeUndefined();expect(await calls(page,'commit')).toEqual([]);expect(await calls(page,'preview')).toEqual([{method:'preview',payload:{format:'utf8-text',title:'SYNTHETIC listening project'}}]);
  await page.locator('#preparation-confirm').focus();await page.keyboard.press('Enter');await expect(page.locator('#preparation-dialog')).toHaveCount(0);expect(await calls(page,'commit')).toEqual([{method:'commit',token:data.token}]);expect(await calls(page,'cancel')).toEqual([]);expect(writes).toEqual([]);expect(external).toEqual([]);expect(errors).toEqual([]);expect(readFileSync(resolve(runtime,'package/Raw/supplied.txt'),'utf8')).toBe(raw);
});

test('cancelled selection and parse errors remain retryable and changed settings invalidate the old preview',async({page})=>{
  await mockDesktop(page);await open(page);await dialog(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-status')).toContainText(/file selection cancelled/i);await expect(page.locator('#preparation-preview')).toBeHidden();await expect(page.locator('#preparation-confirm')).toBeDisabled();expect(await calls(page,'commit')).toEqual([]);
  const error='SYNTHETIC unsupported JSON schema: choose supported Omnilingual output. <img src=x onerror="window.__preparationExecuted=true">';await page.evaluate(error=>{(window as any).__preparationQA.previewError=error},error);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-status')).toHaveAttribute('role','alert');await expect(page.locator('#preparation-status')).toContainText(error);await expect(page.locator('#preparation-status img')).toHaveCount(0);await expect(page.locator('#preparation-choose')).toBeEnabled();await expect(page.locator('#preparation-confirm')).toBeDisabled();
  await page.evaluate(()=>{(window as any).__preparationQA.previewError=null});await setPreview(page,preview());await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-confirm')).toBeEnabled();await page.locator('#preparation-title').fill('SYNTHETIC renamed project');await expect(page.locator('#preparation-preview')).toBeHidden();await expect(page.locator('#preparation-confirm')).toBeDisabled();expect(await calls(page,'cancel')).toEqual([{method:'cancel',token:'1'.repeat(64)}]);
  await page.locator('#preparation-format').selectOption('omnilingual-json');await expect(page.locator('#preparation-format-help')).toContainText(/chunk bounds.*do not align words/i);const json=preview('omnilingual-json');json.token='3'.repeat(64);await setPreview(page,json);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-preview')).toContainText(/Observed chunk 0.00–3.00 s/);await expect(page.locator('#preparation-preview')).toContainText(/word timing remains unknown/i);expect((await calls(page,'preview')).at(-1)).toEqual({method:'preview',payload:{format:'omnilingual-json',title:'SYNTHETIC renamed project'}});
  await page.locator('#preparation-format').selectOption('utf8-text');await expect(page.locator('#preparation-preview')).toBeHidden();await expect(page.locator('#preparation-confirm')).toBeDisabled();expect((await calls(page,'cancel')).at(-1)).toEqual({method:'cancel',token:json.token});await page.locator('#preparation-cancel').click();await expect(page.locator('#preparation-dialog')).toHaveCount(0);await expect(page.locator('#desktop-prepare')).toBeFocused();expect(await calls(page,'commit')).toEqual([]);
});

test('held native preview and commit prevent duplicate dispatch and preserve the retryable preview after failure',async({page})=>{
  await mockDesktop(page);await open(page);await setPreview(page,preview());await dialog(page);await page.evaluate(()=>{(window as any).__preparationQA.holdPreview=true});await page.locator('#preparation-choose').click();await expect.poll(async()=>(await calls(page,'preview')).length).toBe(1);await expect(page.locator('#preparation-dialog')).toHaveAttribute('aria-busy','true');
  for(const id of ['choose','format','title','cancel','confirm'])await expect(page.locator('#preparation-'+id)).toBeDisabled();await page.locator('#preparation-choose').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.keyboard.press('Escape');await expect(page.locator('#preparation-dialog')).toBeVisible();expect((await calls(page,'preview')).length).toBe(1);expect(await calls(page,'cancel')).toEqual([]);
  await page.evaluate(()=>(window as any).__preparationQA.releasePreview());await expect(page.locator('#preparation-confirm')).toBeEnabled();await page.evaluate(()=>{(window as any).__preparationQA.holdCommit=true;(window as any).__preparationQA.commitError='SYNTHETIC source bytes changed. Choose files again or retry the preserved preview.'});await page.locator('#preparation-confirm').click();await expect.poll(async()=>(await calls(page,'commit')).length).toBe(1);await expect(page.locator('#preparation-dialog')).toHaveAttribute('aria-busy','true');await expect(page.locator('#preparation-cancel')).toBeDisabled();await page.locator('#preparation-confirm').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.keyboard.press('Escape');await expect(page.locator('#preparation-dialog')).toBeVisible();expect((await calls(page,'commit')).length).toBe(1);
  await page.evaluate(()=>(window as any).__preparationQA.releaseCommit());await expect(page.locator('#preparation-status')).toHaveAttribute('role','alert');await expect(page.locator('#preparation-status')).toContainText(/SYNTHETIC source bytes changed/i);await expect(page.locator('#preparation-preview')).toBeVisible();await expect(page.locator('#preparation-confirm')).toBeEnabled();
  await page.evaluate(()=>{const qa=(window as any).__preparationQA;qa.holdCommit=false;qa.commitError=null;qa.commitResult={cancelled:true}});await page.locator('#preparation-confirm').click();await expect(page.locator('#preparation-status')).toContainText(/import was not started/i);await expect(page.locator('#preparation-preview')).toBeVisible();await expect(page.locator('#preparation-confirm')).toBeEnabled();
  await page.evaluate(()=>{(window as any).__preparationQA.commitResult={}});await page.locator('#preparation-confirm').click();await expect(page.locator('#preparation-dialog')).toHaveCount(0);expect(await calls(page,'commit')).toEqual(Array.from({length:3},()=>({method:'commit',token:'1'.repeat(64)})));
});

test('cleanup failure after changed settings keeps confirmation disabled and Cancel retries the original token',async({page})=>{
  await mockDesktop(page);await open(page);const data=preview();await setPreview(page,data);await dialog(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-confirm')).toBeEnabled();await page.evaluate(()=>{(window as any).__preparationQA.cancelFailures=1});
  await page.locator('#preparation-title').fill('SYNTHETIC changed title invalidates this preview');await expect(page.locator('#preparation-status')).toHaveAttribute('role','alert');await expect(page.locator('#preparation-status')).toContainText('SYNTHETIC preview cleanup failed; retry Cancel.');await expect(page.locator('#preparation-dialog')).toBeVisible();await expect(page.locator('#preparation-dialog')).toHaveAttribute('aria-busy','false');await expect(page.locator('#preparation-confirm')).toBeDisabled();await expect(page.locator('#preparation-cancel')).toBeEnabled();
  await page.locator('#preparation-confirm').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(await calls(page,'commit')).toEqual([]);expect(await calls(page,'cancel')).toEqual([{method:'cancel',token:data.token}]);
  await page.locator('#preparation-cancel').click();await expect(page.locator('#preparation-dialog')).toHaveCount(0);await expect(page.locator('#desktop-prepare')).toBeFocused();expect(await calls(page,'cancel')).toEqual([{method:'cancel',token:data.token},{method:'cancel',token:data.token}]);expect(await calls(page,'commit')).toEqual([]);
});

test('preparing then cancelling from a returning project preserves unsaved correction, selection and recording position',async({page})=>{
  await mockDesktop(page,true);await open(page);await expect(page.locator('[data-token="w1"]')).toBeVisible();const before=await api(page,'/api/view');await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC retained draft');await page.getByLabel('Reviewer note',{exact:true}).fill('SYNTHETIC uncertainty requires another listening pass');await expect(page.locator('#audio-play')).toBeEnabled();await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>{audio.currentTime=1.25});
  await setPreview(page,preview());await dialog(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-preview')).toBeVisible();await page.evaluate(()=>(window as any).__preparationQA.menu('history'));await expect(page.locator('#token-form')).toHaveCount(1);await page.locator('#preparation-title').focus();await page.keyboard.press('F3');await page.keyboard.press('Escape');await expect(page.locator('#preparation-dialog')).toHaveCount(0);
  await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('SYNTHETIC retained draft');await expect(page.getByLabel('Reviewer note',{exact:true})).toHaveValue('SYNTHETIC uncertainty requires another listening pass');await expect(page.getByRole('heading',{name:'Token w2',exact:true})).toBeVisible();await expect(page.locator('#save-state')).toContainText(/Unsaved/);expect(await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeCloseTo(1.25,1);
  expect((await api(page,'/api/view')).revision).toEqual(before.revision);expect((await api(page,`/api/reviews?revision=${before.revision.id}`)).reviews).toEqual([]);expect(await calls(page,'commit')).toEqual([]);expect(await calls(page,'cancel')).toEqual([{method:'cancel',token:'1'.repeat(64)}]);
});

test('duplicate preparation offers the existing copy and preserves its exact saved correction and explicit review',async({page})=>{
  await mockDesktop(page,true);await open(page);await expect(page.locator('[data-token="w1"]')).toBeVisible();await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC saved correction');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R2');await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByRole('combobox',{name:'Decision',exact:true}).selectOption('approved');await page.getByLabel('Review rationale',{exact:true}).fill('SYNTHETIC deliberate approval with uncertainty retained');await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#review-current-status')).toContainText(/Approved/);
  const before=await api(page,'/api/view'),reviews=await api(page,`/api/reviews?revision=${before.revision.id}`);await setPreview(page,preview('utf8-text',true));await dialog(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-preview')).toContainText(/existing working copy found/i);await expect(page.locator('#preparation-preview')).toContainText(/preserves every correction and review/i);await expect(page.locator('#preparation-confirm')).toHaveText('Open existing copy');await page.locator('#preparation-confirm').click();await expect(page.locator('#preparation-dialog')).toHaveCount(0);
  expect((await api(page,'/api/view')).revision).toEqual(before.revision);expect((await api(page,'/api/view')).approved).toBe(true);expect(await api(page,`/api/reviews?revision=${before.revision.id}`)).toEqual(reviews);expect((await api(page,'/api/view')).documents[0].tokens.find((token:any)=>token.id==='w2').corrected).toBe('SYNTHETIC saved correction');expect(await calls(page,'commit')).toEqual([{method:'commit',token:'1'.repeat(64)}]);
});

test('preparation controls remain reachable with long synthetic evidence at compact widths and both appearances',async({page})=>{
  await mockDesktop(page);await open(page);const data=preview();data.sources.transcript.name='SYNTHETIC '+('long-name-'.repeat(12))+'.txt';data.summary.text='SYNTHETIC '+('their  uncertain reading '.repeat(45));await setPreview(page,data);await dialog(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-preview')).toBeVisible();
  for(const theme of ['light','dark'])for(const width of [320,390,820,1440]){
    await page.setViewportSize({width,height:800});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);await page.locator('#preparation-dialog').evaluate(element=>{element.scrollTop=0});
    const bounds=await page.locator('#preparation-dialog').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}});expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);expect(bounds.top).toBeGreaterThanOrEqual(0);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    if(evidence&&(width===390||width===1440))await page.screenshot({path:resolve(evidence,`preparation-${theme}-${width===1440?'desktop':'mobile'}-top.png`),fullPage:true});
    for(const id of ['preparation-format','preparation-title','preparation-choose','preparation-confirm','preparation-cancel']){await page.locator('#'+id).scrollIntoViewIfNeeded();await expect(page.locator('#'+id)).toBeVisible();expect(await page.locator('#'+id).evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),`${id} fits ${theme} ${width}`).toBe(true)}
    expect(await page.locator('#preparation-dialog').evaluate(element=>element.scrollWidth<=element.clientWidth),`${theme} ${width} has no dialog horizontal overflow`).toBe(true);
    if(evidence&&(width===390||width===1440))await page.screenshot({path:resolve(evidence,`preparation-${theme}-${width===1440?'desktop':'mobile'}.png`),fullPage:true});
  }
  await page.locator('#preparation-format').focus();await page.keyboard.press('Tab');await expect(page.locator('#preparation-title')).toBeFocused();await page.locator('#preparation-confirm').focus();await page.keyboard.press('Shift+Tab');await expect(page.locator('#preparation-cancel')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#preparation-dialog')).toHaveCount(0);await expect(page.locator('#desktop-prepare')).toBeFocused();
});

