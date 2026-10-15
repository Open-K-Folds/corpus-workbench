import {test,expect,_electron as electron} from '@playwright/test';
import {execFile} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

// Optional installed-runtime qualification. Public tests do not install or claim
// this separately supplied compiler. All source files and profiles are synthetic.
const root=fileURLToPath(new URL('../..',import.meta.url));
const executable=process.env.WB_ELECTRON_EXECUTABLE;
const binary=process.env.WB_DESKTOP_BACKEND??(executable?join(executable,'..','resources/backend/corpus-workbench.exe'):null);
const python=process.env.WB_SEMANTICA_PYTHON;
const compilerRoot=process.env.WB_SEMANTICA_COMPILER_ROOT;
const evidence=process.env.WB_EVIDENCE_DIR??join(tmpdir(),'workbench-local-preparation-native');
const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function tone(seconds=4){
  const rate=16000,count=rate*seconds,wav=Buffer.alloc(44+count*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++)wav.writeInt16LE(Math.round(1600*Math.sin(2*Math.PI*(i<rate*2?220:880)*i/rate)),44+i*2);
  return wav;
}
function workspace(name){mkdirSync(evidence,{recursive:true});const directory=join(evidence,`${name}-${process.pid}-${Date.now()}`);mkdirSync(directory);return directory}
function directories(path){return existsSync(path)?readdirSync(path):[]}
function productHashes(){
  const directory=join(executable,'..');
  const files=['resources/app/desktop/main.cjs','resources/app/desktop/preload.cjs','resources/app/desktop/preparation.cjs','resources/app/desktop/preparation-format.cjs','resources/app/desktop/semantica.cjs','resources/backend/corpus-workbench.exe','resources/semantica/semantica-handoff.py','resources/ui/index.html'];
  for(const name of readdirSync(join(directory,'resources/ui/assets')))if(/\.(css|js)$/.test(name))files.push('resources/ui/assets/'+name);
  return Object.fromEntries(files.map(file=>[file,sha(readFileSync(join(directory,file)))]));
}
async function launch(profile,errors,consoleErrors){
  const env={...process.env,WB_DESKTOP_USER_DATA:profile};
  for(const key of ['ELECTRON_RUN_AS_NODE','WB_DESKTOP_STORE','WB_DESKTOP_PROJECT'])delete env[key];
  const application=await electron.launch({executablePath:executable,args:[],cwd:root,env,timeout:30000});
  const page=await application.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
  page.on('dialog',dialog=>void dialog.accept().catch(()=>{}));
  await application.evaluate(({BrowserWindow,dialog})=>{
    BrowserWindow.getAllWindows()[0].setContentSize(1440,1000);
    globalThis.__preparationFileQA={open:[],save:[],calls:[]};
    // Substitute file selection only. Preparation, its frozen preview, native
    // import/reload, review, compiler and consumer all execute their real code.
    dialog.showOpenDialog=async(_window,options)=>{const qa=globalThis.__preparationFileQA;qa.calls.push({kind:'open',title:options.title});const value=qa.open.shift();return value?{canceled:false,filePaths:[value]}:{canceled:true,filePaths:[]}};
    dialog.showSaveDialog=async(_window,options)=>{const qa=globalThis.__preparationFileQA;qa.calls.push({kind:'save',title:options.title});const value=qa.save.shift();return value?{canceled:false,filePath:value}:{canceled:true}};
  });
  await expect(page).toHaveTitle('Corpus workbench');expect(page.url()).toBe('workbench://app/');
  return {application,page};
}
async function queue(application,kind,...values){await application.evaluate((_electron,{kind,values})=>globalThis.__preparationFileQA[kind].push(...values),{kind,values})}
async function desktopState(page){return page.evaluate(()=>window.workbenchDesktop.state())}
async function head(page){return page.evaluate(async()=>{const response=await fetch('/api/view');if(!response.ok)throw new Error(await response.text());return response.json()})}
async function handoff(page){return page.evaluate(()=>window.workbenchDesktop.semanticaState())}
async function reviews(page,revision){return page.evaluate(async revision=>{const response=await fetch(`/api/reviews?revision=${revision}`);if(!response.ok)throw new Error(await response.text());return response.json()},revision)}
async function ready(page){await expect(page.locator('#save-state')).toContainText('Saved R');await expect(page.locator('[data-token="draft-t000001"] .reading-text')).toBeVisible();await expect.poll(()=>page.locator('#tokens').evaluate(element=>element.inert)).toBe(false)}
async function openPreparation(page){
  const trigger=page.locator('#desktop-prepare');
  if(!await trigger.isVisible())await page.locator('.desktop-project-switcher > details > summary').click();
  await trigger.click();await expect(page.getByRole('dialog',{name:'Recording + transcript',exact:true})).toBeVisible();
}
async function preview(application,page,audio,transcript,format,title){
  await openPreparation(page);await page.locator('#preparation-format').selectOption(format);await page.locator('#preparation-title').fill(title);
  await queue(application,'open',audio,transcript);await page.locator('#preparation-choose').click();
  await expect(page.locator('#preparation-preview')).toBeVisible();await expect(page.locator('#preparation-confirm')).toBeEnabled();
}
async function confirm(page){
  const reloaded=page.waitForEvent('domcontentloaded');await page.locator('#preparation-confirm').click();await reloaded;await ready(page);
}
async function capture(application,page,filename){
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await application.evaluate(async({BrowserWindow},file)=>{const image=await BrowserWindow.getAllWindows()[0].webContents.capturePage();process.mainModule.require('node:fs').writeFileSync(file,image.toPNG())},join(evidence,filename));
}
async function openResearch(page){await page.locator('#open-research').click();await expect(page.locator('#research-status')).not.toHaveAttribute('data-state','loading')}
async function approve(page,note){
  await page.getByRole('button',{name:'Review',exact:true}).click();await page.locator('#review-form').getByRole('combobox',{name:'Decision',exact:true}).selectOption('approved');
  await page.getByLabel('Review rationale',{exact:true}).fill(note);await page.getByRole('button',{name:'Record review',exact:true}).click();
  await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision','approved');
}
function activeAuthority(profile,state){
  const registry=JSON.parse(readFileSync(join(profile,'desktop-projects.json'),'utf8'));
  const entry=registry.recent.find(value=>value.id===state.project.id);expect(entry).toBeTruthy();return entry;
}
async function unapprovedContractRejected(authority,revision){
  let failure;
  try{await execute(binary,['contract','--store',authority.store,'--project',authority.project,'--revision',String(revision),'--mapping-version','corpus-evidence/2'],{windowsHide:true,timeout:30000})}catch(error){failure=error}
  expect(failure).toBeTruthy();expect(String(failure.stderr)).toMatch(/current approved/i);
}
async function completeExport(application,page,file){
  await queue(application,'save',file);await page.locator('#export-package').click();await expect(page.locator('#message')).toContainText('Complete package saved');expect(existsSync(file)).toBe(true);
  const code="import hashlib,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); p=json.loads(z.read('Resources/preparation-provenance.json')); print(json.dumps({'audio_sha256':hashlib.sha256(z.read(p['sources']['audio']['path'])).hexdigest(),'raw_sha256':hashlib.sha256(z.read(p['sources']['transcript']['path'])).hexdigest(),'provenance':p,'xml':z.read('xmlfiles/transcript.xml').decode('utf-8')}))";
  const {stdout}=await execute(python,['-B','-c',code,file],{windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});return JSON.parse(stdout);
}
async function verifyPortable(path){
  const adapter=join(executable,'..','resources/semantica/semantica-handoff.py');
  const {stdout}=await execute(python,['-B',adapter,'--verify-package',path,'--compiler-root',compilerRoot],{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}
async function failureEvidence(application,page,name,errors,consoleErrors){
  if(application&&page&&!page.isClosed()){
    writeFileSync(join(evidence,`${name}-failure.json`),JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),state:await desktopState(page).catch(()=>null),errors,consoleErrors},null,2));
    await capture(application,page,`${name}-failure.png`);
  }
}

