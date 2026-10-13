import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve('..');
const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
const customLanguage='  Français e\u0301 / custom ’  ';
const literalToken='  e\u0301 token ’  ';
let runtime:string,service:ChildProcess,code:string,sequence=0;

function nativeView(){return JSON.parse(execFileSync(binary,['view','--store',resolve(runtime,'authority'),'--project','search-languages'],{encoding:'utf8'}))}
function otherEdit(){
  const v=nativeView();
  const command={schema:1,project:'search-languages',command_id:'peer-'+v.revision.id,base_revision:v.revision.id,preimage_hash:v.revision.snapshot_hash,config_version:v.snapshot.config.version,label:'Synthetic concurrent correction',operations:[{kind:'set_token',document:'xmlfiles/a.xml',token:'a0',fields:{nform:'changed'}}]};
  const file=resolve(runtime,'peer.json');writeFileSync(file,JSON.stringify(command));execFileSync(binary,['apply','--store',resolve(runtime,'authority'),'--command',file]);
}

test.beforeEach(async()=>{
  runtime=resolve(root,'.private',`browser-search-languages-${process.pid}-${++sequence}`);
  if(existsSync(runtime))throw new Error('Fresh synthetic fixture required');
  for(const directory of ['Resources','xmlfiles','Audio'])mkdirSync(resolve(runtime,'package',directory),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  const transitions=Array.from({length:26},(_,i)=>`<u id='u${i}' start='1' end='3' variety='fr'><tok id='a${i}' form='bonjour'>bonjour</tok><tok id='z${i}' form='world' variety='en'>world</tok></u>`).join('\n');
  writeFileSync(resolve(runtime,'package/xmlfiles/a.xml'),`<TEI><teiHeader><title>SYNTHETIC language transitions</title><media url='tone.wav'/></teiHeader><text>${transitions}</text></TEI>`);
  writeFileSync(resolve(runtime,'package/xmlfiles/b.xml'),`<TEI><teiHeader><title>SYNTHETIC language controls</title></teiHeader><text><u id='french' variety='fr'><tok id='f1'>bonjour</tok><tok id='f2'>world</tok></u><u id='english' variety='en'><tok id='e1'>bonjour</tok><tok id='e2'>world</tok></u><u id='unset'><tok id='n1'>bonjour</tok><tok id='n2'>world</tok></u><u id='literal'><tok id='l1' form='${literalToken}' variety='${customLanguage}'>literal</tok><tok id='l2' variety='en'>next</tok></u></text></TEI>`);
  const audio=Buffer.alloc(44+256000);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);writeFileSync(resolve(runtime,'package/Audio/tone.wav'),audio);
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','search-languages']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','search-languages','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterEach(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service.once('exit',()=>done()))}});

async function open(page:Page,words='bonjour\nworld'){
  await page.goto('/#session='+code);await expect(page).toHaveTitle(/Corpus workbench/i);
  await page.getByRole('button',{name:'Corpus search',exact:true}).click();
  await page.getByLabel('Exact token sequence',{exact:true}).fill(words);
  await page.locator('.search-term-languages > summary').click();
}
const language=(page:Page,n:number)=>page.getByRole('combobox',{name:`Term ${n} language`,exact:true});
const exactLanguage=(page:Page,n:number)=>page.getByRole('textbox',{name:`Term ${n} exact language`,exact:true});
async function exact(page:Page,n:number,value:string){await language(page,n).selectOption('exact');await exactLanguage(page,n).fill(value)}
async function mixed(page:Page){await exact(page,1,'fr');await exact(page,2,'en')}
async function search(page:Page,total:number){
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/search'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Search corpus',exact:true}).click();const received=await response;expect(received.ok()).toBe(true);
  const envelope=await received.json();expect(envelope.result.total).toBe(total);await expect(page.locator('#corpus-search-status')).toContainText(`${total} hits`);return envelope;
}
async function exported(page:Page){
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export shown results (JSON)',exact:true}).click();
  const file=resolve(runtime,'language-results.json');await(await downloading).saveAs(file);return JSON.parse(readFileSync(file,'utf8'));
}

