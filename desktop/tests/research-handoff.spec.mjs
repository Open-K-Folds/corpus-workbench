import {test,expect,_electron as electron} from '@playwright/test';
import {execFile} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createPackage} from './fixtures.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const python=process.env.WB_SEMANTICA_PYTHON;
const compilerRoot=process.env.WB_SEMANTICA_COMPILER_ROOT;
const executable=process.env.WB_ELECTRON_EXECUTABLE??join(root,'release/desktop/Open-K-Folds Workbench-win32-x64/Open-K-Folds Workbench.exe');
const evidence=process.env.WB_EVIDENCE_DIR??join(tmpdir(),'workbench-research-native-evidence');
const execute=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function productHashes(){
  const directory=join(executable,'..');
  const files=['resources/app/desktop/main.cjs','resources/app/desktop/preload.cjs','resources/app/desktop/semantica.cjs','resources/backend/corpus-workbench.exe','resources/semantica/semantica-handoff.py','resources/ui/index.html'];
  for(const asset of readdirSync(join(directory,'resources/ui/assets')))if(/\.(css|js)$/.test(asset))files.push('resources/ui/assets/'+asset);
  return Object.fromEntries(files.map(file=>[file,sha(readFileSync(join(directory,file)))]));
}

async function launch(profile){
  const env={...process.env,WB_DESKTOP_USER_DATA:profile};
  for(const key of ['ELECTRON_RUN_AS_NODE','WB_DESKTOP_STORE','WB_DESKTOP_PROJECT'])delete env[key];
  const application=await electron.launch({executablePath:executable,args:[],cwd:root,env,timeout:30000});
  const page=await application.firstWindow();
  page.on('dialog',dialog=>void dialog.accept().catch(()=>{}));
  await application.evaluate(({BrowserWindow,dialog})=>{
    BrowserWindow.getAllWindows()[0].setContentSize(1440,1000);
    globalThis.__researchFileDialogs={queue:[],calls:[]};
    // Only native file selection is substituted. The bridge, backend, Python,
    // compiler, graph reader and filesystem operations execute unchanged.
    dialog.showOpenDialog=async(_window,options)=>{
      const qa=globalThis.__researchFileDialogs;qa.calls.push({title:options.title,properties:options.properties});
      const chosen=qa.queue.shift();return chosen?{canceled:false,filePaths:[chosen]}:{canceled:true,filePaths:[]};
    };
  });
  return {application,page};
}
async function queue(application,...files){await application.evaluate((_electron,files)=>{globalThis.__researchFileDialogs.queue.push(...files)},files)}
async function head(page){return page.evaluate(async()=>{const response=await fetch('/api/view');if(!response.ok)throw new Error(await response.text());return response.json()})}
async function handoff(page){return page.evaluate(()=>window.workbenchDesktop.semanticaState())}
async function ready(page){await expect(page.locator('#save-state')).toContainText('Saved R');await expect(page.locator('[data-token="w1"]')).toBeVisible()}
async function openResearch(page){await page.locator('#open-research').click();await expect(page.locator('#research-status')).not.toHaveAttribute('data-state','loading')}
async function decision(page,value,note){
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.locator('#review-form').getByRole('combobox',{name:'Decision',exact:true}).selectOption(value);
  await page.getByLabel('Review rationale',{exact:true}).fill(note);
  const posted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/review'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Record review',exact:true}).click();expect((await posted).ok()).toBe(true);
  await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision',value);
}
async function capture(application,page,name){
  await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await application.evaluate(async({BrowserWindow},file)=>{const image=await BrowserWindow.getAllWindows()[0].webContents.capturePage();process.mainModule.require('node:fs').writeFileSync(file,image.toPNG())},join(evidence,name));
}
async function verifyExport(packagePath){
  const adapter=join(executable,'..','resources','semantica','semantica-handoff.py');
  const {stdout}=await execute(python,['-B',adapter,'--verify-package',packagePath,'--compiler-root',compilerRoot],{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
}
async function expectRunRejected(page,basis){
  const result=await page.evaluate(async basis=>{try{await window.workbenchDesktop.runSemantica(basis);return {accepted:true}}catch(error){return {accepted:false,message:String(error)}}},basis);
  expect(result.accepted).toBe(false);expect(result.message).toMatch(/current|approved|review/i);
}

test('native research handoff compiles authored synthetic evidence and reopens portable exports with actual Semantica',async()=>{
  test.skip(!python||!compilerRoot,'Optional local Semantica runtime: set WB_SEMANTICA_PYTHON and WB_SEMANTICA_COMPILER_ROOT');
  test.setTimeout(15*60*1000);
  for(const file of [python,compilerRoot,executable])expect(existsSync(file),`Required local QA path exists: ${file}`).toBe(true);
  mkdirSync(evidence,{recursive:true});
  const work=join(evidence,`research-${process.pid}-${Date.now()}`);mkdirSync(work);
  const profile=join(work,'isolated-profile');
  const source=createPackage(join(work,'synthetic-source'),'SYNTHETIC authored research evidence');
  mkdirSync(join(source,'Raw'));
  const raw=join(source,'Raw/asr.raw.json');
  writeFileSync(raw,JSON.stringify({text:'SYNTHETIC machine draft',word_times:null,provenance:{engine:'synthetic-fixture',confidence:null}}));
  const sourceXML=join(source,'xmlfiles/interview.xml');
  const uncertainty='SYNTHETIC uncertain hearing; variety unresolved; confidence unknown';
  writeFileSync(sourceXML,readFileSync(sourceXML,'utf8').replace('<tok id="w1"',`<tok note="${uncertainty}" id="w1"`));
  const immutable={transcript:sha(readFileSync(sourceXML)),raw:sha(readFileSync(raw)),audio:sha(readFileSync(join(source,'Audio/preview.wav')))};
  const exportParent=join(work,'exports');mkdirSync(exportParent);
  let application,page;const errors=[],consoleErrors=[];const proofs=[];
  const watch=()=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())})};
  try{
    ({application,page}=await launch(profile));watch();
    expect(page.url()).toBe('workbench://app/');await expect(page).toHaveTitle('Corpus workbench');await expect(page.locator('#desktop-import')).toBeVisible();
    await queue(application,source);await page.locator('#desktop-import').click();await ready(page);
    await expect(page.locator('#audio-play')).toBeEnabled();
    await openResearch(page);await expect(page.locator('#research-run')).toBeDisabled();
    await expect(page.locator('#research-status')).toContainText('Review and approve');
    await expect(page.locator('#research-guide')).toContainText('uncertainty is not a confidence score');
    await capture(application,page,'research-guide-light.png');
    await page.locator('#research-skip-guide').click();await expect(page.locator('#research-guide')).toBeHidden();

    // Cancelling configuration leaves the editor and exact evidence unchanged.
    await page.locator('#research-configure').click();
    await expect.poll(async()=>(await handoff(page)).configured).toBe(false);
    await expect(page.locator('#research-configure')).toBeEnabled();
    await queue(application,python,compilerRoot);await page.locator('#research-configure').click();
    await expect.poll(async()=>(await handoff(page)).configured,{timeout:180000}).toBe(true);
    await expect(page.locator('#research-runtime')).toContainText('Semantica 0.6.8');
    const configured=await handoff(page);expect(JSON.stringify(configured)).not.toContain(python);expect(JSON.stringify(configured)).not.toContain(compilerRoot);
    await decision(page,'approved','SYNTHETIC mechanics only. Ambiguous hearing and unknown confidence remain authored notes.');
    const original=(await head(page)).revision;
    await openResearch(page);await expect(page.locator('#research-run')).toBeEnabled();
    await page.locator('#research-run').click();
    await expect(page.locator('#research-status')).toHaveAttribute('data-state','running');
    await application.evaluate(({Menu})=>{
      const history=Menu.getApplicationMenu().items.flatMap(item=>item.submenu?.items??[]).find(item=>item.label==='Revision history');
      if(!history)throw new Error('Native Revision history menu item is missing');history.click();
    });
    await expect(page.locator('.research-panel')).toBeVisible();
    await expect(page.getByRole('heading',{name:'Per-edit history',exact:true})).toHaveCount(0);
    // Native menu commands cannot replace the locked panel, while the actual
    // recording player remains available during local compiler work.
    await expect(page.locator('#audio-play')).toBeEnabled();await page.locator('#audio-play').click();
    await expect.poll(()=>page.locator('#audio').evaluate(audio=>audio.currentTime)).toBeGreaterThan(.1);
    await page.locator('#audio-play').click();
    await expect(page.locator('#research-status')).toContainText(`Validated graph for R${original.id}`,{timeout:240000});
    const first=await handoff(page);expect(first.current.native_reopen).toBe(true);expect(first.lastAttempt.reused).toBe(false);
    expect(first.current.node_count).toBe(63);expect(first.current.edge_count).toBe(113);
    const firstId=first.current.generation_id;
    await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id',firstId);
    await expect(page.locator('#research-generation')).toContainText('63 nodes');await expect(page.locator('#research-generation')).toContainText('113 edges');
    await expect(page.locator('#research-generation')).toContainText('Reopened by Semantica');
    await capture(application,page,'research-verified-light.png');

    await page.locator('#research-run').click();
    await expect(page.locator('#research-status')).toContainText('existing generation reused',{timeout:240000});
    const reused=await handoff(page);expect(reused.current.generation_id).toBe(firstId);expect(reused.lastAttempt.reused).toBe(true);
    expect((await head(page)).revision).toEqual(original);

    await queue(application,exportParent);await page.locator('#research-export').click();
    await expect(page.locator('#research-export-status')).toContainText('Exported and reopened successfully',{timeout:240000});
    const exportState=await handoff(page);expect(exportState.export.validated).toBe(true);
    const output=join(exportParent,exportState.export.filename);
    expect(readdirSync(output).sort()).toEqual(['README.md','completion.json','contract.json','graph.json','manifest.json']);
    const manifest=JSON.parse(readFileSync(join(output,'manifest.json'),'utf8'));
    expect(manifest.generation_id).toBe(firstId);expect(manifest.review.decision).toBe('approved');expect(manifest.current_at_export).toBe(true);
    const graph=JSON.parse(readFileSync(join(output,'graph.json'),'utf8'));
    const token=graph.nodes.find(node=>node.properties.anchor.kind==='token'&&node.properties.anchor.external_id==='w1');
    expect(token.properties.source.attrs.note).toBe(uncertainty);expect(token.properties.source.normalized).toBeNull();
    expect(manifest.source_artifacts['Raw/asr.raw.json'].sha256).toBe(immutable.raw);expect(manifest.source_artifacts['Audio/preview.wav'].sha256).toBe(immutable.audio);
    proofs.push(await verifyExport(output));expect(proofs[0]).toMatchObject({ok:true,verified:true,native_reopen:true,files_verified:4,generation_id:firstId,node_count:63,edge_count:113});
    await page.getByRole('button',{name:'Dark appearance',exact:true}).click();await capture(application,page,'research-export-dark.png');
    await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,760));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture(application,page,'research-export-compact-dark.png');

    await application.close();application=null;
    expect(existsSync(join(profile,'runtime'))?readdirSync(join(profile,'runtime')):[]).toEqual([]);
    ({application,page}=await launch(profile));watch();await ready(page);await openResearch(page);
    await expect(page.locator('#research-guide')).toBeHidden();await expect(page.locator('#research-generation')).toHaveAttribute('data-generation-id',firstId);
    expect((await handoff(page)).current.native_reopen).toBe(true);
    await expect(page.locator('#research-export-status')).toContainText('Exported and reopened successfully');

    // An edit removes current eligibility; the preserved prior export remains a
    // verifiable snapshot and must not claim to check present authority approval.
    await page.locator('[data-token="w1"]').click();await page.getByRole('button',{name:'Token',exact:true}).click();
    await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC corrected successor');
    await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText(`Saved R${original.id+1}`);
    const successor=(await head(page)).revision;await openResearch(page);
    await expect(page.locator('#research-run')).toBeDisabled();await expect(page.locator('#research-export')).toBeDisabled();
    expect((await handoff(page)).current).toBeUndefined();await expectRunRejected(page,{revision:original.id,snapshot_hash:original.snapshot_hash});
    proofs.push(await verifyExport(output));expect(proofs[1].current_eligibility).toBe('not checked; exported snapshot only');
    await decision(page,'approved','SYNTHETIC successor mechanics reviewed; uncertainty note retained.');
    await openResearch(page);await page.locator('#research-run').click();
    await expect(page.locator('#research-status')).toContainText(`Validated graph for R${successor.id}`,{timeout:240000});
    const second=await handoff(page);expect(second.current.generation_id).not.toBe(firstId);expect(second.current.native_reopen).toBe(true);
    await decision(page,'rejected','SYNTHETIC review retraction; prior graph remains historical.');
    await openResearch(page);await expect(page.locator('#research-run')).toBeDisabled();await expect(page.locator('#research-export')).toBeDisabled();
    expect((await handoff(page)).current).toBeUndefined();await expectRunRejected(page,{revision:successor.id,snapshot_hash:successor.snapshot_hash});
    await capture(application,page,'research-rejected-dark.png');

    expect(sha(readFileSync(sourceXML))).toBe(immutable.transcript);expect(sha(readFileSync(raw))).toBe(immutable.raw);expect(sha(readFileSync(join(source,'Audio/preview.wav')))).toBe(immutable.audio);
    expect(errors).toEqual([]);expect(consoleErrors).toEqual([]);
    const dialogs=await application.evaluate(()=>globalThis.__researchFileDialogs.calls);
    writeFileSync(join(evidence,'research-handoff-native-evidence.json'),JSON.stringify({synthetic_only:true,url:page.url(),baseline:'before-*.png from supplied prior bundle',executable,executable_sha256:sha(readFileSync(executable)),product_files_sha256:productHashes(),viewport_sizes:[[1440,1000],[1100,760]],original_revision:original,successor_revision:successor,first_generation:first,current_successor:second,retry_reused:true,native_history_ignored_while_running:true,playback_during_handoff:true,export_reopened_independently:proofs,relaunch_preserves_runtime_and_generation:true,edit_invalidates_current:true,rejection_invalidates_current:true,uncertainty_note_preserved:true,source_artifacts_unchanged:immutable,only_file_dialogs_mocked:true,dialogs,page_errors:errors,console_errors:consoleErrors},null,2));
  }catch(error){
    if(application&&page&&!page.isClosed()){
      writeFileSync(join(evidence,'research-handoff-native-failure.json'),JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),state:await handoff(page).catch(()=>null),page_errors:errors,console_errors:consoleErrors},null,2));
      await capture(application,page,'research-handoff-native-failure.png');
    }
    throw error;
  }finally{if(application)await application.close();}
});
