import {test,expect} from '@playwright/test';
import {spawn,execFileSync, type ChildProcess} from 'node:child_process';
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('..');const runtime=resolve(root,'.private',`browser-qa-${process.pid}`);
let service:ChildProcess;let code='';let exported='';
test.beforeAll(async()=>{
  if(existsSync(runtime))throw new Error('Use a fresh QA directory; test will not overwrite prior data.');
  mkdirSync(runtime,{recursive:true});
  mkdirSync(resolve(root,'.runtime'),{recursive:true});
  writeFileSync(resolve(root,'.runtime','latest-browser-qa.txt'),runtime);
  execFileSync('python',['-c',`from pathlib import Path; import shutil, math, struct, wave; p=Path(r'${runtime}'); shutil.copytree(Path(r'${root}')/'fixtures'/'synthetic',p/'package'); a=p/'package'/'Audio'; a.mkdir(); w=wave.open(str(a/'synthetic-workbench.wav'),'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b''.join(struct.pack('<h',int(1200*math.sin(2*math.pi*220*i/16000))) for i in range(128000))); w.close()`]);
  const document=resolve(runtime,'package','xmlfiles','SYNTHETIC-WORKBENCH.xml');writeFileSync(document,readFileSync(document,'utf8').replace('<body>',"<body><tok id='w-outside' form='untimed'>untimed</tok>"));
  mkdirSync(resolve(runtime,'package','Other'),{recursive:true});writeFileSync(resolve(runtime,'package','Other','links.psdx'),"<opaque id='parser-1'><ref target='../xmlfiles/SYNTHETIC-WORKBENCH.xml#w-1'/><ref target='#missing'/></opaque>");writeFileSync(resolve(runtime,'package','Other','opaque.bin'),Buffer.from([0,255,17]));
  writeFileSync(resolve(runtime,'package','xmlfiles','ZZ-SECOND-SYNTHETIC.xml'),"<TEI><teiHeader><title>Second synthetic document</title></teiHeader><text><tok id='second-document-token' form='second-document-marker'>second-document-marker</tok></text></TEI>");
  const binary=process.env.WB_BINARY??resolve(root,'target','debug','corpus-workbench'+(process.platform==='win32'?'.exe':''));
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','synthetic']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','synthetic','--ui',process.env.WB_UI??resolve(root,'ui','dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime','session-code'))).toBe(true);
  code=readFileSync(resolve(runtime,'.runtime','session-code'),'utf8');
  await expect.poll(async()=>{try{return (await fetch('http://127.0.0.1:18912/')).status}catch{return 0}}).toBe(200);
});
test.afterAll(()=>service?.kill());
test('complete authoring journey against native revisions',async({page,context})=>{
  const errors:string[]=[];const external:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:18912'))external.push(r.url())});
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R1');
  await expect(page.locator('[data-token="w-outside"]')).toBeVisible();
  await expect(page).toHaveTitle('Corpus workbench');await expect(page.getByRole('heading',{name:'SYNTHETIC workbench authoring fixture'})).toBeVisible();
  await page.locator('[data-token="w-1"]').click();await page.getByRole('button',{name:'Listen to selection',exact:true}).click();
  await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(.2);
  expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.error)).toBeNull();
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.pause();a.currentTime=5});await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(4.9);
  await page.getByLabel('Speed').selectOption('1.25');expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBe(1.25);
  await page.getByRole('button',{name:'Definitions',exact:true}).click();await page.getByLabel('Value',{exact:true}).fill('synthetic-mixed');await page.getByLabel('Description',{exact:true}).fill('Synthetic isiXhosa / isiZulu / slang mechanics');await page.getByRole('button',{name:'Save definition',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R2');
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.getByLabel('Human-corrected reading').fill('authentic 😀');await page.getByLabel('Optional normalized reading').fill('optional standard');await page.getByLabel('Language / variety',{exact:true}).fill('synthetic-mixed');await page.getByLabel('Revision name').fill('Synthetic listening correction');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R3');
  await expect(page.locator('[data-token="w-1"]')).toContainText('authentic 😀');await expect(page.locator('.original')).toContainText('é😀&x');
  await page.reload();await expect(page.locator('[data-token="w-1"]')).toContainText('authentic 😀');await page.locator('[data-token="w-1"]').click();
  await page.locator('[data-token="w-3"]').click({modifiers:['Control']});await page.getByRole('button',{name:'Annotations',exact:true}).click();await page.getByLabel('Span label',{exact:true}).fill('synthetic discontinuous');await page.locator('#span-form [name="variety"]').fill('synthetic-mixed');await page.getByRole('button',{name:'Create span',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R4');await expect(page.locator('.annotation')).toContainText('w-1 → w-3');
  await page.getByLabel('Target token ID').fill('w-3');await page.getByLabel('Relation type',{exact:true}).fill('synthetic-context');await page.getByRole('button',{name:'Create relation',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R5');
  await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('#compare-from').selectOption('2');await page.getByRole('button',{name:'Compare with current',exact:true}).click();await expect(page.locator('#diff')).toContainText('authentic 😀');await expect(page.locator('#diff')).toContainText('Annotations/review_SYNTHETIC-WORKBENCH.xml');
  await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByLabel('Review rationale').fill('Synthetic mechanics only; no real evidence reviewed.');await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  await page.getByRole('button',{name:'Inspect approved export contract',exact:true}).click();await expect(page.locator('#contract-preview')).toContainText('no Semantica dispatch performed');
  await page.getByRole('button',{name:'Export complete package',exact:true}).click();await expect(page.getByRole('link',{name:'Download complete package'})).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download complete package'}).click()]);exported=resolve(runtime,'edited-package.zip');await download.saveAs(exported);expect(readFileSync(exported).subarray(0,2).toString()).toBe('PK');
  await page.screenshot({path:resolve(root,'.runtime','synthetic-authoring-desktop.png'),fullPage:true});
  const second=await context.newPage();await second.goto('/');await expect(second.locator('#save-state')).toContainText('Saved R5');await second.locator('[data-token="w-1"]').click();await second.getByLabel('Human-corrected reading').fill('second tab intention');
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.getByLabel('Human-corrected reading').fill('first tab committed');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R6');await expect(page.locator('#save-state')).toContainText('Unreviewed');
  await second.getByRole('button',{name:'Save token',exact:true}).click();await expect(second.locator('#conflict')).toContainText('Current saved state is R6');await expect(second.getByLabel('Human-corrected reading')).toHaveValue('second tab intention');await second.getByRole('button',{name:'Compare saved revisions',exact:true}).click();await expect(second.locator('#conflict-diff')).toContainText('first tab committed');await second.getByRole('button',{name:'Reapply my change to R6',exact:true}).click();await expect(second.locator('#save-state')).toContainText('Saved R7');
  await second.getByRole('button',{name:'History',exact:true}).click();await second.getByRole('button',{name:'Undo last committed edit',exact:true}).click();await expect(second.locator('#save-state')).toContainText('Saved R8');await expect(second.locator('[data-token="w-1"]')).toContainText('first tab committed');await expect(second.locator('#save-state')).toContainText('Unreviewed');
  await second.getByRole('button',{name:'Redo state R7',exact:true}).click();await expect(second.locator('#save-state')).toContainText('Saved R9');await expect(second.locator('[data-token="w-1"]')).toContainText('second tab intention');await second.locator('#compare-from').selectOption('5');await second.getByRole('button',{name:'Restore selected state',exact:true}).click();await expect(second.locator('#save-state')).toContainText('Saved R10');await expect(second.locator('[data-token="w-1"]')).toContainText('authentic 😀');
  await second.getByRole('button',{name:'XML',exact:true}).click();await expect(second.locator('#xml-preview')).toContainText('retain &apos; exactly');
  await second.getByRole('button',{name:'Token',exact:true}).click();await expect(second.getByLabel('Human-corrected reading')).toHaveValue('authentic 😀');
  await second.setViewportSize({width:390,height:844});await second.screenshot({path:resolve(root,'.runtime','synthetic-authoring-mobile.png'),fullPage:true});expect(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);expect(external).toEqual([]);
  writeFileSync(resolve(runtime,'journey-evidence.json'),JSON.stringify({native_revisions:10,exported_revision:5,audio:true,unicode:true,span:true,relation:true,diff:true,review:true,approval_invalidated:true,stale_conflict:true,reapply:true,undo:true,redo:true,restore:true,desktop:[1440,1000],mobile:[390,844],page_errors:errors,external_requests:external},null,2));
});
test('saved annotations can be repaired, undone, reviewed and exported',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R10');
  const view=async()=>page.evaluate(async()=>{const r=await fetch('/api/view');return r.json()});
  const before=await view();const span=before.documents[0].spans[0];let revision=before.revision.id;
  const saved=async()=>{revision++;await expect(page.locator('#save-state')).toContainText(`Saved R${revision}`)};
  const annotations=async()=>page.getByRole('button',{name:'Annotations',exact:true}).click();
  const edit=async()=>{await annotations();await page.getByRole('button',{name:'Edit span '+span.id,exact:true}).click()};
  await edit();await page.getByLabel('Saved span label').fill('repaired synthetic span');await expect(page.locator('#save-state')).toContainText('Unsaved annotation draft');await page.getByRole('button',{name:'Token',exact:true}).click();await annotations();await expect(page.getByLabel('Saved span label')).toHaveValue('repaired synthetic span');await page.getByRole('button',{name:'Edit span '+span.id,exact:true}).click();await expect(page.getByLabel('Saved span label')).toHaveValue('repaired synthetic span');await page.getByLabel('Span label',{exact:true}).fill('another pending draft');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await expect(page.locator('#message')).toContainText('Save or discard other annotation drafts');expect((await view()).revision.id).toBe(before.revision.id);await expect(page.getByLabel('Saved span label')).toHaveValue('repaired synthetic span');await page.getByRole('button',{name:'Discard annotation drafts',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R10');await edit();await expect(page.getByLabel('Saved span label')).toHaveValue(span.fields.label);await page.getByLabel('Saved span label').fill('repaired synthetic span');await page.getByLabel('Anchor change').selectOption('tokens');await page.getByLabel('Token IDs in order').fill('w-3 w-1');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await saved();
  expect((await view()).documents[0].spans[0].id).toBe(span.id);expect((await view()).documents[0].spans[0].token_ids).toEqual(['w-3','w-1']);
  await page.reload();await edit();await expect(page.getByLabel('Saved span label')).toHaveValue('repaired synthetic span');
  await page.getByLabel('Saved span label').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(root,'.runtime','synthetic-span-editor-desktop.png')});await page.setViewportSize({width:390,height:844});await page.getByLabel('Saved span label').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(root,'.runtime','synthetic-span-editor-mobile.png')});await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'History',exact:true}).click();await page.locator('#compare-from').selectOption(String(before.revision.id));await page.getByRole('button',{name:'Compare with current',exact:true}).click();await expect(page.locator('#diff')).toContainText('repaired synthetic span');
  const changed=revision;await page.getByRole('button',{name:'Undo last committed edit',exact:true}).click();await saved();expect((await view()).documents[0].spans[0]).toEqual(span);
  await page.locator('#compare-from').selectOption(String(changed));await page.getByRole('button',{name:'Restore selected state',exact:true}).click();await saved();await expect(page.locator('#save-state')).toContainText('Unreviewed');
  await edit();await page.getByLabel('Anchor change').selectOption('character');await page.getByLabel('Token IDs in order').fill('w-1');await page.getByLabel('Saved start code point').fill('0');await page.getByLabel('Saved end code point').fill('1');await page.getByLabel('Saved exact quote').fill('a');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await saved();
  const review=async()=>{await page.getByRole('button',{name:'Review',exact:true}).click();await page.getByLabel('Review rationale').fill('Synthetic repair mechanics only');await page.getByRole('button',{name:'Record review',exact:true}).click()};
  await review();await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.locator('[data-token="w-1"]').click();await page.getByLabel('Human-corrected reading').fill('bhuman synthetic');await page.getByLabel('Optional normalized reading').fill('new optional');await page.getByRole('button',{name:'Save token',exact:true}).click();await saved();
  await edit();await page.getByLabel('Saved span note').fill('Label edits do not resolve coordinates');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await saved();expect((await view()).documents[0].spans[0].fields.wb_status).toBe('unresolved');
  await review();await expect(page.locator('#message')).toContainText('unresolved issues block approval');expect((await view()).approved).toBe(false);
  await edit();await page.getByLabel('Anchor change').selectOption('character');await page.getByLabel('Saved exact quote').fill('b');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await saved();await review();await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  await annotations();await page.getByRole('button',{name:'Edit relation from w-1',exact:true}).click();await page.getByLabel('Saved relation target').fill('#w-2');await page.getByLabel('Saved relation type').fill('repaired-context');await page.getByLabel('Saved relation note').fill('retain after clear');await page.getByRole('button',{name:'Save relation changes',exact:true}).click();await saved();
  expect((await view()).documents[0].tokens.find((t:{id:string})=>t.id==='w-1').attrs.relation_target).toBe('#w-2');
  await page.getByRole('button',{name:'Clear relation from w-1',exact:true}).click();await saved();expect((await view()).documents[0].tokens.find((t:{id:string})=>t.id==='w-1').attrs.relation_target).toBeUndefined();
  await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Undo last committed edit',exact:true}).click();await saved();expect((await view()).documents[0].tokens.find((t:{id:string})=>t.id==='w-1').attrs.relation_target).toBe('#w-2');
  await page.getByRole('button',{name:`Redo state R${revision-1}`,exact:true}).click();await saved();
  await review();await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  await page.getByRole('button',{name:'Export complete package',exact:true}).click();const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download complete package'}).click()]);const zip=resolve(runtime,'annotation-repair.zip');await download.saveAs(zip);
  const out=resolve(runtime,'annotation-reopened-package');execFileSync('python',['-c',`import zipfile;zipfile.ZipFile(r'${zip}').extractall(r'${out}')`]);
  const binary=process.env.WB_BINARY??resolve(root,'target','debug','corpus-workbench'+(process.platform==='win32'?'.exe':''));const reopened=resolve(runtime,'annotation-reopened-authority');execFileSync(binary,['import','--store',reopened,'--package',out,'--project','synthetic']);
  const result=JSON.parse(execFileSync(binary,['view','--store',reopened,'--project','synthetic'],{encoding:'utf8'}));expect(result.documents[0].spans[0].fields.wb_quote).toBe('b');expect(result.documents[0].spans[0].id).toBe(span.id);const token=result.documents[0].tokens.find((t:{id:string})=>t.id==='w-1');expect(token.attrs.relation_target).toBeUndefined();expect(token.attrs.note).toBe('retain after clear');expect(token.original).toBe(before.documents[0].tokens.find((t:{id:string})=>t.id==='w-1').original);expect(result.approved).toBe(false);
  for(const [path,a] of Object.entries(before.snapshot.files) as [string,{role:string;sha256:string}][])if(a.role==='media'||a.role==='raw-asr')expect(result.snapshot.files[path].sha256).toBe(a.sha256);
  expect(errors).toEqual([]);await page.screenshot({path:resolve(root,'.runtime','synthetic-annotation-repair.png'),fullPage:true});
  writeFileSync(resolve(runtime,'annotation-evidence.json'),JSON.stringify({synthetic_only:true,start_revision:before.revision.id,end_revision:revision,stable_span_id:true,ordered_anchors:true,unresolved_repair:true,relation_edit_clear:true,exact_undo_redo:true,review:true,complete_export_reimport:true,page_errors:errors},null,2));
});