test('native recording and UTF-8 transcript preparation reaches reviewed actual Semantica export without inventing word timing',async()=>{
  test.skip(!executable||!python||!compilerRoot,'Optional native/runtime qualification: set WB_ELECTRON_EXECUTABLE, WB_SEMANTICA_PYTHON and WB_SEMANTICA_COMPILER_ROOT');test.setTimeout(12*60*1000);
  for(const file of [executable,binary,python,compilerRoot])expect(existsSync(file)).toBe(true);
  const work=workspace('utf8-preparation'),profile=join(work,'isolated-profile'),audio=join(work,'SYNTHETIC-tone.wav'),raw=join(work,'SYNTHETIC-mixed.txt'),invalid=join(work,'SYNTHETIC-invalid-utf8.txt');
  const rawText="  Molo sisi  sawubona.\r\nEish, café e\u0301🙂  we're here — kodwa? مرحبا\n";
  const expectedWords=['Molo','sisi','sawubona.','Eish,','café','e\u0301🙂',"we're",'here','—','kodwa?','مرحبا'];
  writeFileSync(audio,tone());writeFileSync(raw,Buffer.from(rawText,'utf8'));writeFileSync(invalid,Buffer.from([0xc3,0x28]));
  const sourceHashes={audio:sha(readFileSync(audio)),raw:sha(readFileSync(raw))};
  let application,page;const errors=[],consoleErrors=[];
  try{
    ({application,page}=await launch(profile,errors,consoleErrors));
    await openPreparation(page);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-status')).toContainText('File selection cancelled');
    await queue(application,'open',audio,invalid);await page.locator('#preparation-choose').click();await expect(page.locator('#preparation-status')).toHaveAttribute('role','alert');await expect(page.locator('#preparation-status')).toContainText('UTF-8');await expect(page.locator('#preparation-confirm')).toBeDisabled();
    expect((await desktopState(page)).project).toBeNull();expect(directories(join(profile,'projects'))).toEqual([]);expect(directories(join(profile,'preparation/receipts'))).toEqual([]);
    await page.locator('#preparation-cancel').click();
    await preview(application,page,audio,raw,'utf8-text','SYNTHETIC code-switching preparation');
    expect(await page.locator('.preparation-excerpt').textContent()).toBe(rawText);await expect(page.locator('#preparation-preview')).toContainText('word timing unavailable');
    expect((await desktopState(page)).project).toBeNull();expect(directories(join(profile,'projects'))).toEqual([]);
    await capture(application,page,'preparation-utf8-preview-light.png');
    await page.locator('#preparation-cancel').click();await expect(page.locator('#preparation-dialog')).toHaveCount(0);
    expect(directories(join(profile,'preparation/previews'))).toEqual([]);expect(directories(join(profile,'projects'))).toEqual([]);
    await preview(application,page,audio,raw,'utf8-text','SYNTHETIC code-switching preparation');await confirm(page);
    const imported=await head(page),state=await desktopState(page),authority=activeAuthority(profile,state);
    expect(imported.revision.id).toBe(1);expect(imported.approved).toBe(false);expect((await reviews(page,1)).reviews).toEqual([]);
    expect(imported.documents).toHaveLength(1);expect(imported.documents[0].tokens.map(value=>value.original)).toEqual(expectedWords);expect(imported.documents[0].segments).toEqual([]);
    for(const token of imported.documents[0].tokens){expect(token.start_us).toBeNull();expect(token.end_us).toBeNull();expect(token.corrected).toBeNull();expect(token.normalized).toBeNull();expect(token.language_effective).toBeNull()}
    expect(imported.snapshot.files['Audio/recording.wav'].sha256).toBe(sourceHashes.audio);expect(imported.snapshot.files['Raw/transcript.raw.txt'].sha256).toBe(sourceHashes.raw);
    await unapprovedContractRejected(authority,1);
    await expect(page.locator('#audio-play')).toBeEnabled();await page.locator('#audio-play').click();await expect.poll(()=>page.locator('#audio').evaluate(value=>value.currentTime)).toBeGreaterThan(.1);await page.locator('#audio-play').click();
    await page.locator('[data-token="draft-t000001"]').click();await page.locator('#listen-selected').click();await expect(page.locator('#message')).toContainText('No observed timing');
    const note='SYNTHETIC uncertain hearing; supplied code-switching and slang need another listening pass; confidence unknown.';
    await page.getByLabel('Human-corrected reading',{exact:true}).fill('Molweni');await page.getByLabel('Reviewer note',{exact:true}).fill(note);await page.getByLabel('Revision name',{exact:true}).fill('SYNTHETIC human listening correction');
    await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R2');
    const corrected=await head(page);expect(corrected.documents[0].tokens[0]).toMatchObject({original:'Molo',corrected:'Molweni',normalized:null,start_us:null,end_us:null,attrs:{note}});expect(corrected.approved).toBe(false);
    await openResearch(page);await expect(page.locator('#research-run')).toBeDisabled();
    await queue(application,'open',python,compilerRoot);await page.locator('#research-configure').click();await expect.poll(async()=>(await handoff(page)).configured,{timeout:180000}).toBe(true);
    await approve(page,'SYNTHETIC explicit full-package mechanics review. Unknown timing, origin and confidence stay unknown; uncertainty note retained.');
    const approved=await head(page),reviewRecords=await reviews(page,2);expect(approved.approved).toBe(true);expect(reviewRecords.reviews).toHaveLength(1);
    const complete=await completeExport(application,page,join(work,'prepared-reviewed-package.zip'));
    expect(complete.audio_sha256).toBe(sourceHashes.audio);expect(complete.raw_sha256).toBe(sourceHashes.raw);expect(complete.provenance.asr).toMatchObject({word_times:null,confidence:null,speaker_assignment:null,language_assignment:null});expect(complete.provenance.asr.supplied.model).toBeNull();expect(complete.provenance.projection.word_times).toBeNull();expect(complete.provenance.status).toBe('unreviewed-supplied-transcript');
    // Source-preparation provenance describes the imported draft; current human
    // approval is a separate exact-revision review record, never a rewritten source.
    await openResearch(page);if(await page.locator('#research-skip-guide').isVisible())await page.locator('#research-skip-guide').click();
    await page.locator('#research-run').click();await expect(page.locator('#research-status')).toContainText('Validated graph for R2',{timeout:240000});
    const generation=await handoff(page);expect(generation.current.native_reopen).toBe(true);expect(generation.current.node_count).toBe(12);expect(generation.current.edge_count).toBe(11);
    const destination=join(work,'portable-exports');mkdirSync(destination);await queue(application,'open',destination);await page.locator('#research-export').click();await expect(page.locator('#research-export-status')).toContainText('Exported and reopened successfully',{timeout:240000});
    const exported=await handoff(page),output=join(destination,exported.export.filename),portable=await verifyPortable(output);
    expect(portable).toMatchObject({ok:true,verified:true,native_reopen:true,files_verified:4,generation_id:generation.current.generation_id,node_count:12,edge_count:11});
    const manifest=JSON.parse(readFileSync(join(output,'manifest.json'),'utf8')),graph=JSON.parse(readFileSync(join(output,'graph.json'),'utf8'));
    expect(manifest.review).toMatchObject({decision:'approved',revision:2,snapshot_hash:approved.revision.snapshot_hash});expect(manifest.source_artifacts['Raw/transcript.raw.txt'].sha256).toBe(sourceHashes.raw);expect(manifest.source_artifacts['Audio/recording.wav'].sha256).toBe(sourceHashes.audio);
    const graphToken=graph.nodes.find(value=>value.properties.anchor.kind==='token'&&value.properties.anchor.external_id==='draft-t000001');expect(graphToken.properties.source).toMatchObject({original:'Molo',corrected:'Molweni',normalized:null,start_us:null,end_us:null,attrs:{note}});
    await capture(application,page,'preparation-reviewed-handoff-light.png');await page.getByRole('button',{name:'Dark appearance',exact:true}).click();await capture(application,page,'preparation-reviewed-handoff-dark.png');
    await preview(application,page,audio,raw,'utf8-text','SYNTHETIC alternate display title');await expect(page.locator('#preparation-preview')).toContainText('Existing working copy found');await expect(page.locator('#preparation-confirm')).toHaveText('Open existing copy');await capture(application,page,'preparation-duplicate-dark.png');await confirm(page);
    const duplicate=await head(page),duplicateState=await desktopState(page);expect(duplicateState.project.id).toBe(state.project.id);expect(duplicate.revision).toEqual(approved.revision);expect(duplicate.approved).toBe(true);expect(await reviews(page,2)).toEqual(reviewRecords);expect(duplicate.documents[0].tokens[0].corrected).toBe('Molweni');expect(directories(join(profile,'projects'))).toHaveLength(1);expect(directories(join(profile,'preparation/receipts'))).toHaveLength(1);expect((await handoff(page)).current.generation_id).toBe(generation.current.generation_id);
    expect(sha(readFileSync(audio))).toBe(sourceHashes.audio);expect(sha(readFileSync(raw))).toBe(sourceHashes.raw);expect(errors).toEqual([]);expect(consoleErrors).toEqual([]);
    writeFileSync(join(evidence,'local-preparation-native-evidence.json'),JSON.stringify({synthetic_only:true,url:page.url(),product_files_sha256:productHashes(),source_hashes:sourceHashes,imported_revision:imported.revision,approved_revision:approved.revision,source_provenance:complete.provenance,review:reviewRecords,generation,portable,duplicate_preserves_authority_revision_review:true,cancel_and_invalid_create_no_authority:true,unapproved_contract_denied:true,actual_audio_playback:true,all_word_times_null:true,raw_sources_unchanged:true,only_file_dialogs_substituted:true,page_errors:errors,console_errors:consoleErrors},null,2));
  }catch(error){await failureEvidence(application,page,'local-preparation',errors,consoleErrors);throw error}
  finally{if(application)await application.close()}
});

