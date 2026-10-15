import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// UI control-plane qualification only. The optional real Semantica runtime is
// exercised by the separate native integration suite, never by this mock bridge.
const root=resolve('..'),binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
let runtime:string,service:ChildProcess|undefined,code='';
const raw='{"fixture":"SYNTHETIC RAW ASR: preserve bytes","text":"their reading","word_times":null,"confidence":null}\n';

function audioFixture(){
  const rate=16000,count=rate*4,bytes=Buffer.alloc(44+count*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)bytes.writeInt16LE(Math.round(3000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return bytes;
}
test.beforeEach(async()=>{
  mkdirSync(resolve(root,'.private'),{recursive:true});runtime=mkdtempSync(resolve(root,'.private/browser-research-handoff-'));service=undefined;
  for(const folder of ['Resources','xmlfiles','Annotations','Audio','Raw','Other'])mkdirSync(resolve(runtime,'package',folder),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(runtime,'package/xmlfiles/research.xml'),"<TEI><teiHeader><title>SYNTHETIC uncertainty and handoff</title><note>Generated tone and authored practice text; no recorded speech or linguistic accuracy claim.</note><media url='tone.wav'/></teiHeader><text><body><u id='u1' start='0' end='4'><tok id='w1'>their</tok> <tok id='w2' note='SYNTHETIC uncertain reading: another listening pass is needed'>reading</tok>.</u></body></text></TEI>");
  writeFileSync(resolve(runtime,'package/xmlfiles/second.xml'),"<TEI><teiHeader><title>SYNTHETIC second document</title></teiHeader><text><tok id='other'>SECOND-SYNTHETIC-DOCUMENT</tok></text></TEI>");
  writeFileSync(resolve(runtime,'package/Annotations/review_research.xml'),"<spanGrp><span id='uncertainty' corresp='#w2' label='uncertain reading' note='SYNTHETIC interpretation remains uncertain'/></spanGrp>");
  writeFileSync(resolve(runtime,'package/Raw/synthetic-asr.json'),raw);writeFileSync(resolve(runtime,'package/Audio/tone.wav'),audioFixture());writeFileSync(resolve(runtime,'package/Other/preserved.bin'),Buffer.from([0,255,12,128]));
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','research-ui']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','research-ui','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterEach(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service!.once('exit',()=>done()))}});
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw new Error(await response.text());return response.json()},{path,body})}
async function head(page:Page){return api(page,'/api/view')}
async function open(page:Page){await page.goto('/#session='+code);await expect(page.locator('[data-token="w1"]')).toBeVisible()}
async function research(page:Page){await page.locator('#open-research').click();await expect(page.locator('#research-status')).toBeVisible()}
async function review(page:Page,decision:string){const view=await head(page);await api(page,'/api/review',{revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,decision,note:'SYNTHETIC explicit UI control-plane review'});return view}

async function mockDesktop(page:Page,configured=true){
  await page.addInitScript(({configured})=>{
    const clone=(value:any)=>JSON.parse(JSON.stringify(value));
    const desktopState={status:'ready',project:{id:'00000000-0000-4000-8000-000000000091',project:'research-ui',title:'SYNTHETIC handoff UI fixture'},recent:[],error:null,version:'synthetic-test'};
    const qa=(window as any).__researchQA={state:{status:'ready',configured,runtime:configured?{semantica_version:'0.6.8',compiler_commit:'a'.repeat(40)}:null},calls:[] as any[],holdRun:false,holdState:false,nextRun:null,failRun:null,failConfigure:null,cancelExport:false};
    (window as any).workbenchDesktop={
      state:async()=>clone(desktopState),chooseOpen:async()=>{},importPackage:async()=>{},createDemo:async()=>{},openRecent:async()=>{},exportRevision:async()=>({cancelled:true}),backup:async()=>({cancelled:true}),retry:async()=>{},
      semanticaState:async()=>{qa.calls.push({method:'state'});if(qa.holdState){qa.holdState=false;return new Promise(resolve=>{qa.releaseState=()=>resolve(clone(qa.state))})}return clone(qa.state)},
      configureSemantica:async()=>{qa.calls.push({method:'configure'});if(qa.failConfigure)throw new Error(qa.failConfigure);qa.state={...qa.state,configured:true,runtime:{semantica_version:'0.6.8',compiler_commit:'a'.repeat(40)}};return clone(qa.state)},
      runSemantica:async(payload:any)=>{qa.calls.push({method:'run',payload:clone(payload)});if(qa.holdRun)await new Promise<void>(resolve=>{qa.releaseRun=resolve});if(qa.failRun){const message=qa.failRun;qa.state={...qa.state,status:'failed',current:null,lastAttempt:{status:'failed',message}};throw new Error(message)}qa.state=clone(qa.nextRun);return clone(qa.state)},
      exportSemantica:async(payload:any)=>{qa.calls.push({method:'export',payload:clone(payload)});if(qa.cancelExport)return {...clone(qa.state),cancelled:true};qa.state={...qa.state,export:{validated:true,filename:'SYNTHETIC-graph-R'+qa.state.current.revision,generation_id:payload.generation_id}};return clone(qa.state)},
      revealSemantica:async()=>{qa.calls.push({method:'reveal'})},reportDraft:()=>{},reportAppearance:()=>{},
      readDraftJournal:async()=>localStorage.getItem('synthetic-research-native-journal'),persistDraftJournal:async(raw:string)=>{localStorage.setItem('synthetic-research-native-journal',raw)},onState:()=>()=>{},onMenu:(listener:any)=>{qa.menu=listener;return()=>{qa.menu=null}},
    };
  },{configured});
}
async function prepareApprovedMock(page:Page){await mockDesktop(page);await open(page);const view=await review(page,'approved');await page.reload();await expect(page.locator('[data-token="w1"]')).toBeVisible();return view}
async function nextGeneration(page:Page,view:any,id='SYNTHETIC-ui-mock-generation'){
  const state={status:'ready',configured:true,runtime:{semantica_version:'0.6.8',compiler_commit:'a'.repeat(40)},current:{generation_id:id,revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,recipe_hash:'b'.repeat(64),mapping_version:'corpus-evidence/2',node_count:12,edge_count:16,native_reopen:true},lastAttempt:{status:'completed',revision:view.revision.id}};
  await page.evaluate(state=>{(window as any).__researchQA.nextRun=state},state);return state;
}
async function calls(page:Page,method:string){return page.evaluate(method=>(window as any).__researchQA.calls.filter((call:any)=>call.method===method),method)}

test('browser research handoff explains the native runtime requirement and file export never claims integration',async({page})=>{
  const errors:string[]=[],external:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:18912/'))external.push(request.url())});
  await open(page);const before=await head(page);await research(page);
  await expect(page.locator('#research-status')).toHaveAttribute('role','status');await expect(page.locator('#research-status')).toContainText(/desktop|local runtime/i);await expect(page.locator('#research-run')).toBeHidden();
  await page.getByRole('button',{name:'Export complete package',exact:true}).click();const link=page.getByRole('link',{name:'Download complete package',exact:true});await expect(link).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);const archive=resolve(runtime,'synthetic-evidence.zip');await download.saveAs(archive);expect(readFileSync(archive).subarray(0,2).toString()).toBe('PK');
  await expect(page.locator('#research-status')).not.toContainText(/validated generation|successfully sent|integrated|handoff complete/i);expect((await head(page)).revision).toEqual(before.revision);expect((await head(page)).approved).toBe(false);expect(await api(page,'/api/generations')).toEqual([]);
  expect(readFileSync(resolve(runtime,'package/Raw/synthetic-asr.json'),'utf8')).toBe(raw);expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('guide skip, reload and resume preserve the project and never create a review',async({page})=>{
  await open(page);const before=await head(page);let writes=0;page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(command|review)$/.test(new URL(request.url()).pathname))writes++});
  await research(page);await expect(page.getByRole('region',{name:'Corpus workflow'})).toBeVisible();await expect(page.locator('#research-guide')).toContainText(/uncertainty is not a confidence score/i);
  await page.getByRole('button',{name:'Skip guide',exact:true}).click();await expect(page.locator('#research-guide')).toBeHidden();await page.reload();await research(page);await expect(page.locator('#research-guide')).toBeHidden();
  const resume=page.getByRole('button',{name:'Resume guide',exact:true});await resume.focus();await page.keyboard.press('Enter');await expect(page.locator('#research-guide')).toBeVisible();
  await page.getByRole('button',{name:'Inspect preserved source',exact:true}).click();await expect(page.locator('.source-path')).toHaveText('Raw/synthetic-asr.json');await expect(page.locator('.metadata-list')).toContainText(before.snapshot.files['Raw/synthetic-asr.json'].sha256);
  await research(page);await page.getByRole('button',{name:`Review R${before.revision.id}`,exact:true}).click();await expect(page.locator('#review-current-status')).toContainText(/Unreviewed/i);await expect(page.locator('#compiler-contract')).toBeDisabled();
  expect((await head(page)).revision).toEqual(before.revision);expect((await api(page,`/api/reviews?revision=${before.revision.id}`)).reviews).toEqual([]);expect(writes).toBe(0);
});