test('stale annotation draft remains explicit and can be reapplied',async({page,context})=>{
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R21');
  const second=await context.newPage();await second.goto('/');await expect(second.locator('#save-state')).toContainText('Saved R21');const failed=await context.newPage();await failed.goto('/');await expect(failed.locator('#save-state')).toContainText('Saved R21');
  for(const p of [page,second,failed]){await p.getByRole('button',{name:'Annotations',exact:true}).click();await p.getByRole('button',{name:/^Edit span /}).click()}
  await failed.getByLabel('Saved span note').fill('keep failed reapply draft');await failed.getByLabel('Saved span language / variety').fill('undefined-value');await second.getByLabel('Saved span note').fill('second tab explicit draft');await page.getByLabel('Saved span label').fill('first tab annotation commit');await page.getByRole('button',{name:'Save span changes',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R22');
  await second.getByRole('button',{name:'Save span changes',exact:true}).click();await expect(second.locator('#conflict')).toContainText('Current saved state is R22');await expect(second.getByLabel('Saved span note')).toHaveValue('second tab explicit draft');
  await second.getByRole('button',{name:'Compare saved revisions',exact:true}).click();await expect(second.locator('#conflict-diff')).toContainText('first tab annotation commit');await second.getByRole('button',{name:'Reapply my change to R22',exact:true}).click();await expect(second.locator('#save-state')).toContainText('Saved R23');await expect(second.locator('#save-state')).toContainText('Unreviewed');
  await second.getByRole('button',{name:/^Edit span /}).click();await expect(second.getByLabel('Saved span label')).toHaveValue('first tab annotation commit');await expect(second.getByLabel('Saved span note')).toHaveValue('second tab explicit draft');
  await failed.getByRole('button',{name:'Save span changes',exact:true}).click();await expect(failed.locator('#conflict')).toContainText('Current saved state is R23');await failed.getByRole('button',{name:'Reapply my change to R23',exact:true}).click();await expect(failed.locator('#message')).toContainText('define span language first');
  await failed.getByRole('button',{name:'Token',exact:true}).click();await failed.getByRole('button',{name:'Annotations',exact:true}).click();await failed.getByRole('button',{name:/^Edit span /}).click();await expect(failed.getByLabel('Saved span note')).toHaveValue('keep failed reapply draft');await expect(failed.getByLabel('Saved span language / variety')).toHaveValue('undefined-value');
  expect(await failed.evaluate(async()=>{const r=await fetch('/api/view');return (await r.json()).revision.id})).toBe(23);await failed.getByRole('button',{name:'Discard annotation drafts',exact:true}).click();
});

test('HTTP boundary rejects unauthenticated reads and forged commands',async({request})=>{
  expect((await request.get('/api/view')).status()).toBe(403);expect((await request.get('/api/inventory')).status()).toBe(403);expect((await request.post('/api/preflight',{data:{}})).status()).toBe(403);expect((await request.get('/api/media?path=Audio%2Fsynthetic-workbench.wav')).status()).toBe(403);
  await request.post('/api/session',{data:{code},headers:{Origin:'http://127.0.0.1:18912'}});
  expect((await request.post('/api/command',{data:{}})).status()).toBe(403);
  const view=await (await request.get('/api/view')).json();
  const command={schema:1,project:'other',command_id:'forged',base_revision:view.revision.id,preimage_hash:view.revision.snapshot_hash,config_version:view.snapshot.config.version,label:'forged',operations:[{kind:'restore',revision:1}]};
  expect((await request.post('/api/command',{data:command,headers:{Origin:'http://127.0.0.1:18912','X-WB-CSRF':code}})).status()).toBe(403);
  expect((await request.get('/api/media?path=..%2Fledger.sqlite')).status()).toBe(422);
  expect((await request.get('/api/media?path=Resources%2Fsettings.xml')).status()).toBe(403);
  const range=await request.get('/api/media?path=Audio%2Fsynthetic-workbench.wav',{headers:{Range:'bytes=10-20'}});expect(range.status()).toBe(206);expect((await range.body()).length).toBe(11);
  const foreign='export-other-project';writeFileSync(resolve(runtime,'.runtime','exports',foreign+'.zip'),readFileSync(exported));
  expect((await request.get('/api/download?id='+foreign)).status()).toBe(403);
});

test('failed duplicate service launch preserves working session capability',async({request})=>{
  const launcher=resolve(runtime,'.runtime','Open-Workbench.html');const original=readFileSync(launcher,'utf8');
  const binary=process.env.WB_BINARY??resolve(root,'target','debug','corpus-workbench'+(process.platform==='win32'?'.exe':''));
  expect(()=>execFileSync(binary,['serve','--store',resolve(runtime,'authority'),'--project','synthetic','--ui',process.env.WB_UI??resolve(root,'ui','dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'})).toThrow();
  expect(readFileSync(resolve(runtime,'.runtime','session-code'),'utf8')).toBe(code);expect(readFileSync(launcher,'utf8')).toBe(original);
  expect((await request.post('/api/session',{data:{code},headers:{Origin:'http://127.0.0.1:18912'}})).status()).toBe(200);
});

test('reference inventory and structural prerequisites remain revision bound and read only',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R23');
  const before=await page.evaluate(async()=> (await fetch('/api/view')).json());
  const original=await page.evaluate(async()=> (await fetch('/api/inventory?revision=23')).json());
  await page.locator('[data-token="w-1"]').click();await page.getByRole('button',{name:'References',exact:true}).click();await expect(page.getByRole('heading',{name:'Package reference inventory · R23'})).toBeVisible();
  await page.getByLabel('Artifact filter').selectOption('Other/links.psdx');await expect(page.locator('#reference-list')).toContainText('resolved');await expect(page.locator('#reference-list')).toContainText('unresolved');
  await page.getByLabel('Resolution filter').selectOption('unresolved');await expect(page.locator('#reference-count')).toContainText('1 matching carriers');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download inventory evidence',exact:true}).click()]);const file=resolve(runtime,'reference-inventory.json');await download.saveAs(file);expect(JSON.parse(readFileSync(file,'utf8'))).toEqual(original);
  await page.getByRole('button',{name:'Check prerequisites',exact:true}).click();await expect(page.locator('#preflight-status')).toContainText('blocked');await expect(page.locator('#preflight-evidence')).toContainText('"execution_enabled": false');await expect(page.locator('#preflight-evidence')).toContainText('Other/opaque.bin');
  expect((await page.evaluate(async()=> (await fetch('/api/view')).json())).revision).toEqual(before.revision);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(root,'.runtime','reference-inventory-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  const status=await page.evaluate(async({csrf,prior})=>{
    const v=await (await fetch('/api/view')).json();const target=prior.inventory.ids.find((id:{artifact:string;id:string})=>id.artifact==='xmlfiles/SYNTHETIC-WORKBENCH.xml'&&id.id==='w-1');
    const request={schema:1,project:'synthetic',revision:v.revision.id,snapshot_hash:prior.inventory.snapshot_hash,config_hash:prior.inventory.config_hash,inventory_hash:prior.inventory_hash,operation:'retokenize',targets:[target]};
    const post=(path:string,data:unknown)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-WB-CSRF':csrf},body:JSON.stringify(data)});
    const cross=await post('/api/preflight',{...request,project:'outside'});
    const cmd={schema:1,project:'synthetic',command_id:'inventory-currentness',base_revision:v.revision.id,preimage_hash:v.revision.snapshot_hash,config_version:v.snapshot.config.version,label:'Synthetic inventory currentness',operations:[{kind:'define_language',value:'synthetic-inventory',description:'Synthetic only'}]};
    const changed=await post('/api/command',cmd);if(!changed.ok)throw new Error(await changed.text());
    const stale=await post('/api/preflight',request);return {cross:cross.status,stale:stale.status};
  },{csrf:code,prior:original});expect(status).toEqual({cross:403,stale:409});
  await page.getByRole('button',{name:'Check prerequisites',exact:true}).click();await expect(page.locator('#preflight-status')).toContainText('stale');expect(await page.evaluate(async()=> (await fetch('/api/inventory?revision=23')).json())).toEqual(original);
  await page.reload();await expect(page.locator('#save-state')).toContainText('Saved R24');await page.getByRole('button',{name:'References',exact:true}).click();await expect(page.getByRole('heading',{name:'Package reference inventory · R24'})).toBeVisible();expect(errors).toEqual([]);
  writeFileSync(resolve(runtime,'reference-inventory-evidence.json'),JSON.stringify({revision:23,after:24,full_inventory_download:true,opaque_coverage:true,read_only_preflight:true,qualified_scope:true,cross_project_denied:true,stale_rejected:true,historical_digest_unchanged:true,mobile:true,page_errors:errors},null,2));
});

test('newer reference selection wins when older inventory response arrives late',async({page})=>{
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R24');
  let release!:()=>void;let delivered!:()=>void;const hold=new Promise<void>(r=>release=r);const firstDelivered=new Promise<void>(r=>delivered=r);let requests=0;
  await page.route('**/api/inventory?revision=*',async route=>{const sequence=++requests;const response=await route.fetch();if(sequence===1)await hold;await route.fulfill({response});if(sequence===1)delivered();});
  await page.locator('[data-token="w-1"]').click();await page.getByRole('button',{name:'References',exact:true}).click();await expect.poll(()=>requests).toBe(1);await page.locator('[data-token="w-2"]').click();await expect.poll(()=>requests).toBe(2);await expect(page.locator('#preflight-form')).toHaveCount(1);const resumed=page.waitForResponse(r=>r.url().includes('/api/inventory?revision='));release();await firstDelivered;await (await resumed).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.locator('#preflight-form')).toHaveCount(1);await expect(page.locator('#preflight-form [name="target"] option:checked')).toContainText('w-2');await page.unroute('**/api/inventory?revision=*');
});

