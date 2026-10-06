import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('..'),runtime=resolve(root,'.private',`editor-${process.pid}`);let service:ChildProcess;let code='';
const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
test.beforeAll(async()=>{
  if(existsSync(runtime))throw new Error('Fresh synthetic authority required');
  for(const dir of ['Resources','xmlfiles','Audio'])mkdirSync(resolve(runtime,'package',dir),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(runtime,'package/xmlfiles/editor.xml'),"<TEI><teiHeader><title>SYNTHETIC correction workspace</title><media url='tone.wav'/></teiHeader><text><body><u id='u1' start='0' end='4'><tok id='w1'>We</tok> <tok id='w2'>their</tok>,  <tok id='w3'>yesterday</tok>.</u>\n<u id='u2' start='2' end='8'><tok id='w4'>😀é👩‍💻مرحبا</tok><tok id='w5'>adjacent</tok><unknown>!</unknown></u></body></text></TEI>");
  writeFileSync(resolve(runtime,'package/xmlfiles/second.xml'),"<TEI><teiHeader><title>SYNTHETIC second document</title></teiHeader><text><tok id='second'>Other</tok></text></TEI>");
  execFileSync('python',['-c',`import wave,math,struct;w=wave.open(r'${resolve(runtime,'package/Audio/tone.wav')}','wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b''.join(struct.pack('<h',int(1200*math.sin(2*math.pi*220*i/16000))) for i in range(128000)));w.close()`]);
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','editor']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','editor','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(r=>service.once('exit',()=>r()))}});
async function open(page:Page){await page.goto('/#session='+code);await expect(page.locator('[data-token="w2"]')).toBeVisible()}
async function select(page:Page,id:string,start=0,end?:number,backward=false){await page.locator('#tokens').focus();await page.evaluate(({id,start,end,backward})=>{const node=document.querySelector(`[data-token="${id}"] .reading-text`)!.firstChild!;const selection=window.getSelection()!;selection.setBaseAndExtent(node,backward?(end??node.textContent!.length):start,node,backward?start:(end??node.textContent!.length));}, {id,start,end,backward});await expect(page.locator('.selection-tools')).toBeVisible()}
async function head(page:Page){return page.evaluate(async()=>await(await fetch('/api/view')).json())}
async function change(page:Page,token:string,value:string){return page.evaluate(async({token,value})=>{const v=await(await fetch('/api/view')).json();const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},body:JSON.stringify({schema:1,project:v.snapshot.project,command_id:"cmd_"+crypto.randomUUID(),base_revision:v.revision.id,preimage_hash:v.revision.snapshot_hash,config_version:v.snapshot.config.version,label:'Synthetic competing edit',operations:[{kind:'set_token',document:'xmlfiles/editor.xml',token,fields:{nform:value}}]})});if(!response.ok)throw new Error(await response.text());return response.json()},{token,value})}