test('guide links preserve returning token and annotation drafts, selection and source evidence',async({page})=>{
  await open(page);const before=await head(page);await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC retained listening draft');await page.getByLabel('Reviewer note',{exact:true}).fill('SYNTHETIC uncertain: retain competing interpretation');
  await research(page);await page.getByRole('button',{name:'Annotate uncertainty',exact:true}).click();await expect(page.locator('#inspector-content')).toContainText('1 selected: w2');await page.getByLabel('Span label',{exact:true}).fill('SYNTHETIC unsaved uncertainty');
  await research(page);await page.getByRole('button',{name:'Inspect preserved source',exact:true}).click();await expect(page.locator('.source-path')).toHaveText('Raw/synthetic-asr.json');await research(page);await page.getByRole('button',{name:'Correct selected token',exact:true}).click();
  await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('SYNTHETIC retained listening draft');await expect(page.getByLabel('Reviewer note',{exact:true})).toHaveValue('SYNTHETIC uncertain: retain competing interpretation');
  await research(page);await page.getByRole('button',{name:'Annotate uncertainty',exact:true}).click();await expect(page.getByLabel('Span label',{exact:true})).toHaveValue('SYNTHETIC unsaved uncertainty');
  await research(page);await page.getByRole('button',{name:`Review R${before.revision.id}`,exact:true}).click();await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#message')).toContainText(/drafts/i);
  expect((await head(page)).revision).toEqual(before.revision);expect((await head(page)).approved).toBe(false);expect((await api(page,`/api/reviews?revision=${before.revision.id}`)).reviews).toEqual([]);expect(readFileSync(resolve(runtime,'package/Raw/synthetic-asr.json'),'utf8')).toBe(raw);
});

