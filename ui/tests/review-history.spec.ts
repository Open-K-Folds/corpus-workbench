import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve('..'),runtime=resolve(root,'.private',`browser-review-history-${process.pid}`);
const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
let service:ChildProcess,code='',sequence=0;
interface Receipt {id:number;revision:number;snapshot_hash:string;actor:string;decision:string;scope:string;note:string;created_at:string;self_review:boolean}
interface ReviewHistory {revision:number;snapshot_hash:string;reviews:Receipt[]}

test.beforeAll(async()=>{
  if(existsSync(runtime))throw new Error('Fresh synthetic review authority required');
  for(const folder of ['Resources','xmlfiles'])mkdirSync(resolve(runtime,'package',folder),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(runtime,'package/xmlfiles/review.xml'),"<TEI><teiHeader><title>SYNTHETIC review history</title></teiHeader><text><u id='u1'><tok id='w1'>Synthetic</tok> <tok id='w2'>evidence</tok>.</u></text></TEI>");
  writeFileSync(resolve(runtime,'package/xmlfiles/second.xml'),"<TEI><teiHeader><title>SYNTHETIC second review document</title></teiHeader><text><tok id='other'>SECOND-REVIEW-DOCUMENT</tok></text></TEI>");
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','review-history']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','review-history','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service.once('exit',()=>done()))}});

async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw new Error(await response.text());return response.json();
},{path,body})}
async function head(page:Page){return api(page,'/api/view')}
async function receipts(page:Page,revision:number):Promise<ReviewHistory>{return api(page,`/api/reviews?revision=${revision}`)}
async function open(page:Page){await page.goto('/#session='+code);await expect(page.locator('[data-token="w1"]')).toBeVisible()}
async function reviewTab(page:Page){await page.getByRole('button',{name:'Review',exact:true}).click();await expect(page.locator('#review-form')).toBeVisible()}
async function record(page:Page,decision:string,note:string){
  const before=await head(page);
  await page.locator('#review-form').getByRole('combobox',{name:'Decision',exact:true}).selectOption(decision);await page.getByLabel('Review rationale',{exact:true}).fill(note);
  const posted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/review'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Record review',exact:true}).click();const response=await posted;expect(response.ok()).toBe(true);
  await expect.poll(async()=>(await receipts(page,before.revision.id)).reviews[0]?.note).toBe(note);
  await expect(page.locator('#review-current-status')).toContainText(decision==='approved'?/Approved/:decision==='rejected'?/Rejected/:/Needs adjudication/i);
  if(await page.getByRole('combobox',{name:'Decision history for',exact:true}).inputValue()===String(before.revision.id))await expect(page.locator('#review-history')).toContainText(note);
  return (await receipts(page,before.revision.id)).reviews[0];
}
async function makeRevision(page:Page){
  const view=await head(page);return api(page,'/api/command',{schema:1,project:view.snapshot.project,command_id:`review-history-${process.pid}-${++sequence}`,base_revision:view.revision.id,preimage_hash:view.revision.snapshot_hash,config_version:view.snapshot.config.version,label:'Synthetic review history evidence edit',operations:[{kind:'set_token',document:'xmlfiles/review.xml',token:'w2',fields:{note:`SYNTHETIC saved evidence ${sequence}`}}]});
}
async function twoReviewedRevisions(page:Page){
  let view=await head(page);
  if(view.revision.id===1){
    await api(page,'/api/review',{revision:1,snapshot_hash:view.revision.snapshot_hash,decision:'approved',note:'SYNTHETIC original review for response isolation'});
    await makeRevision(page);view=await head(page);
  }
  if(!(await receipts(page,view.revision.id)).reviews.length)await api(page,'/api/review',{revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,decision:'needs-adjudication',note:'SYNTHETIC current review for response isolation'});
  return {current:view.revision,prior:await receipts(page,1),latest:await receipts(page,view.revision.id)};
}