test('late reference response cannot replace another document XML inspector',async({page})=>{
  await page.goto('/#session='+code);await expect(page.locator('#save-state')).toContainText('Saved R24');
  let release!:()=>void;const held=new Promise<void>(r=>release=r);let deliveries=0;let requests=0;
  await page.route('**/api/inventory?revision=*',async route=>{requests++;const response=await route.fetch();await held;await route.fulfill({response});deliveries++;});
  await page.getByRole('button',{name:'References',exact:true}).click();await expect.poll(()=>requests).toBe(1);
  await page.getByRole('button',{name:'XML',exact:true}).click();await expect(page.locator('#xml-preview')).toContainText('SYNTHETIC workbench authoring fixture');await page.locator('[data-document="xmlfiles/ZZ-SECOND-SYNTHETIC.xml"]').click();await expect(page.locator('#xml-preview')).toContainText('second-document-marker');
  const remaining=page.waitForResponse(r=>r.url().includes('/api/inventory?revision='));release();await (await remaining).finished();await expect.poll(()=>deliveries).toBe(1);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.locator('#xml-preview')).toContainText('second-document-marker');expect(await page.locator('#xml-preview').textContent()).not.toContain('SYNTHETIC workbench authoring fixture');await page.unroute('**/api/inventory?revision=*');
});