test('mock bridge requires configured runtime and explicit approval of the exact saved evidence',async({page})=>{
  await mockDesktop(page,false);await open(page);const original=await head(page);await research(page);await expect(page.locator('#research-status')).toContainText(/review and approve/i);await expect(page.locator('#research-run')).toBeDisabled();expect(await calls(page,'run')).toEqual([]);
  await page.locator('#research-configure').click();await expect.poll(async()=>(await calls(page,'configure')).length).toBe(1);await expect(page.locator('#research-run')).toBeDisabled();
  await review(page,'approved');await page.reload();await research(page);await expect(page.locator('#research-status')).toContainText(/choose the installed Python runtime/i);await expect(page.locator('#research-run')).toBeDisabled();await page.locator('#research-configure').click();await expect(page.locator('#research-run')).toBeEnabled();
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.locator('[data-token="w2"]').click();await page.getByLabel('Reviewer note',{exact:true}).fill('SYNTHETIC saved uncertainty: do not resolve by invented confidence');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText(`Saved R${original.revision.id+1}`);
  const current=await head(page);expect(current.approved).toBe(false);await research(page);await expect(page.locator('#research-run')).toBeDisabled();await expect(page.locator('#research-status')).toContainText(/review and approve/i);expect(await calls(page,'run')).toEqual([]);
  await page.getByRole('button',{name:`Review R${current.revision.id}`,exact:true}).click();await page.getByRole('combobox',{name:'Decision',exact:true}).selectOption('approved');await page.getByLabel('Review rationale',{exact:true}).fill('SYNTHETIC explicit approval preserves stated uncertainty');await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#review-current-status')).toContainText(/Approved/);
  await nextGeneration(page,current);await research(page);await expect(page.locator('#research-run')).toBeEnabled();await page.locator('#research-run').click();await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id','SYNTHETIC-ui-mock-generation');expect(await calls(page,'run')).toEqual([{method:'run',payload:{revision:current.revision.id,snapshot_hash:current.revision.snapshot_hash}}]);
  expect(await api(page,'/api/generations')).toEqual([]);expect((await head(page)).revision).toEqual(current.revision);
});