test('real decision receipts remain latest-first, literal and durable after reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page);const before=await head(page);await reviewTab(page);
  await expect(page.locator('#review-current-status')).toHaveAttribute('role','status');await expect(page.locator('#review-current-status')).toContainText(/Unreviewed/i);
  await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toHaveValue(String(before.revision.id));
  await expect(page.locator('#review-history [data-review-id]')).toHaveCount(0);
  const approved=await record(page,'approved','SYNTHETIC first approval');await expect(page.locator('#review-current-status')).toContainText(/Approved/);expect((await head(page)).approved).toBe(true);
  const rejected=await record(page,'rejected','SYNTHETIC rejected after listening');await expect(page.locator('#review-current-status')).toContainText(/Rejected/);expect((await head(page)).approved).toBe(false);
  const literal='SYNTHETIC <img src=x onerror="window.__reviewExecuted=true"> & <script>window.__reviewExecuted=true</script> e\u0301';
  const pending=await record(page,'needs-adjudication',literal);await expect(page.locator('#review-current-status')).toContainText(/Needs adjudication/i);
  const history=await receipts(page,before.revision.id);expect(history.revision).toBe(before.revision.id);expect(history.snapshot_hash).toBe(before.revision.snapshot_hash);
  expect(history.reviews.map(review=>review.id)).toEqual([pending.id,rejected.id,approved.id]);expect(history.reviews.map(review=>review.decision)).toEqual(['needs-adjudication','rejected','approved']);
  expect((await head(page)).revision).toEqual(before.revision);expect((await head(page)).approved).toBe(false);
  await page.reload();await reviewTab(page);await expect(page.locator('#review-current-status')).toContainText(/Needs adjudication/i);
  await expect(page.locator('#review-history [data-review-id]')).toHaveCount(3);
  expect(await page.locator('#review-history [data-review-id]').evaluateAll(rows=>rows.map(row=>Number((row as HTMLElement).dataset.reviewId)))).toEqual([pending.id,rejected.id,approved.id]);
  await expect(page.locator(`#review-history [data-review-id="${pending.id}"]`)).toBeVisible();await expect(page.locator(`#review-history [data-review-id="${rejected.id}"]`)).toBeHidden();await expect(page.locator(`#review-history [data-review-id="${approved.id}"]`)).toBeHidden();
  const earlier=page.locator('#review-history .review-earlier > summary');await expect(earlier).toHaveText('Earlier decisions (2)');await earlier.focus();await page.keyboard.press('Enter');await expect(page.locator('#review-history .review-earlier')).toHaveAttribute('open','');
  for(const receipt of history.reviews){
    const row=page.locator(`#review-history [data-review-id="${receipt.id}"]`);await expect(row).toBeVisible();await expect(row).toContainText(receipt.note);await expect(row).toContainText(receipt.actor);await expect(row).toContainText(/full/i);await expect(row).toContainText(/self.review/i);
    await expect(row.locator('time')).toHaveAttribute('datetime',receipt.created_at);
  }
  await expect(page.locator('#review-history img,#review-history script')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__reviewExecuted)).toBeUndefined();expect(errors).toEqual([]);
});

test('new evidence has no inherited approval and historical selection never retargets the current review form',async({page})=>{
  await open(page);await reviewTab(page);const before=await head(page);const approved=await record(page,'approved','SYNTHETIC approval before a real correction');
  await page.getByRole('button',{name:'Token',exact:true}).click();await page.locator('[data-token="w2"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC corrected evidence');
  await page.getByRole('button',{name:'Save token',exact:true}).click();await expect(page.locator('#save-state')).toContainText(`Saved R${before.revision.id+1}`);
  const current=await head(page);expect(current.approved).toBe(false);expect(current.revision.snapshot_hash).not.toBe(before.revision.snapshot_hash);
  await reviewTab(page);await expect(page.locator('#review-current-status')).toContainText(/Unreviewed/i);await expect(page.locator('#review-history [data-review-id]')).toHaveCount(0);await expect(page.locator('#compiler-contract')).toBeDisabled();
  await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption(String(before.revision.id));
  await expect(page.locator(`#review-history [data-review-id="${approved.id}"]`)).toContainText('SYNTHETIC approval before a real correction');
  await expect(page.getByRole('heading',{name:`Review exact R${current.revision.id}`,exact:true})).toBeVisible();await expect(page.locator('#review-current-status')).toContainText(/Unreviewed/i);
  const old=await receipts(page,before.revision.id),note='SYNTHETIC historical selection records only the current head';
  await record(page,'needs-adjudication',note);expect(await receipts(page,before.revision.id)).toEqual(old);
  const latest=await receipts(page,current.revision.id);expect(latest.reviews[0].note).toBe(note);expect(latest.reviews[0].revision).toBe(current.revision.id);expect(latest.reviews[0].snapshot_hash).toBe(current.revision.snapshot_hash);
  expect((await head(page)).revision).toEqual(current.revision);await page.reload();await reviewTab(page);await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toHaveValue(String(current.revision.id));await expect(page.locator('#review-current-status')).toContainText(/Needs adjudication/i);
});