test('global defaults, Any language and exact transitions submit distinct real queries without changing evidence',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text())});const before=nativeView();
  await open(page);await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(2);
  await expect(language(page,1)).toHaveValue('default');await expect(language(page,2)).toHaveValue('default');
  const unfiltered=await search(page,29);expect(unfiltered.result.query.terms).toEqual([{text:'bonjour',language:null},{text:'world',language:null}]);
  await page.getByLabel('Language / variety filter',{exact:true}).fill('fr');
  const defaults=await search(page,1);expect(defaults.result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:'world',language:'fr'}]);await expect(page.locator('.search-hit')).toContainText('f1, f2');
  await language(page,2).selectOption('any');
  const any=await search(page,27);expect(any.result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:'world',language:null}]);
  await exact(page,2,'en');const transition=await search(page,26);expect(transition.result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:'world',language:'en'}]);
  expect(transition.result.hits[0].matched.map((t:any)=>[t.language,t.language_source])).toEqual([['fr','ancestor/variety'],['en','token/variety']]);
  expect(new Set([unfiltered.result_hash,defaults.result_hash,any.result_hash,transition.result_hash]).size).toBe(4);
  expect(transition.result.binding.snapshot_hash).toBe(before.revision.snapshot_hash);
  await exact(page,1,'fr');await page.getByLabel('Language / variety filter',{exact:true}).fill('unrelated global default');
  expect((await search(page,26)).result.query.terms).toEqual(transition.result.query.terms);
  await page.getByRole('combobox',{name:'Search documents',exact:true}).selectOption('xmlfiles/b.xml');await search(page,0);
  await page.getByRole('combobox',{name:'Search documents',exact:true}).selectOption('');await search(page,26);
  const qa=resolve(root,'../corpus-b28-browser-qa');mkdirSync(qa,{recursive:true});
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'Dark appearance',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await page.locator('.search-term-languages').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(qa,`languages-${theme}-desktop.png`)});
  }
  await page.setViewportSize({width:390,height:844});await page.locator('.search-term-languages').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(qa,'languages-mobile.png')});
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);expect(nativeView().revision.snapshot_hash).toBe(before.revision.snapshot_hash);expect(errors).toEqual([]);
});

test('literal token and custom language spelling retain spaces and Unicode while empty exact values block submission',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await open(page,literalToken+'\nnext');await language(page,1).focus();await page.keyboard.press('End');await page.keyboard.press('Tab');await expect(exactLanguage(page,1)).toBeFocused();await exactLanguage(page,1).fill(customLanguage);await exact(page,2,'en');
  expect(await page.locator('#search-term-languages .search-term-text').first().textContent()).toBe(literalToken);
  const literal=await search(page,1);expect(literal.result.query.terms).toEqual([{text:literalToken,language:customLanguage},{text:'next',language:'en'}]);
  expect(literal.result.hits[0].matched[0].language).toBe(customLanguage);expect((await exported(page)).result.query.terms).toEqual(literal.result.query.terms);
  await exactLanguage(page,1).fill(customLanguage.normalize('NFC'));await search(page,0);
  await exactLanguage(page,1).fill(' ');expect((await search(page,0)).result.query.terms[0].language).toBe(' ');
  let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/search')requests++});
  await exactLanguage(page,1).fill('');await page.locator('.search-term-languages > summary').click();await page.getByRole('button',{name:'Search corpus',exact:true}).click();
  await expect(page.locator('.search-term-languages')).toHaveAttribute('open','');
  expect(await exactLanguage(page,1).evaluate((e:HTMLInputElement)=>e.validity.valueMissing)).toBe(true);await expect(exactLanguage(page,1)).toBeFocused();expect(requests).toBe(0);
  await language(page,1).selectOption('any');await expect(page.locator('input[name="term-language-1"]')).toBeDisabled();
  expect((await search(page,1)).result.query.terms[0].language).toBeNull();expect(errors).toEqual([]);
});

test('eight long terms stay usable on mobile and a ninth term is rejected without submitting or retaining removed choices',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text())});
  const words=Array.from({length:8},(_,i)=>`Term ${i+1} e\u0301 ’ ${'longliteral'.repeat(20)}`);
  await open(page,words.join('\n'));await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(8);
  for(let n=1;n<=8;n++)await exact(page,n,n%2?'fr':'en');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('#search-term-languages').evaluate(e=>{
    const panel=e.closest('.search-panel')!.getBoundingClientRect();
    return [...e.querySelectorAll('select,input,code')].every(control=>{const r=control.getBoundingClientRect();return r.left>=panel.left&&r.right<=panel.right});
  })).toBe(true);
  const qa=resolve(root,'../corpus-b28-browser-qa');mkdirSync(qa,{recursive:true});
  await page.locator('#search-term-languages .search-term-language').first().scrollIntoViewIfNeeded();await page.screenshot({path:resolve(qa,'languages-eight-terms-mobile-first.png')});
  await page.locator('#search-term-languages .search-term-language').last().scrollIntoViewIfNeeded();
  expect(await page.locator('#search-term-languages').evaluate(e=>{
    return [...e.querySelectorAll('select,input,code,.search-term-heading>span')].flatMap(control=>{
      const boxes=control.tagName==='CODE'?(()=>{const range=document.createRange();range.selectNodeContents(control);return [...range.getClientRects()]})():[control.getBoundingClientRect()];
      return boxes.filter(r=>r.left<0||r.right>innerWidth).map(r=>({element:control.tagName,left:r.left,right:r.right}));
    });
  })).toEqual([]);
  await page.screenshot({path:resolve(qa,'languages-eight-terms-mobile-last.png')});
  let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/search')requests++});
  await page.getByLabel('Exact token sequence',{exact:true}).fill([...words,'ninth'].join('\n'));await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(8);await expect(exactLanguage(page,8)).toHaveValue('en');
  await page.getByRole('button',{name:'Search corpus',exact:true}).click();await expect(page.locator('#corpus-search-status')).toContainText(/Enter 1[–-]8 tokens/);expect(requests).toBe(0);
  await page.getByLabel('Exact token sequence',{exact:true}).fill(words.slice(0,7).join('\n'));await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(7);
  await page.getByLabel('Exact token sequence',{exact:true}).fill(words.join('\n'));await expect(language(page,8)).toHaveValue('default');await expect(page.locator('input[name="term-language-8"]')).toBeDisabled();
  const accepted=await search(page,0);expect(accepted.result.query.terms).toHaveLength(8);expect(accepted.result.query.terms[7]).toEqual({text:words[7],language:null});expect(errors).toEqual([]);
});