test('mock bridge blocks token and annotation drafts without dispatch or data loss',async({page})=>{
  const view=await prepareApprovedMock(page);await nextGeneration(page,view);await page.locator('[data-token="w1"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC draft before handoff');await research(page);await page.locator('#research-run').click();await expect(page.locator('#research-status')).toHaveAttribute('data-state','blocked');await expect(page.locator('#research-status')).toContainText(/save or discard all authoring drafts/i);expect(await calls(page,'run')).toEqual([]);
  await page.getByRole('button',{name:'Correct selected token',exact:true}).click();await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('SYNTHETIC draft before handoff');await page.getByRole('button',{name:'Undo unsaved edits',exact:true}).click();await expect(page.locator('#token-form')).toHaveAttribute('data-dirty','false');
  await research(page);await page.getByRole('button',{name:'Annotate uncertainty',exact:true}).click();await page.getByLabel('Span label',{exact:true}).fill('SYNTHETIC span draft before handoff');await research(page);await page.locator('#research-configure').click();await expect(page.locator('#research-status')).toHaveAttribute('data-state','blocked');expect(await calls(page,'configure')).toEqual([]);expect(await calls(page,'run')).toEqual([]);
  await page.getByRole('button',{name:'Annotate uncertainty',exact:true}).click();await expect(page.getByLabel('Span label',{exact:true})).toHaveValue('SYNTHETIC span draft before handoff');expect((await head(page)).revision).toEqual(view.revision);expect((await api(page,`/api/reviews?revision=${view.revision.id}`)).reviews).toHaveLength(1);
});

