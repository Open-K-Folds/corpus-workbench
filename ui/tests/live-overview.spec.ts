import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Native evidence authority with authored practice text and generated tones only.
// Desktop bridge stubs below qualify display eligibility, never Semantica execution.
const root=resolve('..'),binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
const raw='SYNTHETIC raw wording: hello, habari? switch intact.\n';
let runtime:string,service:ChildProcess|undefined,code='';

function tone(){
  const rate=16000,count=rate*16,bytes=Buffer.alloc(44+count*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)bytes.writeInt16LE(Math.round(5000*Math.sin(2*Math.PI*(i<rate*8?440:880)*i/rate)),44+i*2);
  return bytes;
}
test.beforeEach(async()=>{
  mkdirSync(resolve(root,'.private'),{recursive:true});runtime=mkdtempSync(resolve(root,'.private/browser-live-overview-'));service=undefined;
  for(const directory of ['Resources','xmlfiles','Audio','Raw','Other'])mkdirSync(resolve(runtime,'package',directory),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(runtime,'package/xmlfiles/alpha.xml'),"<TEI><teiHeader><title>SYNTHETIC live evidence study</title><note>Authored practice text and generated tone; no recorded speech.</note><media url='tone.wav'/></teiHeader><text><body><u id='chunk' start='0' end='16'><tok id='w1' start='1' end='2'>hello,</tok> <tok id='w2'>habari?</tok> <tok id='w3'>switch intact.</tok></u></body></text></TEI>");
  writeFileSync(resolve(runtime,'package/xmlfiles/no-media.xml'),"<TEI><teiHeader><title>SYNTHETIC text without recording</title></teiHeader><text><tok id='untimed'>SYNTHETIC supplied words without timing</tok></text></TEI>");
  writeFileSync(resolve(runtime,'package/Audio/tone.wav'),tone());writeFileSync(resolve(runtime,'package/Raw/original.txt'),raw);
  for(let index=0;index<18;index++)writeFileSync(resolve(runtime,'package/Other',`evidence-${String(index).padStart(2,'0')}.txt`),`SYNTHETIC preserved artifact ${index}\n`);
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','live-overview']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','live-overview','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterEach(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service!.once('exit',()=>done()))}});

async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw new Error(await response.text());return response.json();
},{path,body})}
async function open(page:Page){await page.goto('/#session='+code);await expect(page.locator('[data-token="w1"]')).toBeVisible();await expect(page.locator('#audio-play')).toBeEnabled();await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','ready')}
async function overview(page:Page){await page.locator('#open-overview').click();const dialog=page.getByRole('dialog',{name:'Research overview',exact:true});await expect(dialog).toBeVisible();return dialog}
function observe(page:Page){
  const errors:string[]=[],writes:string[]=[],external:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/'))writes.push(request.method()+' '+new URL(request.url()).pathname);if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:18912/'))external.push(request.url())});
  return {errors,writes,external};
}
async function unchanged(page:Page,before:any,observed:ReturnType<typeof observe>){
  const after=await api(page,'/api/view');expect(after.revision).toEqual(before.revision);expect(after.approved).toBe(before.approved);expect(after.snapshot).toEqual(before.snapshot);
  expect(await api(page,'/api/generations')).toEqual([]);expect((await api(page,`/api/reviews?revision=${before.revision.id}`)).reviews).toHaveLength(before.approved?1:0);
  expect(readFileSync(resolve(runtime,'package/Raw/original.txt'),'utf8')).toBe(raw);
  expect(observed.writes).toEqual([]);expect(observed.external).toEqual([]);expect(observed.errors).toEqual([]);
}
async function evidence(page:Page,name:string){if(process.env.WB_OVERVIEW_EVIDENCE){const directory=resolve(process.env.WB_OVERVIEW_EVIDENCE);mkdirSync(directory,{recursive:true});await page.screenshot({path:resolve(directory,name+'.png')})}}
async function captureTrace(page:Page){await page.locator('#overview-traces').evaluate((canvas:HTMLCanvasElement)=>{(window as any).__overviewTrace={width:canvas.width,height:canvas.height,pixels:canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data}})}
async function traceChanged(page:Page){return page.locator('#overview-traces').evaluate((canvas:HTMLCanvasElement)=>{
  const before=(window as any).__overviewTrace,pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  // Chromium readback may differ by one level in a few rasterized channels.
  // A moving playhead produces substantial stroke changes and still fails this.
  return canvas.width!==before.width||canvas.height!==before.height||pixels.some((value,index)=>Math.abs(value-before.pixels[index])>1);
})}