test('reading decision history preserves token and annotation drafts and cannot approve them',async({page})=>{
  await open(page);const before=await head(page),original=await receipts(page,before.revision.id);let writes=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/review'&&request.method()==='POST')writes++});
  await page.locator('[data-token="w1"]').click();await page.getByLabel('Human-corrected reading',{exact:true}).fill('SYNTHETIC retained token draft');await reviewTab(page);
  await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption('1');await expect(page.locator('#review-history')).toContainText('R1');await expect(page.locator('#review-history [data-review-id]')).toHaveCount((await receipts(page,1)).reviews.length);
  await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#message')).toContainText(/drafts/i);expect(writes).toBe(0);
  await page.getByRole('button',{name:'Token',exact:true}).click();await expect(page.getByLabel('Human-corrected reading',{exact:true})).toHaveValue('SYNTHETIC retained token draft');await page.getByRole('button',{name:'Undo unsaved edits',exact:true}).click();
  await page.getByRole('button',{name:'Annotations',exact:true}).click();await page.getByLabel('Span label',{exact:true}).fill('SYNTHETIC retained annotation draft');await reviewTab(page);
  await page.getByRole('button',{name:'Record review',exact:true}).click();await expect(page.locator('#message')).toContainText(/drafts/i);expect(writes).toBe(0);
  await page.getByRole('button',{name:'Annotations',exact:true}).click();await expect(page.getByLabel('Span label',{exact:true})).toHaveValue('SYNTHETIC retained annotation draft');await page.getByRole('button',{name:'Discard annotation drafts',exact:true}).click();
  expect((await head(page)).revision).toEqual(before.revision);expect(await receipts(page,before.revision.id)).toEqual(original);
});

