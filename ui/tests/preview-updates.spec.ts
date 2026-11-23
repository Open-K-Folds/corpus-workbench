import {expect} from '@playwright/test';
import {test} from './practice-fixture';

test('remote sign-in uses the same-origin handoff and retains manual entry', async ({page,practiceUrl})=>{
  await page.goto(new URL(practiceUrl).origin);
  await expect(page.getByLabel('Session code')).toBeVisible();
  const cloudflare=page.getByRole('link',{name:'Sign in with Cloudflare'});
  if (process.env.VITE_WB_REMOTE_PREVIEW==='1') await expect(cloudflare).toHaveAttribute('href','/open');
  else await expect(cloudflare).toHaveCount(0);
});

test('the remote preview offers a guarded refresh only when deployed assets change', async ({page,practiceUrl}) => {
  let checks=0;
  let deployment:'current'|'offline'|'updated'='current';
  await page.route('**/index.html', async route=>{
    checks++;
    if (deployment==='current') return route.continue();
    if (deployment==='offline') return route.abort('internetdisconnected');
    await route.fulfill({contentType:'text/html',body:'<div id="app"></div><script type="module" src="/assets/index-newbuild.js"></script>'});
  });
  await page.clock.install();
  await page.goto(practiceUrl);
  const word=page.locator('#tokens .lexeme[data-token] > .reading-text').first();
  await expect(word).toBeVisible();
  const refresh=page.getByRole('button',{name:'Refresh to load update'});
  if (process.env.VITE_WB_REMOTE_PREVIEW!=='1') {
    await page.clock.fastForward(61_000);
    expect(checks).toBe(0);
    await expect(refresh).toHaveCount(0);
    return;
  }
  await expect.poll(()=>checks).toBe(1);
  await expect(refresh).toBeHidden();
  deployment='offline';
  await page.clock.fastForward(61_000);
  await expect.poll(()=>checks).toBe(2);
  await word.click({button:'right'});
  await page.getByRole('button',{name:'Correct',exact:true}).click();
  const draft=page.getByLabel('Proposed correction');
  await draft.fill('an unsaved word');
  deployment='updated';
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(refresh).toBeVisible();
  await expect(page.getByText('Update ready',{exact:true})).toBeVisible();
  await expect(draft).toHaveValue('an unsaved word');
  const beforeUnload=page.waitForEvent('dialog').then(async dialog=>{
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
  });
  await refresh.click();
  await beforeUnload;
  await expect(draft).toHaveValue('an unsaved word');
});