test('overview reports the actual snapshot, bounded artifact identities and selection while preserving drafts',async({page})=>{
  await open(page);const before=await api(page,'/api/view'),observed=observe(page);
  await page.locator('[data-token="w2"]').click();await page.getByLabel('Reviewer note',{exact:true}).fill('SYNTHETIC retained listening note');
  const dialog=await overview(page);await expect(dialog).toHaveJSProperty('open',true);
  await expect(page.locator('#overview-basis')).toContainText(`Saved R${before.revision.id}`);await expect(page.locator('#overview-basis')).toContainText(before.revision.snapshot_hash);
  await expect(page.locator('#overview-selection-count')).toContainText(/\b1\b/);await expect(page.locator('#overview-selection-text')).toContainText('habari?');
  await expect(page.locator('#overview-selection-timing')).toContainText(/word.*(unknown|unavailable|absent)|no.*word|chunk|utterance/i);
  await expect(page.locator('#overview-review')).toContainText(/unreviewed|awaiting/i);await expect(dialog).toContainText('Desktop runtime unavailable');
  await expect(page.locator('#overview-map')).toHaveAttribute('role','img');await expect(page.locator('#overview-traces')).toBeVisible();
  await page.locator('#overview-files-summary').click();const listed=page.locator('#overview-files-list li');await expect(listed).toHaveCount(16);await expect(listed.first()).toBeVisible();
  for(const row of await listed.all()){
    const text=await row.innerText(),path=Object.keys(before.snapshot.files).find(path=>text.includes(path));expect(path,'each displayed identity names a real snapshot artifact').toBeDefined();
    expect(text).toContain(before.snapshot.files[path!].sha256.slice(0,12));
  }
  await expect(dialog).toContainText(new RegExp(`${Object.keys(before.snapshot.files).length-16}\\s+(more|omitted|additional)`,'i'));
  await page.locator('#overview-close').click();await expect(dialog).not.toBeVisible();await expect(page.locator('#open-overview')).toBeFocused();
  await expect(page.getByLabel('Reviewer note',{exact:true})).toHaveValue('SYNTHETIC retained listening note');await unchanged(page,before,observed);
});

test('overview is keyboard modal and pausing visual motion leaves real audio playback running',async({page})=>{
  await open(page);const before=await api(page,'/api/view'),observed=observe(page),dialog=await overview(page);
  await expect(dialog).toHaveAttribute('data-motion','ready');await page.locator('#overview-play').click();
  await expect(dialog).toHaveAttribute('data-motion','playing');await expect(page.locator('#overview-play')).toHaveAccessibleName('Pause recording');
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>!audio.paused&&audio.currentTime>.1)).toBe(true);
  await page.getByRole('button',{name:'Pause motion',exact:true}).click();await expect(dialog).toHaveAttribute('data-motion','paused');
  await expect(page.locator('#overview-pause')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#overview-motion-status')).toContainText('Motion paused; playback continues');
  // Allow the changed control/status label to finish its ResizeObserver paint.
  await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
  const time=await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime),frozenLabel=await page.locator('#overview-traces').getAttribute('aria-label');await captureTrace(page);
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(time+.5);expect(await traceChanged(page)).toBe(false);
  await expect(page.locator('#overview-traces')).toHaveAttribute('aria-label',frozenLabel!);expect(await dialog.evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
  // A recording-side seek (including automatic loop playback) must not move a
  // frozen trace. The overview's explicit seek control remains a user action.
  await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>{audio.currentTime=8});await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>!audio.seeking&&audio.currentTime>=8)).toBe(true);expect(await traceChanged(page)).toBe(false);
  await page.getByRole('button',{name:'Resume motion',exact:true}).click();await expect(dialog).toHaveAttribute('data-motion','playing');
  await expect.poll(()=>traceChanged(page)).toBe(true);
  await page.locator('#overview-play').click();await expect(dialog).toHaveAttribute('data-motion','ready');
  const seek=page.locator('#overview-seek');await seek.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(0);
  await page.locator('#overview-refresh').focus();await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.locator('#open-overview')).toBeFocused();await unchanged(page,before,observed);
});

