import {expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {test} from './practice-fixture';

const word=(page:Page,id:string)=>page.locator(`#tokens [data-token="${id}"] .reading-text`);
const panel=(page:Page)=>page.locator('#training-panel');
const fan=(page:Page)=>page.locator('.training-fan');

async function selectTurn(page:Page) {
  await word(page,'b1').click();
  await word(page,'b6').click({modifiers:['Shift']});
  await expect(page.locator('#tokens .selected')).toHaveCount(6);
}

async function holdSecondPress(page:Page,id:string) {
  const box=(await word(page,id).boundingBox())!;
  const origin={x:box.x+box.width/2,y:box.y+box.height/2};
  await page.mouse.click(origin.x,origin.y);
  await page.mouse.down();
  await expect(fan(page)).toBeVisible();
  return origin;
}

test.describe('a held lens over a timed transcript', () => {
  test.use({practicePackage:resolve('../fixtures/spoken-reading')});
  for (const theme of ['light','dark']) {
    test(`in ${theme} the selected word stays legible and upcoming turns stay dim`, async ({page,practiceUrl}) => {
      await page.addInitScript(theme => localStorage.setItem('wb-theme',theme),theme);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto(practiceUrl);
      await expect(page.locator('#canvas-play')).toBeEnabled();
      const ink = (id:string) => word(page,id).evaluate(node => Number(getComputedStyle(node).opacity));
      const upcoming = await word(page,'w3-1').evaluate(node => Number(getComputedStyle(node).getPropertyValue('--upcoming-turn-opacity')));
      expect(upcoming).toBeGreaterThan(0);
      expect(upcoming).toBeLessThan(1);
      await expect.poll(() => ink('w3-1')).toBe(upcoming);
      await holdSecondPress(page,'w2-3');
      await expect.poll(() => ink('w2-3')).toBe(1);
      await expect.poll(() => ink('w3-1')).toBe(upcoming);
      expect(await fan(page).evaluate(node => node.getAnimations({subtree:true}).length)).toBe(0);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect(fan(page)).toHaveCount(0);
      await expect.poll(() => ink('w2-3')).toBe(upcoming);
    });
  }
});

test('a held second press on a selected turn steers a bounded candidate search',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await selectTurn(page);
  const origin=await holdSecondPress(page,'b3');
  await expect(page.locator('#tokens .selected')).toHaveCount(6);
  const target=fan(page).locator('[data-lens=contrast]');
  const box=(await target.boundingBox())!;
  const dx=box.x+box.width/2-origin.x,dy=box.y+box.height/2-origin.y;
  const distance=Math.hypot(dx,dy);
  for(const [radius,limit] of [[34,3],[82,6],[124,12]]){
    await page.mouse.move(origin.x+radius*dx/distance,origin.y+radius*dy/distance,{steps:4});
    await expect(target).toHaveAttribute('data-active','');
    await expect(fan(page).locator('output')).toHaveText(`Contrast · up to ${limit} candidates`);
    await expect(fan(page).locator('.training-fan-ray[data-active]')).toHaveCount(1);
    await expect(fan(page).locator('small')).toContainText('Release to compare');
  }
  await page.mouse.up();
  await expect(fan(page)).toHaveCount(0);
  await expect(panel(page)).toHaveAttribute('data-mode','contrast');
  await expect(panel(page)).toHaveAttribute('data-limit','12');
  await expect(panel(page).locator('[data-training-seed]')).toContainText('I only heard after the meeting.');
});