test('mock running handoff allows real tone playback, prevents duplicate dispatch and separates graph from export',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const view=await prepareApprovedMock(page);await nextGeneration(page,view);await page.evaluate(()=>{(window as any).__researchQA.holdRun=true;(document.getElementById('audio') as HTMLAudioElement).loop=true});await research(page);await page.locator('#research-run').click();await expect.poll(async()=>(await calls(page,'run')).length).toBe(1);
  await expect(page.locator('#research-status')).toContainText(/running locally/i);await expect(page.locator('#research-run')).toBeDisabled();await expect(page.locator('#research-export')).toBeDisabled();await expect(page.locator('#research-configure')).toBeDisabled();await expect(page.locator('#research-refresh')).toBeDisabled();
  await page.evaluate(()=>(window as any).__researchQA.menu('history'));await expect(page.locator('#research-status')).toBeVisible();await expect(page.locator('[data-tab="research"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#message')).toContainText('Wait for the current save or local handoff to finish. Recording controls remain available.');
  await page.locator('#research-run').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect((await calls(page,'run')).length).toBe(1);await expect(page.locator('#audio-play')).toBeEnabled();await page.locator('#audio-play').click();await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>!audio.paused&&audio.currentTime>0.1)).toBe(true);await page.locator('#audio-play').click();
  await page.evaluate(()=>(window as any).__researchQA.releaseRun());await expect(page.locator('#research-status')).toContainText(`Validated graph for R${view.revision.id}`);await expect(page.locator('#message')).toBeEmpty();await expect(page.locator('#research-generation')).toContainText('12 nodes');await expect(page.locator('#research-generation')).toContainText(/no inferred linguistic certainty/i);await expect(page.locator('#research-export')).toBeEnabled();await expect(page.locator('#research-export-status')).toBeEmpty();await expect(page.locator('#research-reveal')).toBeHidden();
  // Cancellation returns before the root's bound revision refresh completes.
  // Hold that real response to prove retry stays unavailable during cleanup.
  let releaseView!:()=>void,viewHeld=false;const heldView=new Promise<void>(resolve=>{releaseView=resolve});
  await page.route('**/api/view',async route=>{viewHeld=true;await heldView;await route.continue()});
  try{
    await page.evaluate(()=>{(window as any).__researchQA.cancelExport=true});await page.locator('#research-export').click();await expect.poll(()=>viewHeld).toBe(true);await expect(page.locator('#research-export-status')).toContainText(/export cancelled/i);await expect(page.locator('#research-export')).toBeDisabled();await expect(page.locator('#research-reveal')).toBeHidden();expect((await calls(page,'export')).length).toBe(1);
  }finally{releaseView()}
  await expect(page.locator('#research-export')).toBeEnabled();await page.unroute('**/api/view');
  await page.evaluate(()=>{(window as any).__researchQA.cancelExport=false});await page.locator('#research-export').click();await expect.poll(async()=>(await calls(page,'export')).length).toBe(2);await expect(page.locator('#research-export-status')).toContainText('Exported and reopened successfully: SYNTHETIC-graph-R'+view.revision.id);await page.locator('#research-reveal').click();expect(await calls(page,'export')).toEqual([{method:'export',payload:{generation_id:'SYNTHETIC-ui-mock-generation'}},{method:'export',payload:{generation_id:'SYNTHETIC-ui-mock-generation'}}]);expect((await calls(page,'reveal')).length).toBe(1);
  // A new run receipt has no exported folder. The old reveal action cannot
  // survive this authoritative state change, even when the graph is reused.
  await page.evaluate(()=>{(window as any).__researchQA.holdRun=false});await page.locator('#research-run').click();await expect.poll(async()=>(await calls(page,'run')).length).toBe(2);await expect(page.locator('#research-run')).toBeEnabled();await expect(page.locator('#research-export-status')).not.toContainText(/exported and reopened successfully/i);await expect(page.locator('#research-reveal')).toBeHidden();
  expect(await api(page,'/api/generations')).toEqual([]);expect((await head(page)).revision).toEqual(view.revision);expect(errors).toEqual([]);
});

test('mock runtime failure stays actionable, literal and retryable without a false validated graph',async({page})=>{
  const view=await prepareApprovedMock(page);await nextGeneration(page,view);const message='SYNTHETIC runtime unavailable: configure compatible Python and retry. <img src=x onerror="window.__handoffExecuted=true">';await page.evaluate(message=>{(window as any).__researchQA.failRun=message},message);await research(page);await page.locator('#research-run').click();await expect(page.locator('#research-status')).toHaveAttribute('data-state','failed');await expect(page.locator('#research-status')).toContainText(message);await expect(page.locator('#research-export')).toBeDisabled();await expect(page.locator('#research-generation')).toBeEmpty();await expect(page.locator('#research-status img')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__handoffExecuted)).toBeUndefined();
  expect((await head(page)).revision).toEqual(view.revision);expect((await head(page)).approved).toBe(true);await expect(page.locator('#research-run')).toBeEnabled();await page.evaluate(()=>{(window as any).__researchQA.failRun=null});await page.locator('#research-run').click();await expect(page.locator('#research-status')).toContainText(`Validated graph for R${view.revision.id}`);expect((await calls(page,'run')).length).toBe(2);expect(await api(page,'/api/generations')).toEqual([]);
});

test('mock stale generation never enables export and a late state response cannot replace another inspector',async({page})=>{
  const view=await prepareApprovedMock(page),state=await nextGeneration(page,view);state.current.snapshot_hash='c'.repeat(64);await page.evaluate(state=>{(window as any).__researchQA.state=state},state);await research(page);await expect(page.locator('#research-status')).toContainText(/different saved revision/i);await expect(page.locator('#research-export')).toBeDisabled();await expect(page.locator('#research-generation')).toBeEmpty();expect(await calls(page,'export')).toEqual([]);
  await page.getByRole('button',{name:'XML',exact:true}).click();await page.evaluate(()=>{(window as any).__researchQA.holdState=true});await research(page);await expect.poll(()=>page.evaluate(()=>typeof (window as any).__researchQA.releaseState)).toBe('function');await page.getByRole('button',{name:'XML',exact:true}).click();await expect(page.locator('#xml-preview')).toContainText('SYNTHETIC uncertainty and handoff');await page.evaluate(()=>(window as any).__researchQA.releaseState());await expect(page.locator('#xml-preview')).toContainText('SYNTHETIC uncertainty and handoff');await expect(page.locator('#research-status')).toHaveCount(0);expect((await head(page)).revision).toEqual(view.revision);
});