test('text without media stays explicit and never inherits another document recording or word timing',async({page})=>{
  await open(page);const before=await api(page,'/api/view'),observed=observe(page);
  await overview(page);await expect(page.locator('#overview-traces')).toHaveAccessibleName(/across 0:16/);await page.locator('#overview-close').click();
  await page.locator('[data-document="xmlfiles/no-media.xml"]').click();await page.locator('[data-token="untimed"]').click();const dialog=await overview(page);
  await expect(dialog).toContainText('SYNTHETIC text without recording');await expect(page.locator('#overview-media')).toContainText(/no.*recording|no.*media|unavailable|absent/i);
  await expect(page.locator('#overview-play')).toBeDisabled();await expect(page.locator('#overview-seek')).toBeDisabled();
  await expect(page.locator('#overview-selection-count')).toContainText(/\b1\b/);await expect(page.locator('#overview-selection-text')).toContainText('SYNTHETIC supplied words without timing');
  await expect(page.locator('#overview-selection-timing')).toContainText(/unknown|unavailable|absent|no.*timing/i);
  await expect(page.locator('#overview-traces')).toHaveAccessibleName(/no measured trace available/i);await expect(page.locator('#overview-traces')).not.toHaveAccessibleName(/0:16/);
  expect(await page.locator('#audio').getAttribute('src')).toBeNull();await expect(dialog).toHaveAttribute('data-motion','ready');await unchanged(page,before,observed);
});

test('dark and light overview remain bounded and usable at desktop and phone widths',async({page})=>{
  await open(page);const before=await api(page,'/api/view'),observed=observe(page);
  for(const theme of ['dark','light']){
    if((await page.locator('html').getAttribute('data-theme'))!==theme)await page.locator('#toggle-theme').click();
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);const dialog=await overview(page);
      const bounds=await dialog.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(-1);expect(bounds!.y).toBeGreaterThanOrEqual(-1);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
      expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(page.locator('#overview-close')).toBeVisible();await evidence(page,`overview-${theme}-${viewport.width}`);await page.locator('#overview-close').click();
    }
  }
  await unchanged(page,before,observed);
});

test('reduced motion is static while selection and real playback controls remain available',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);const before=await api(page,'/api/view'),observed=observe(page);
  await page.locator('[data-token="w1"]').click();const dialog=await overview(page);await expect(dialog).toHaveAttribute('data-motion','reduced');
  await expect(page.locator('#overview-motion-status')).toContainText('Reduced motion: static view');await expect(page.locator('#overview-selection-count')).toContainText(/\b1\b/);
  await page.locator('#overview-play').click();await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>!audio.paused&&audio.currentTime>.1)).toBe(true);
  await expect(dialog).toHaveAttribute('data-motion','reduced');expect(await dialog.evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
  await evidence(page,'overview-reduced-motion');await page.locator('#overview-play').click();await page.keyboard.press('Escape');await expect(page.locator('#open-overview')).toBeFocused();await unchanged(page,before,observed);
});

async function desktopState(page:Page){
  await page.addInitScript(()=>{
    const qa=(window as any).__overviewQA={state:{status:'ready',configured:true},reads:0,writes:[] as string[]};
    (window as any).workbenchDesktop={
      state:async()=>({status:'ready',project:{id:'00000000-0000-4000-8000-000000000092',project:'live-overview',title:'SYNTHETIC overview'},recent:[],error:null,version:'synthetic-test'}),
      semanticaState:async()=>{qa.reads++;return structuredClone(qa.state)},
      configureSemantica:async()=>{qa.writes.push('configure');throw new Error('Unexpected configure')},runSemantica:async()=>{qa.writes.push('run');throw new Error('Unexpected run')},exportSemantica:async()=>{qa.writes.push('export');throw new Error('Unexpected export')},
      reportDraft:()=>{},reportAppearance:()=>{},readDraftJournal:async()=>null,persistDraftJournal:async()=>{},onState:()=>()=>{},onMenu:(listener:any)=>{(qa as any).menu=listener;return()=>{(qa as any).menu=null}},
    };
  });
}