test('a failed history load exposes retry and retry preserves the independent current review rationale',async({page})=>{
  await open(page);const view=await head(page);if(!(await receipts(page,view.revision.id)).reviews.length)await api(page,'/api/review',{revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,decision:'rejected',note:'SYNTHETIC receipt for retry'});
  await page.route('**/api/reviews?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC review history read failure'})}));
  await reviewTab(page);await expect(page.locator('#review-history')).toContainText(/unavailable|failed|error/i);await expect(page.getByRole('button',{name:'Retry review history',exact:true})).toBeVisible();
  await page.getByLabel('Review rationale',{exact:true}).fill('SYNTHETIC rationale retained during read retry');await page.unroute('**/api/reviews?*');await page.getByRole('button',{name:'Retry review history',exact:true}).click();
  const expected=await receipts(page,view.revision.id);await expect(page.locator('#review-history [data-review-id]')).toHaveCount(expected.reviews.length);await expect(page.getByRole('button',{name:'Retry review history',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Review rationale',{exact:true})).toHaveValue('SYNTHETIC rationale retained during read retry');expect((await head(page)).revision).toEqual(view.revision);
});

test('revision index failure retains current receipts and retry preserves the review rationale',async({page})=>{
  await open(page);const {current,latest}=await twoReviewedRevisions(page);await page.reload();
  await page.route('**/api/history',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC revision list unavailable'})}));
  await reviewTab(page);await expect(page.locator('#review-revisions-status')).toContainText(/Historical revision list unavailable/i);
  await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toBeDisabled();await expect(page.locator('#review-history')).toContainText(latest.reviews[0].note);
  await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision',latest.reviews[0].decision);
  const rationale='SYNTHETIC rationale retained while retrying the revision index';await page.getByLabel('Review rationale',{exact:true}).fill(rationale);
  await page.unroute('**/api/history');await page.getByRole('button',{name:'Retry revision list',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toBeEnabled();await expect(page.locator('#review-revisions-status')).toHaveText('');await expect(page.getByLabel('Review rationale',{exact:true})).toHaveValue(rationale);
  await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption('1');await expect(page.locator('#review-history')).toContainText('Historical R1');
  await expect(page.getByRole('heading',{name:`Review exact R${current.id}`,exact:true})).toBeVisible();await expect(page.getByLabel('Review rationale',{exact:true})).toHaveValue(rationale);
});

test('initial current receipt success or failure settles current status while historical receipts stay selected',async({page})=>{
  await open(page);const {current,prior,latest}=await twoReviewedRevisions(page);
  for(const fail of [false,true]){
    await page.reload();let release!:()=>void,arrived!:()=>void,delivered!:()=>void;const held=new Promise<void>(done=>release=done),started=new Promise<void>(done=>arrived=done),finished=new Promise<void>(done=>delivered=done);
    await page.route('**/api/reviews?*',async route=>{if(new URL(route.request().url()).searchParams.get('revision')!==String(current.id)){await route.continue();return}const response=await route.fetch();arrived();await held;await route.fulfill(fail?{status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC held current decision failure'})}:{response});delivered()});
    const rationale='SYNTHETIC current rationale while inspecting prior receipts';
    try{
      await reviewTab(page);await started;await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption('1');
      await expect(page.locator('#review-history')).toContainText(prior.reviews[0].note);await expect(page.locator('#review-current-status')).toContainText(/Loading current decision/i);await page.getByLabel('Review rationale',{exact:true}).fill(rationale);
    }finally{release()}
    await finished;
    if(fail){await expect(page.locator('#review-current-status')).toHaveText('Current decision unavailable');await expect(page.locator('#review-current-status')).not.toHaveAttribute('data-decision',/.+/)}
    else await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision',latest.reviews[0].decision);
    await expect(page.locator('#review-history')).toContainText(prior.reviews[0].note);await expect(page.locator('#review-history')).not.toContainText('SYNTHETIC held current decision failure');await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toHaveValue('1');
    expect(await page.locator('#review-history [data-review-id]').evaluateAll(rows=>rows.map(row=>Number((row as HTMLElement).dataset.reviewId)))).toEqual(prior.reviews.map(review=>review.id));await expect(page.getByLabel('Review rationale',{exact:true})).toHaveValue(rationale);await page.unroute('**/api/reviews?*');
  }
});

test('late success and error for an old selected revision cannot replace the current decision history',async({page})=>{
  await open(page);const {current,latest}=await twoReviewedRevisions(page);await page.reload();await reviewTab(page);await expect(page.locator('#review-history')).toContainText(latest.reviews[0].note);
  for(const fail of [false,true]){
    let release!:()=>void,arrived!:()=>void,delivered!:()=>void;const held=new Promise<void>(done=>release=done),started=new Promise<void>(done=>arrived=done),finished=new Promise<void>(done=>delivered=done);
    await page.route('**/api/reviews?*',async route=>{if(new URL(route.request().url()).searchParams.get('revision')!=='1'){await route.continue();return}const response=await route.fetch();arrived();await held;await route.fulfill(fail?{status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC obsolete review list failure'})}:{response});delivered()});
    try{
      await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption('1');await started;await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption(String(current.id));
      await expect(page.locator('#review-history')).toContainText(latest.reviews[0].note);
    }finally{release()}
    await finished;await expect(page.locator('#review-history')).toContainText(latest.reviews[0].note);await expect(page.locator('#review-history')).not.toContainText('SYNTHETIC obsolete review list failure');await expect(page.getByRole('combobox',{name:'Decision history for',exact:true})).toHaveValue(String(current.id));await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision',latest.reviews[0].decision);
    expect(await page.locator('#review-history [data-review-id]').evaluateAll(rows=>rows.map(row=>Number((row as HTMLElement).dataset.reviewId)))).toEqual(latest.reviews.map(review=>review.id));await page.unroute('**/api/reviews?*');
  }
});

test('late review-list success or failure cannot replace a different document XML inspector',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await open(page);await twoReviewedRevisions(page);
  for(const fail of [false,true]){
    await page.reload();let release!:()=>void,arrived!:()=>void,delivered!:()=>void;const held=new Promise<void>(done=>release=done),started=new Promise<void>(done=>arrived=done),finished=new Promise<void>(done=>delivered=done);
    await page.route('**/api/reviews?*',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill(fail?{status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC obsolete inspector failure'})}:{response});delivered()});
    try{
      await reviewTab(page);await started;await page.getByRole('button',{name:'XML',exact:true}).click();await page.locator('[data-document="xmlfiles/second.xml"]').click();await expect(page.locator('#xml-preview')).toContainText('SECOND-REVIEW-DOCUMENT');
    }finally{release()}
    await finished;await expect(page.locator('#xml-preview')).toContainText('SECOND-REVIEW-DOCUMENT');await expect(page.locator('#review-history')).toHaveCount(0);await expect(page.locator('#message')).not.toContainText('SYNTHETIC obsolete inspector failure');await page.unroute('**/api/reviews?*');
  }
  expect(errors).toEqual([]);
});

test('fresh same-revision decisions control the export action despite an older captured approval',async({page})=>{
  await open(page);const {current,prior}=await twoReviewedRevisions(page);
  await api(page,'/api/review',{revision:current.id,snapshot_hash:current.snapshot_hash,decision:'approved',note:'SYNTHETIC approval captured by the open view'});await page.reload();
  await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  let release!:()=>void,arrived!:()=>void,delivered!:()=>void;const held=new Promise<void>(done=>release=done),started=new Promise<void>(done=>arrived=done),finished=new Promise<void>(done=>delivered=done);
  await page.route('**/api/reviews?*',async route=>{if(new URL(route.request().url()).searchParams.get('revision')!==String(current.id)){await route.continue();return}arrived();await held;const response=await route.fetch();await route.fulfill({response});delivered()});
  try{
    await reviewTab(page);await started;await expect(page.locator('#compiler-contract')).toBeDisabled();
    await api(page,'/api/review',{revision:current.id,snapshot_hash:current.snapshot_hash,decision:'rejected',note:'SYNTHETIC concurrent rejection before the current receipt read'});
  }finally{release()}
  await finished;await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision','rejected');await expect(page.locator('#compiler-contract')).toBeDisabled();await page.unroute('**/api/reviews?*');
  await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption('1');await expect(page.locator('#review-history')).toContainText(prior.reviews[0].note);
  await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision','rejected');await expect(page.locator('#compiler-contract')).toBeDisabled();
  await page.route('**/api/reviews?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'SYNTHETIC current-decision read failure before retry'})}));
  await page.getByRole('combobox',{name:'Decision history for',exact:true}).selectOption(String(current.id));await expect(page.getByRole('button',{name:'Retry review history',exact:true})).toBeVisible();await expect(page.locator('#compiler-contract')).toBeDisabled();
  await api(page,'/api/review',{revision:current.id,snapshot_hash:current.snapshot_hash,decision:'approved',note:'SYNTHETIC concurrent approval before fresh receipt retry'});await page.unroute('**/api/reviews?*');
  await page.getByRole('button',{name:'Retry review history',exact:true}).click();await expect(page.locator('#review-current-status')).toHaveAttribute('data-decision','approved');await expect(page.locator('#compiler-contract')).toBeEnabled();
  expect((await head(page)).revision).toEqual(current);
});