test('language choices stay bound to term positions across literal edits and blank lines; removed slots are forgotten',async({page})=>{
  await open(page);await mixed(page);await page.getByLabel('Language / variety filter',{exact:true}).fill('de');
  await page.getByLabel('Exact token sequence',{exact:true}).fill('  changed  \n\nworld');
  await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(2);await expect(exactLanguage(page,1)).toHaveValue('fr');await expect(exactLanguage(page,2)).toHaveValue('en');
  expect((await search(page,0)).result.query.terms).toEqual([{text:'  changed  ',language:'fr'},{text:'world',language:'en'}]);
  await page.getByLabel('Exact token sequence',{exact:true}).fill('world\nbonjour\nnext');await expect(language(page,3)).toHaveValue('default');
  expect((await search(page,0)).result.query.terms).toEqual([{text:'world',language:'fr'},{text:'bonjour',language:'en'},{text:'next',language:'de'}]);
  await page.getByLabel('Exact token sequence',{exact:true}).fill('bonjour');await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(1);
  await page.getByLabel('Exact token sequence',{exact:true}).fill('bonjour\nworld');await expect(language(page,2)).toHaveValue('default');await expect(page.locator('input[name="term-language-2"]')).toBeDisabled();
  expect((await search(page,0)).result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:'world',language:'de'}]);
  await page.getByLabel('Language / variety filter',{exact:true}).fill('fr');await search(page,1);
  await page.getByLabel('Exact token sequence',{exact:true}).fill('bonjour\n \nworld');await expect(page.locator('#search-term-languages .search-term-text')).toHaveCount(3);
  expect((await search(page,0)).result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:' ',language:'fr'},{text:'world',language:'fr'}]);
});