test('read-only desktop refresh shows counts only for an approved exact generation and clears stale claims',async({page})=>{
  await desktopState(page);await open(page);let before=await api(page,'/api/view');
  await api(page,'/api/review',{revision:before.revision.id,snapshot_hash:before.revision.snapshot_hash,decision:'approved',note:'SYNTHETIC explicit review for overview display qualification'});
  await page.reload();await expect(page.locator('[data-token="w1"]')).toBeVisible();before=await api(page,'/api/view');const observed=observe(page);
  const current={status:'ready',configured:true,current:{generation_id:'SYNTHETIC-overview-display-only',revision:before.revision.id,snapshot_hash:before.revision.snapshot_hash,mapping_version:'corpus-evidence/2',node_count:12,edge_count:11,native_reopen:true},lastAttempt:{status:'completed',revision:before.revision.id},export:{validated:true,filename:'SYNTHETIC-portable-folder'}};
  await page.evaluate(state=>{(window as any).__overviewQA.state=state},current);const dialog=await overview(page);await page.locator('#overview-refresh').click();
  await expect(page.locator('#overview-review')).toContainText(/approved/i);await expect(dialog).toContainText(/12\s+nodes/);await expect(dialog).toContainText(/11\s+edges/);
  const reads=await page.evaluate(()=>(window as any).__overviewQA.reads);await page.evaluate(()=>{(window as any).__overviewQA.state.current.snapshot_hash='c'.repeat(64)});await page.locator('#overview-refresh').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__overviewQA.reads)).toBeGreaterThan(reads);await expect(dialog).toContainText(/stale|differ|another|older|earlier|out.of.date/i);await expect(dialog).not.toContainText(/12\s+nodes/);
  const failure='SYNTHETIC runtime unavailable: choose compatible Python and retry. <img src=x onerror=alert(1)>';
  await page.evaluate(message=>{(window as any).__overviewQA.state={status:'failed',configured:true,lastAttempt:{status:'failed',message}}},failure);await page.locator('#overview-refresh').click();
  await expect(page.locator('#overview-runtime')).toHaveText('Latest attempt failed');await expect(page.locator('#overview-generation')).toContainText(failure);await expect(page.locator('#overview-generation img')).toHaveCount(0);
  await expect(dialog).not.toContainText('Ready after review');await expect(dialog).not.toContainText(/12\s+nodes/);
  await page.evaluate(()=>{(window as any).__overviewQA.state={status:'interrupted',configured:true,lastAttempt:{status:'interrupted'}}});await page.locator('#overview-refresh').click();
  await expect(page.locator('#overview-runtime')).toHaveText('Attempt interrupted');await expect(page.locator('#overview-generation')).toContainText(/retry safely/i);await expect(dialog).not.toContainText('Ready after review');
  for(const [status,label] of [['running','Running locally'],['checking','Checking runtime'],['verifying','Verifying graph'],['exporting','Exporting graph']]){
    await page.evaluate(status=>{(window as any).__overviewQA.state={status,configured:true}},status);await page.locator('#overview-refresh').click();await expect(page.locator('#overview-runtime')).toHaveText(label);
    await expect(page.locator('#overview-generation')).toContainText(`Observed local operation: ${status}`);await expect(dialog).not.toContainText('Ready after review');await expect(dialog).not.toContainText(/12\s+nodes/);
  }
  await page.evaluate(()=>{for(const command of ['history','research','search','export','save'])(window as any).__overviewQA.menu(command)});await expect(dialog).toBeVisible();await expect(page.locator('[data-tab="token"]')).toHaveAttribute('aria-pressed','true');
  await Promise.all([page.waitForRequest(request=>new URL(request.url()).pathname==='/api/session'&&request.method()==='GET'),page.evaluate(()=>(window as any).__overviewQA.menu('backend-reconnected'))]);await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__overviewQA.writes)).toEqual([]);await unchanged(page,before,observed);
  expect(createHash('sha256').update(readFileSync(resolve(runtime,'package/Raw/original.txt'))).digest('hex')).toBe(before.snapshot.files['Raw/original.txt'].sha256);
});
