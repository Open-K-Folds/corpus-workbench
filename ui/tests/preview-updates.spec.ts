import {expect, type Page} from '@playwright/test';
import {test} from './practice-fixture';

async function previewDeployment(page: Page) {
  await page.route('**/api/session', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), remote_preview: true}});
  });
}

for (const remote of [false, true]) test('sign-in offers the handoff only for the configured deployment: '+remote, async ({page,practiceUrl})=>{
  if (remote) await previewDeployment(page);
  await page.goto(new URL(practiceUrl).origin);
  const cloudflare=page.getByRole('link',{name:'Sign in with Cloudflare'});
  if (remote) {
    await expect(cloudflare).toHaveAttribute('href','/open');
    await page.getByText('Use a session code',{exact:true}).click();
  }
  else await expect(cloudflare).toHaveCount(0);
  await expect(page.getByLabel('Session code')).toBeVisible();
});

test('an expired launcher link can be recovered with the current session code', async ({page,practiceUrl})=>{
  const current=new URL(practiceUrl);
  const validCode=new URLSearchParams(current.hash.slice(1)).get('session')!;
  current.search='?view=reading';
  current.hash='session=expired';
  await page.goto(current.href);
  await expect(page.getByRole('alert').filter({hasText:'This link has expired'})).toBeVisible();
  await expect(page).toHaveURL(current.origin+'/?view=reading');
  const input=page.getByLabel('Session code');
  await input.fill('rejected');
  await input.press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid','true');
  await input.fill(validCode);
  await input.press('Enter');
  await expect(page.locator('#save-state')).toContainText('R1');
});

for (const remote of [false, true]) test('asset update checks follow the deployment setting and protect drafts: '+remote, async ({page,practiceUrl}) => {
  if (remote) await previewDeployment(page);
  let checks=0;
  let deployment:'current'|'offline'|'updated'='current';
  await page.route('**/index.html', async route=>{
    checks++;
    if (deployment==='current') return route.continue();
    if (deployment==='offline') return route.abort('internetdisconnected');
    await route.fulfill({contentType:'text/html',body:'<div id="workbench-root"></div><script type="module" src="/assets/index-newbuild.js"></script>'});
  });
  await page.clock.install();
  await page.goto(practiceUrl);
  const word=page.locator('#tokens .lexeme[data-token] > .reading-text').first();
  await expect(word).toBeVisible();
  const refresh=page.getByRole('button',{name:'Refresh to load update'});
  if (!remote) {
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