for (const spacing of ['normal', '0.12em']) {
  test(`the fan keeps a wrapped selected passage readable at the edges of a phone viewport with ${spacing} text spacing`,async({page,practiceUrl})=>{
    await page.setViewportSize({width:320,height:568});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(practiceUrl);
    // Wider system fonts and user text spacing both change the measured label width.
    await page.evaluate(value=>{document.body.style.letterSpacing=value},spacing);
    await selectTurn(page);
    await holdSecondPress(page,'b6');
    const overlay=fan(page);
    const geometry=()=>overlay.evaluate(node=>{
      const controls=[...node.querySelectorAll<HTMLElement>('.training-fan-lens,.training-fan-feedback')].map(n=>({
        name:n.dataset.lens??'feedback',rect:n.getBoundingClientRect(),
      }));
      const words=[...document.querySelectorAll('#tokens .lexeme.selected')].flatMap(n=>[...n.getClientRects()]);
      const overlaps=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
      return {
        rows:new Set(words.map(r=>Math.round(r.top))).size,
        clipped:controls.filter(({rect:r})=>r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight).map(c=>c.name),
        covered:controls.filter(({rect},i)=>words.some(word=>overlaps(rect,word))||controls.slice(i+1).some(c=>overlaps(rect,c.rect))).map(c=>c.name),
        motion:node.getAnimations({subtree:true}).length,
      };
    });
    const initial=await geometry();
    expect(initial.rows).toBeGreaterThan(1);
    expect(initial).toMatchObject({clipped:[],covered:[],motion:0});
    for(const lens of ['meaning','wording','contrast','label']){
      const label=overlay.locator(`[data-lens="${lens}"]`);
      const box=(await label.boundingBox())!;
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await expect(label).toHaveAttribute('data-active','');
      expect(await geometry()).toMatchObject({clipped:[],covered:[],motion:0});
    }
    await page.keyboard.press('Escape');await page.mouse.up();
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('#tokens .selected')).toHaveCount(0);
  });
}

test('Escape and returning to the start cancel while quick double-click preserves native text selection',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await selectTurn(page);
  await holdSecondPress(page,'b3');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(fan(page)).toHaveCount(0);
  await expect(page.locator('#tokens .selected')).toHaveCount(0);
  const origin=await holdSecondPress(page,'b3');
  const target=(await fan(page).locator('[data-lens=meaning]').boundingBox())!;
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:4});
  await page.mouse.move(origin.x,origin.y,{steps:4});
  await expect(fan(page).locator('output')).toHaveText('Release to cancel');
  await page.mouse.up();
  await expect(panel(page)).toBeHidden();
  await word(page,'a4').dblclick();
  await expect.poll(()=>page.evaluate(()=>getSelection()?.toString().trim())).toBe('notice');
  await expect(fan(page)).toHaveCount(0);
});

test('keyboard and touch-sized controls can label an identical selected passage without dragging',async({page,practiceUrl})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(practiceUrl);
  await selectTurn(page);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('button',{name:'Language',exact:true})).toBeFocused();
  const trigger=page.getByRole('button',{name:'Training lenses',exact:true});
  // The toolbar uses native tabbable buttons after its first focused command.
  for(let i=0;i<12&&!await trigger.evaluate(node=>node===document.activeElement);i++)await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Training lenses'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Lens',exact:true})).toBeFocused();
  const bounds=(await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('combobox',{name:'Lens',exact:true}).selectOption('label');
  await expect(dialog.getByRole('combobox',{name:'Search reach'})).toBeHidden();
  await dialog.getByRole('button',{name:'Use lens'}).click();
  await expect(panel(page)).toHaveAttribute('data-mode','label');
  await expect(panel(page)).toHaveAttribute('data-limit','1');
  await expect(panel(page).locator('[data-training-seed]')).toContainText('I only heard after the meeting.');
});

test('a stationary touch opens and steers the fan without showing a context toolbar',async({page,practiceUrl,browserName})=>{
  test.skip(browserName!=='chromium','Uses Chromium touchscreen input.');
  await page.goto(practiceUrl);
  const text=word(page,'b3');
  const box=(await text.boundingBox())!;
  const finger={x:box.x+box.width/2,y:box.y+box.height/2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  await expect(fan(page)).toBeVisible();
  await expect(page.getByRole('toolbar',{name:'Selection tools'})).toBeHidden();
  const lens=(await fan(page).locator('[data-lens=label]').boundingBox())!;
  const endpoint={x:lens.x+lens.width/2,y:lens.y+lens.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[endpoint]});
  await expect(fan(page).locator('[data-lens=label]')).toHaveAttribute('data-active','');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(panel(page)).toHaveAttribute('data-mode','label');
  await expect(panel(page).locator('[data-training-seed]')).toContainText('heard');
});