test('override edits invalidate audio and pagination, retain bound export, and reject delayed search and hit responses',async({page})=>{
  await open(page);await mixed(page);await page.getByRole('combobox',{name:'Page size',exact:true}).selectOption('25');const first=await search(page,26);await expect(page.locator('.search-hit')).toHaveCount(25);
  await page.getByRole('button',{name:'Play utterance',exact:true}).first().click();await expect(page.locator('#search-audio')).toHaveAttribute('src',/revision=1$/);
  await language(page,2).selectOption('any');await expect(page.getByRole('button',{name:'Open matched tokens',exact:true}).first()).toBeDisabled();await expect(page.getByRole('button',{name:'Play utterance',exact:true}).first()).toBeDisabled();await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
  await expect(page.locator('#search-audio')).not.toHaveAttribute('src');expect(await page.locator('#search-audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);await expect(page.locator('#search-audio-basis')).toHaveText('');
  const retained=await exported(page);expect(retained.result_hash).toBe(first.result_hash);expect(retained.result.query.terms).toEqual(first.result.query.terms);
  await search(page,27);const paging=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/search');await page.getByRole('button',{name:'Next page',exact:true}).click();const next=await(await paging).json();expect(next.result.query.offset).toBe(25);await expect(page.locator('.search-hit')).toHaveCount(2);
  await exact(page,2,'en');await expect(page.getByRole('button',{name:'Previous page',exact:true})).toBeDisabled();expect((await search(page,26)).result.query.offset).toBe(0);
  let release!:()=>void,arrived!:()=>void,delivered!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>arrived=r),finished=new Promise<void>(r=>delivered=r);
  await page.route('**/api/search',async route=>{if(route.request().postDataJSON().terms[1].language!=='fr'){await route.continue();return}const response=await route.fetch();arrived();await held;await route.fulfill({response});delivered()});
  await exactLanguage(page,2).fill('fr');await page.getByRole('button',{name:'Search corpus',exact:true}).click();await started;await exactLanguage(page,2).fill('en');await search(page,26);release();await finished;
  await expect(page.locator('#corpus-search-status')).toContainText('26 hits');await expect(page.locator('.search-hit')).toHaveCount(25);await page.unroute('**/api/search');
  let releaseHit!:()=>void,hitArrived!:()=>void,hitDelivered!:()=>void;const heldHit=new Promise<void>(r=>releaseHit=r),hitStarted=new Promise<void>(r=>hitArrived=r),hitFinished=new Promise<void>(r=>hitDelivered=r);
  await page.route('**/api/search/resolve',async route=>{const response=await route.fetch();hitArrived();await heldHit;await route.fulfill({response});hitDelivered()});
  await page.getByRole('button',{name:'Play utterance',exact:true}).first().click();await hitStarted;await language(page,2).selectOption('any');releaseHit();await hitFinished;
  await expect(page.locator('#search-audio')).not.toHaveAttribute('src');await expect(page.locator('#corpus-search-status')).toContainText('Query changed');await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
});

test('current stale guards and historical inspection, audio and export keep the exact per-term evidence binding',async({page})=>{
  const before=nativeView();await open(page);await mixed(page);await search(page,26);otherEdit();
  await page.getByRole('button',{name:'Open matched tokens',exact:true}).first().click();await expect(page.locator('#corpus-search-status')).toContainText('stale');await expect(page.locator('#save-state')).toContainText('Saved R1');
  await page.getByRole('button',{name:'Reload saved evidence',exact:true}).click();await expect(page.locator('#save-state')).toContainText('Saved R2');await expect(page.getByRole('button',{name:'Open matched tokens',exact:true}).first()).toBeDisabled();await search(page,25);
  await page.getByRole('combobox',{name:'Search evidence revision',exact:true}).selectOption('1');const historical=await search(page,26);
  expect(historical.result.binding.snapshot_hash).toBe(before.revision.snapshot_hash);expect(historical.result.query.terms).toEqual([{text:'bonjour',language:'fr'},{text:'world',language:'en'}]);
  await page.getByRole('button',{name:'Inspect historical hit',exact:true}).first().click();await expect(page.locator('#historical-search-inspection')).toContainText('Historical R1');await expect(page.locator('#historical-search-inspection')).toContainText('"language": "fr"');await expect(page.locator('#historical-search-inspection')).toContainText('"language": "en"');await expect(page.locator('#save-state')).toContainText('Saved R2');
  await page.getByRole('button',{name:'Play utterance',exact:true}).first().click();await expect(page.locator('#search-audio')).toHaveAttribute('src',/revision=1$/);await expect(page.locator('#search-audio-basis')).toContainText('Historical R1');await page.locator('#search-audio').evaluate((a:HTMLAudioElement)=>a.pause());
  expect(await exported(page)).toEqual(historical);expect(nativeView().documents[0].tokens[0].corrected).toBe('changed');
  await page.getByRole('combobox',{name:'Search evidence revision',exact:true}).selectOption('current');await page.getByRole('combobox',{name:'Search reading',exact:true}).selectOption('original');await search(page,26);
  await page.getByRole('button',{name:'Open matched tokens',exact:true}).first().click();await expect(page.locator('[data-token="a0"]')).toHaveClass(/selected/);await expect(page.locator('[data-token="z0"]')).toHaveClass(/selected/);await expect(page.locator('#reading-layer')).toHaveValue('original');
});

test('per-term language search navigation preserves authoring drafts and refuses evidence reload while a draft exists',async({page})=>{
  await page.goto('/#session='+code);await page.locator('[data-token="a0"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('Protected language draft');
  await page.getByRole('button',{name:'Corpus search',exact:true}).click();await page.getByLabel('Exact token sequence',{exact:true}).fill('bonjour\nworld');await page.locator('.search-term-languages > summary').click();await exact(page,1,'fr');await language(page,2).selectOption('any');await search(page,27);
  await page.getByRole('button',{name:'Open matched tokens',exact:true}).last().click();await expect(page.locator('#document-title')).toHaveText('SYNTHETIC language controls');
  await page.locator('[data-document="xmlfiles/a.xml"]').click();await page.locator('[data-token="a0"]').click();await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('Protected language draft');
  otherEdit();await page.getByRole('button',{name:'Corpus search',exact:true}).click();await page.getByRole('button',{name:'Reload saved evidence',exact:true}).click();await expect(page.locator('#corpus-search-status')).toContainText('Save or discard authoring drafts');
  await page.getByRole('button',{name:'Token',exact:true}).click();await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('Protected language draft');expect(nativeView().revision.id).toBe(2);
});