test('native Omnilingual chunk preparation keeps supplied chunk bounds separate from absent word timing',async()=>{
  test.skip(!executable,'Optional native qualification: set WB_ELECTRON_EXECUTABLE');test.setTimeout(120000);
  const work=workspace('chunk-preparation'),profile=join(work,'isolated-profile'),audio=join(work,'SYNTHETIC-chunks.wav'),raw=join(work,'SYNTHETIC-chunks.json');
  writeFileSync(audio,tone());
  const source={request_endpoint:'/v1/audio/transcriptions',response_format:'text',source_sha256:sha(readFileSync(audio)),decoded_duration_seconds:4,model:'SYNTHETIC supplied model claim',chunks:[{index:0,text:'Molo  ',http_status:200,error:null,empty:false,start_seconds:0,end_seconds:2,duration_seconds:2},{index:1,text:'sawubona café 🙂',http_status:200,error:null,empty:false,start_seconds:2,end_seconds:4,duration_seconds:2}]};
  writeFileSync(raw,JSON.stringify(source));let application,page;const errors=[],consoleErrors=[];
  try{
    ({application,page}=await launch(profile,errors,consoleErrors));await preview(application,page,audio,raw,'omnilingual-json','SYNTHETIC supplied chunk bounds');
    await expect(page.locator('#preparation-preview')).toContainText('2 chunks');await expect(page.locator('#preparation-preview')).toContainText('chunk bounds');expect(await page.locator('.preparation-excerpt').textContent()).toBe('Molo  sawubona café 🙂');await capture(application,page,'preparation-chunk-preview-light.png');await confirm(page);
    const view=await head(page),doc=view.documents[0];expect(view.approved).toBe(false);expect((await reviews(page,1)).reviews).toEqual([]);expect(doc.segments.map(value=>[value.start_us,value.end_us])).toEqual([[0,2000000],[2000000,4000000]]);
    expect(doc.tokens.map(value=>value.original)).toEqual(['Molo','sawubona','café','🙂']);for(const token of doc.tokens){expect(token.start_us).toBeNull();expect(token.end_us).toBeNull();expect(token.language_effective).toBeNull();expect(token.normalized).toBeNull()}
    await page.locator('[data-token="draft-t000002"]').click();await expect(page.locator('#inspector-content')).toContainText('No complete word timing');await page.locator('#listen-selected').click();await expect.poll(()=>page.locator('#audio').evaluate(value=>value.currentTime)).toBeGreaterThanOrEqual(2);await expect(page.locator('#audio')).toHaveJSProperty('paused',false);await page.locator('#audio-play').click();
    const state=await desktopState(page);await unapprovedContractRejected(activeAuthority(profile,state),1);expect(view.snapshot.files['Audio/recording.wav'].sha256).toBe(source.source_sha256);expect(view.snapshot.files['Raw/transcript.raw.json'].sha256).toBe(sha(readFileSync(raw)));expect(errors).toEqual([]);expect(consoleErrors).toEqual([]);
    writeFileSync(join(evidence,'chunk-preparation-native-evidence.json'),JSON.stringify({synthetic_only:true,source_audio_sha256:source.source_sha256,source_raw_sha256:sha(readFileSync(raw)),revision:view.revision,supplied_chunk_bounds:doc.segments,word_times_absent:true,language_and_normalization_unknown:true,explicit_review_not_granted:true,listening_uses_supplied_chunk_not_word_timing:true,page_errors:errors,console_errors:consoleErrors},null,2));
  }catch(error){await failureEvidence(application,page,'chunk-preparation',errors,consoleErrors);throw error}
  finally{if(application)await application.close()}
});
