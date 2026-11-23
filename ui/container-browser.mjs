// Isolated browser probe for a synthetic Compose service already started by the
// smoke harness. The session capability stays in memory and is never logged.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.WB_CONTAINER_URL,code=process.env.WB_CONTAINER_CODE;
assert(base?.startsWith('http://127.0.0.1:')&&code,'Explicit local container QA session required');
const browser=await chromium.launch(process.env.WB_CHROME?{executablePath:process.env.WB_CHROME}:{});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url())});
  await page.goto(base+'/#session='+code);
  await page.locator('#save-state').filter({hasText:'Saved R2'}).waitFor();
  const rail=page.getByRole('navigation',{name:'Workspace tools'});
  const inspector=page.getByRole('complementary',{name:'Inspector'});
  await page.locator('[data-token="w-1"]').click();
  await page.getByRole('navigation',{name:'Reading canvas controls'}).getByRole('button',{name:'Listen to selected passage',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
  assert.equal(await page.locator('audio').evaluate(a=>a.error),null);
  await rail.getByRole('button',{name:'Tools',exact:true}).click();
  await inspector.getByLabel('Human-corrected reading').fill('Browser container correction 🙂');
  await inspector.getByRole('button',{name:'Save token',exact:true}).click();
  await page.locator('#save-state').filter({hasText:'Saved R3'}).waitFor();
  assert((await page.locator('#save-state').textContent()).includes('Unreviewed'));
  await rail.getByRole('button',{name:'Open revision history',exact:true}).click();
  await inspector.locator('#compare-from').selectOption('2');
  await inspector.getByRole('button',{name:'Compare with current',exact:true}).click();
  await inspector.locator('#diff').filter({hasText:'Browser container correction'}).waitFor();
  await inspector.getByRole('button',{name:'Undo last committed edit',exact:true}).click();
  await page.locator('#save-state').filter({hasText:'Saved R4'}).waitFor();
  await rail.getByRole('button',{name:'Open revision review',exact:true}).click();
  await inspector.getByLabel('Review rationale').fill('Synthetic container browser probe');
  await inspector.getByRole('button',{name:'Record review',exact:true}).click();
  await page.locator('#save-state').filter({hasText:'Approved exact revision'}).waitFor();
  await rail.getByRole('button',{name:'Export complete package',exact:true}).click();
  const link=page.getByRole('link',{name:'Download complete package'});await link.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
  assert.equal(await download.failure(),null);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({browser:'Chromium',audio:true,edit:true,diff:true,undo:true,review:true,export:true,mobile:true,page_errors:0,external_requests:0}));
}finally{await browser.close()}