test('faithful separators, actual source anchors, layouts and native backward selection',async({page})=>{
  await open(page);expect(await page.locator('#tokens .reading-text').allTextContents()).toEqual(['We',' ','their',',  ','yesterday','.','\n','😀é👩‍💻مرحبا','adjacent','!']);
  await select(page,'w2',0,5,true);await expect(page.locator('.selection-tools')).toContainText('1 token · corrected');
  await page.getByLabel('Layout',{exact:true}).selectOption('lines');await expect(page.locator('#tokens')).toHaveAttribute('data-layout','lines');
  await page.getByLabel('Go to source').fill('u2');await page.getByRole('button',{name:'Go',exact:true}).click();await expect(page.locator('[data-location="u2"]')).toBeFocused();
  await page.getByLabel('Layout',{exact:true}).selectOption('paragraphs');await expect(page.locator('#tokens')).toHaveAttribute('data-layout','paragraphs');
  const before=(await head(page)).revision.id;await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('there');await page.getByRole('button',{name:'Undo draft',exact:true}).click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);expect((await head(page)).revision.id).toBe(before);
});
test('partial Unicode correction, ghost exclusion, real commit and immutable raw source',async({page})=>{
  await open(page);const before=await head(page);await select(page,'w4',0,2);await page.keyboard.press('Backspace');await expect(page.locator('.draft-ghost')).toHaveText('😀');await page.getByLabel('Proposed correction').fill('😎');
  await page.keyboard.press('Enter');await expect(page.getByLabel('Proposed correction')).toHaveCount(0);const after=await head(page);expect(after.revision.id).toBe(before.revision.id+1);const token=after.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens.find((t:any)=>t.id==='w4');expect(token.original).toBe('😀é👩‍💻مرحبا');expect(token.corrected).toBe('😎é👩‍💻مرحبا');expect(after.approved).toBe(false);await expect(page.locator('[data-token="w4"]')).toHaveClass(/recorded-correction/);
  await page.locator('[data-token="w4"]').hover();await expect(page.locator('.change-popover')).toContainText('Immutable source');
});
test('IME candidate Enter never commits and unsupported many-word proposals remain drafts',async({page})=>{
  await open(page);const before=(await head(page)).revision.id;await select(page,'w2');await page.keyboard.press('Backspace');const input=page.getByLabel('Proposed correction');await input.fill('over there now');await expect(page.locator('#accept-draft')).toBeDisabled();await expect(page.locator('#draft-explanation')).toContainText('mapping');
  await input.fill('there');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});await input.dispatchEvent('compositionend');expect((await head(page)).revision.id).toBe(before);await expect(page.locator('#accept-draft')).toBeEnabled();await input.press('Escape');await expect(input).toHaveValue('there');await input.blur();await expect(page.locator('#save-state')).toContainText('Draft');await page.locator('#undo-draft').click();
});
test('saved response loss retries exact command once and blocks dependent operations',async({page})=>{
  await open(page);const before=(await head(page)).revision.id;let firstBody='';let retries=0;await page.route('**/api/command',async route=>{retries++;const body=route.request().postData()!;if(retries===1){firstBody=body;await route.fetch();await route.abort('failed')}else{expect(body).toBe(firstBody);await route.continue()}});
  await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('there');await page.locator('#accept-draft').click();await expect(page.locator('#save-state')).toContainText('Save outcome unknown');await expect(page.getByLabel('Proposed correction')).toBeDisabled();expect((await head(page)).revision.id).toBe(before+1);
  await expect(page.getByRole('button',{name:'Review',exact:true})).toBeDisabled();
  await page.locator('#retry-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);expect((await head(page)).revision.id).toBe(before+1);expect(retries).toBe(2);
});
test('stale draft requires comparison and invalidates reapply after proposal editing',async({page})=>{
  await open(page);await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('theirs');await change(page,'w1','They');await page.locator('#accept-draft').click();await expect(page.locator('#draft-explanation')).toContainText('head changed');await page.locator('#compare-draft').click();await expect(page.locator('#reapply-draft')).toBeVisible();await page.getByLabel('Proposed correction').fill('where');await expect(page.locator('#reapply-draft')).toBeHidden();await page.locator('#compare-draft').click();await page.locator('#reapply-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);await expect(page.locator('[data-token="w1"]')).toHaveText('They');
});
test('recording resize, pane focus, themes, tabs and citation guards preserve real state',async({page})=>{
  await open(page);await expect(page.locator('#recording-summary')).toContainText('original recording');await page.locator('[data-token="w2"]').click();await page.getByRole('button',{name:'Listen to selection',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(.05);await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.pause());const time=await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime);
  await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','expanded');await expect(page.locator('#recording-layers')).toContainText('No complete word times');await page.keyboard.press('Home');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','minimal');expect(await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(time,1);
  await page.getByRole('button',{name:'Toggle light or dark appearance'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const colors=await page.locator('#navigation-query').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,label:getComputedStyle(e.closest('label')!).color}));expect(colors.fg).toBe('rgb(231, 231, 231)');expect(colors.bg).toBe('rgb(24, 24, 24)');expect(colors.label).toBe('rgb(179, 179, 179)');
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading').fill('noticeLayout');await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#message')).toContainText('Saved R');
  expect(await page.locator('#recording-pane').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1)).toBe(true);expect(await page.locator("audio").evaluate(a=>a.getBoundingClientRect().bottom<=innerHeight+1)).toBe(true);
  await page.locator('[data-document="xmlfiles/second.xml"]').click();await expect(page.getByRole('tab')).toHaveCount(2);await page.getByRole('tab',{name:'SYNTHETIC correction workspace'}).click();await expect(page.locator('[data-token="w2"]')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.locator('#toggle-properties').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('delayed document projection cannot edit stale text or expose previous audio',async({page})=>{
  await open(page);const before=(await head(page)).revision.id;let release!:()=>void;const hold=new Promise<void>(r=>release=r);let waiting=false;
  await page.route('**/api/reading?*',async route=>{if(route.request().url().includes('second.xml')){const response=await route.fetch();waiting=true;await hold;await route.fulfill({response})}else await route.continue()});
  await page.locator('[data-document="xmlfiles/second.xml"]').click();await expect.poll(()=>waiting).toBe(true);await expect(page.locator('#tokens')).toHaveAttribute('inert','');await expect(page.locator('#tokens [data-token]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Listen to selection',exact:true})).toBeDisabled();await page.keyboard.press('Backspace');expect((await head(page)).revision.id).toBe(before);release();await expect(page.locator('#tokens')).not.toHaveAttribute('inert','');await expect(page.locator('#tokens')).toContainText('Other');
});
test('late optional history failure preserves active draft and Undo',async({page})=>{
  let release!:()=>void;const hold=new Promise<void>(r=>release=r);let waiting=false;await page.route('**/api/diff?*',async route=>{waiting=true;await hold;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic delayed history failure'})})});
  await open(page);await expect.poll(()=>waiting).toBe(true);await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('historysafe');release();await expect(page.locator('#message')).toContainText('history decoration');await expect(page.getByLabel('Proposed correction')).toHaveValue('historysafe');await page.locator('#undo-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);
});
test('delayed conflict comparison cannot authorize an edited proposal',async({page})=>{
  await open(page);await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('proposal');await change(page,'w3','competing');await page.locator('#accept-draft').click();await expect(page.locator('#draft-explanation')).toContainText('head changed');
  let release!:()=>void;const hold=new Promise<void>(r=>release=r);let waiting=false;await page.route('**/api/diff?*',async route=>{const response=await route.fetch();waiting=true;await hold;await route.fulfill({response})});await page.locator('#compare-draft').click();await expect.poll(()=>waiting).toBe(true);await page.getByLabel('Proposed correction').fill('changed');release();await expect(page.locator('#reapply-draft')).toBeHidden();await page.locator('#undo-draft').click();
});
test('committed save with failed view refresh resolves the same command',async({page})=>{
  await open(page);const before=(await head(page)).revision.id;await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('refreshsafe');let first=true;await page.route('**/api/view',async route=>{if(first){first=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic view refresh failure'})})}else await route.continue()});
  await page.locator('#accept-draft').click();await expect(page.locator('#message')).toContainText('view refresh pending');await expect(page.getByLabel('Proposed correction')).toHaveValue('refreshsafe');await page.locator('#retry-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);expect((await head(page)).revision.id).toBe(before+1);
});
test('properties save response loss retains exact command and locks dependent edits',async({page})=>{
  await open(page);await page.locator('[data-token="w2"]').click();await page.getByRole('button',{name:'Token',exact:true}).click();const before=(await head(page)).revision.id;await page.getByLabel('Human-corrected reading').fill('formretry');let body='';let attempts=0;await page.route('**/api/command',async route=>{attempts++;if(attempts===1){body=route.request().postData()!;await route.fetch();await route.abort('failed')}else{expect(route.request().postData()).toBe(body);await route.continue()}});
  await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Save outcome unknown');await expect(page.getByLabel('Human-corrected reading')).toBeDisabled();await page.getByRole('button',{name:'Resolve original save',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R');expect((await head(page)).revision.id).toBe(before+1);expect(attempts).toBe(2);
});
test('correction history marker retains its actual revision after unrelated edits and reload',async({page})=>{
  await open(page);await expect(page.locator('[data-token="w4"]')).toHaveClass(/recorded-correction/);const label=await page.locator('[data-token="w4"]').getAttribute('aria-label');await change(page,'w3','historyunrelated');await page.reload();await expect(page.locator('[data-token="w4"]')).toHaveClass(/recorded-correction/);expect(await page.locator('[data-token="w4"]').getAttribute('aria-label')).toBe(label);await page.locator('[data-token="w4"]').focus();await expect(page.locator('.change-popover')).toContainText('Recorded correction · R2');
});
test('logical copy excludes interlinear metadata and deletion ghost and includes draft once',async({page})=>{
  await open(page);await page.getByLabel('Interlinear',{exact:true}).check();await expect(page.locator('#tokens')).toHaveAttribute('data-interlinear','true');await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('copyonce');
  const text=await page.evaluate(()=>{const span=document.querySelector('[data-token="w2"]')!,range=document.createRange();range.selectNode(span);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);const data=new DataTransfer();document.querySelector('#tokens')!.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')});expect(text).toBe('copyonce');await page.locator('#undo-draft').click();
});
test('lost restore stays recoverable after a late decoration error and blocks new review or draft',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(r=>release=r);let waiting=false;await page.route('**/api/diff?*',async route=>{waiting=true;await held;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic history failure during pending restore'})})});
  await open(page);await expect.poll(()=>waiting).toBe(true);const before=(await head(page)).revision.id;let body='';let attempts=0;await page.route('**/api/command',async route=>{attempts++;if(attempts===1){body=route.request().postData()!;await route.fetch();await route.abort('failed')}else{expect(route.request().postData()).toBe(body);await route.continue()}});
  await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Undo last committed edit',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Save outcome unknown');release();await expect(page.locator('#message')).toContainText('history decoration');await expect(page.getByRole('button',{name:'Resolve original save'})).toBeVisible();await page.keyboard.press('Alt+5');await expect(page.locator('#review-form')).toHaveCount(0);await page.locator('#tokens').focus();await page.keyboard.press('Backspace');await expect(page.getByLabel('Proposed correction')).toHaveCount(0);await page.getByRole('button',{name:'Resolve original save'}).click();await expect(page.locator('#save-state')).toContainText('Saved R');expect((await head(page)).revision.id).toBe(before+1);expect(attempts).toBe(2);
});
test('partial selection prefills a real corrected-layer Unicode annotation anchor',async({page})=>{
  await open(page);const before=(await head(page)).revision.id;await select(page,'w4',2,4);await page.getByRole('button',{name:'Annotate',exact:true}).click();await expect(page.locator('#span-form [name="start"]')).toHaveValue('1');await expect(page.locator('#span-form [name="end"]')).toHaveValue('3');await expect(page.locator('#span-form [name="quote"]')).toHaveValue('é');await page.getByLabel('Span label',{exact:true}).fill('Synthetic selected grapheme');await page.getByRole('button',{name:'Create span',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R'+(before+1));const view=await head(page);const span=view.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').spans.find((s:any)=>s.fields.label==='Synthetic selected grapheme');expect(span.token_ids).toEqual(['w4']);expect(span.fields.wb_quote).toBe('é');
});
test('correction keeps the unchanged recording source and active playhead',async({page})=>{
  await open(page);const audio=page.locator('audio');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.readyState)).toBeGreaterThanOrEqual(1);await audio.evaluate(async(a:HTMLAudioElement)=>{a.currentTime=2;a.playbackRate=1.25;await a.play()});const source=await audio.getAttribute('src');await select(page,'w2');await page.keyboard.press('Backspace');await page.getByLabel('Proposed correction').fill('playbacksafe');await page.locator('#accept-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);expect(await audio.getAttribute('src')).toBe(source);expect(await audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(2);expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);expect(await audio.evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBe(1.25);await audio.evaluate((a:HTMLAudioElement)=>a.pause());
});

test('mobile projects and tools open on the first click and report the visible focused pane',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  const tools=page.locator('#toggle-properties'),projects=page.locator('#toggle-navigation');
  await expect(tools).toHaveAttribute('aria-expanded','false');await expect(projects).toHaveAttribute('aria-expanded','false');
  await tools.click();await expect(page.locator('#properties-pane')).toBeVisible();await expect(tools).toHaveAttribute('aria-expanded','true');
  await projects.click();await expect(page.locator('#projects-pane')).toBeVisible();await expect(page.locator('#properties-pane')).toBeHidden();await expect(tools).toHaveAttribute('aria-expanded','false');
  await projects.click();await expect(page.locator('#projects-pane')).toBeHidden();await expect(page.locator('#tokens')).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await expect(projects).toHaveAttribute('aria-expanded','true');await expect(tools).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('deselecting either endpoint corrects only the remaining complete token',async({page})=>{
  await open(page);const before=await head(page),tokens=before.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens;
  await page.locator('[data-token="w1"]').click();await page.locator('[data-token="w2"]').click({modifiers:['Control']});
  await expect(page.getByRole('button',{name:'Correct',exact:true})).toBeDisabled();
  await page.locator('[data-token="w1"]').click({modifiers:['Control']});await page.getByRole('button',{name:'Correct',exact:true}).click();
  await expect(page.locator('.draft-ghost')).toHaveText(tokens.find((t:any)=>t.id==='w2').corrected??tokens.find((t:any)=>t.id==='w2').original);
  await page.getByLabel('Proposed correction').fill('remainingSecond');await page.locator('#accept-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);
  let after=await head(page);expect(after.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens.find((t:any)=>t.id==='w2').corrected).toBe('remainingSecond');
  await page.locator('[data-token="w1"]').click();await page.locator('[data-token="w2"]').click({modifiers:['Control']});await page.locator('[data-token="w2"]').click({modifiers:['Control']});
  await page.getByRole('button',{name:'Correct',exact:true}).click();await expect(page.locator('.draft-ghost')).toHaveText(tokens.find((t:any)=>t.id==='w1').corrected??tokens.find((t:any)=>t.id==='w1').original);
  await page.getByLabel('Proposed correction').fill('remainingFirst');await page.locator('#accept-draft').click();await expect(page.getByLabel('Proposed correction')).toHaveCount(0);
  after=await head(page);expect(after.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens.find((t:any)=>t.id==='w1').corrected).toBe('remainingFirst');expect(after.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens.find((t:any)=>t.id==='w2').corrected).toBe('remainingSecond');expect(after.revision.id).toBe(before.revision.id+2);
});

test('late next-match projection cannot create new authoring controls during a held properties save',async({page})=>{
  await open(page);await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading').fill('heldSafe');
  let releaseReading!:()=>void,releaseSave!:()=>void;const readingHeld=new Promise<void>(r=>releaseReading=r),saveHeld=new Promise<void>(r=>releaseSave=r);let readingWaiting=false,saveWaiting=false;
  await page.route('**/api/reading?*',async route=>{const response=await route.fetch();readingWaiting=true;await readingHeld;await route.fulfill({response})});
  await page.keyboard.press('F3');await expect.poll(()=>readingWaiting).toBe(true);
  await page.route('**/api/command',async route=>{const response=await route.fetch();saveWaiting=true;await saveHeld;await route.fulfill({response})});
  await page.getByRole('button',{name:'Save token',exact:true}).click();await expect.poll(()=>saveWaiting).toBe(true);
  const received=page.waitForResponse(r=>r.url().includes('/api/reading?'));releaseReading();await (await received).finished();await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  await expect(page.getByLabel('Human-corrected reading')).toHaveValue('heldSafe');await expect(page.getByLabel('Human-corrected reading')).toBeDisabled();
  await page.locator('[data-token="w4"]').hover();await expect(page.locator('.change-popover')).toBeHidden();
  await page.unroute('**/api/reading?*');releaseSave();await expect(page.locator('#save-state')).toContainText('Saved R');const after=await head(page);expect(after.documents.find((d:any)=>d.path==='xmlfiles/editor.xml').tokens.find((t:any)=>t.id==='w2').corrected).toBe('heldSafe');
});