test('mock configure failure before an attempt receipt survives state refresh and remains retryable',async({page})=>{
  const view=await prepareApprovedMock(page),state=await nextGeneration(page,view);await page.evaluate(state=>{(window as any).__researchQA.state=state},state);await research(page);await expect(page.locator('#research-status')).toContainText(`Validated graph for R${view.revision.id}`);
  const message='SYNTHETIC Python compatibility check failed. Choose an installed Semantica 0.6.8 runtime and retry.';await page.evaluate(message=>{(window as any).__researchQA.failConfigure=message},message);const reads=(await calls(page,'state')).length;await page.locator('#research-configure').click();
  await expect.poll(async()=>(await calls(page,'state')).length).toBeGreaterThan(reads);await expect(page.locator('#research-run')).toBeEnabled();await expect(page.locator('#research-status')).toHaveAttribute('data-state','failed');await expect(page.locator('#research-status')).toContainText(message);await expect(page.locator('#research-configure')).toBeEnabled();await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id','SYNTHETIC-ui-mock-generation');
  expect(await page.evaluate(()=>(window as any).__researchQA.state.lastAttempt.status)).toBe('completed');expect((await head(page)).revision).toEqual(view.revision);expect((await head(page)).approved).toBe(true);
  await page.evaluate(()=>{(window as any).__researchQA.failConfigure=null});await page.locator('#research-configure').click();await expect(page.locator('#research-status')).toContainText(`Validated graph for R${view.revision.id}`);await expect(page.locator('#research-status')).not.toContainText(message);expect((await calls(page,'configure')).length).toBe(2);expect(await api(page,'/api/generations')).toEqual([]);
});

test('mock legacy accepted graph keeps its evidence counts and requires a V2 run before portable export',async({page})=>{
  const view=await prepareApprovedMock(page),v2=await nextGeneration(page,view,'SYNTHETIC-ui-mock-v2');
  const legacy={...v2,current:{...v2.current,generation_id:'SYNTHETIC-ui-mock-legacy',mapping_version:'corpus-evidence/1',node_count:3,edge_count:4,native_reopen:false}};
  await page.evaluate(state=>{(window as any).__researchQA.state=state},legacy);await research(page);
  await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id','SYNTHETIC-ui-mock-legacy');await expect(page.locator('#research-generation')).toContainText('3 nodes');await expect(page.locator('#research-generation')).toContainText('4 edges');await expect(page.locator('#research-status')).toContainText(/legacy mapping/i);await expect(page.locator('#research-status')).toContainText(/V2 generation for portable export/i);
  await expect(page.locator('#research-run')).toHaveText('Run local Semantica');await expect(page.locator('#research-run')).toBeEnabled();await expect(page.locator('#research-export')).toBeDisabled();await expect(page.locator('#research-reveal')).toBeHidden();expect(await calls(page,'run')).toEqual([]);expect(await calls(page,'export')).toEqual([]);
  await page.locator('#research-run').click();await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id','SYNTHETIC-ui-mock-v2');await expect(page.locator('#research-status')).toContainText(`Validated graph for R${view.revision.id}`);await expect(page.locator('#research-generation')).toContainText('12 nodes');await expect(page.locator('#research-run')).toHaveText('Run again / reuse generation');await expect(page.locator('#research-export')).toBeEnabled();await expect(page.locator('#research-export-status')).toBeEmpty();
  expect(await calls(page,'run')).toEqual([{method:'run',payload:{revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash}}]);expect(await calls(page,'export')).toEqual([]);expect(await api(page,'/api/generations')).toEqual([]);expect((await head(page)).revision).toEqual(view.revision);expect((await head(page)).approved).toBe(true);
});
