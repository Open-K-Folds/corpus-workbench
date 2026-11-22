import {expect,type Page} from '@playwright/test';
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

test('the fan keeps a wrapped selected passage readable at the edges of a phone viewport',async({page,practiceUrl})=>{
  await page.setViewportSize({width:320,height:568});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(practiceUrl);
  await selectTurn(page);
  await holdSecondPress(page,'b6');
  const geometry=await fan(page).evaluate(node=>{
    const controls=[...node.querySelectorAll('.training-fan-lens,.training-fan-feedback')].map(n=>n.getBoundingClientRect());
    const words=[...document.querySelectorAll('#tokens .lexeme.selected')].flatMap(n=>[...n.getClientRects()]);
    const overlaps=(a:DOMRect,b:DOMRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {
      rows:new Set(words.map(r=>Math.round(r.top))).size,
      inside:controls.every(rect=>rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight),
      readable:controls.every((rect,i)=>!words.some(word=>overlaps(rect,word))&&!controls.slice(i+1).some(other=>overlaps(rect,other))),
      motion:node.getAnimations({subtree:true}).length,
    };
  });
  expect(geometry.rows).toBeGreaterThan(1);
  expect(geometry).toMatchObject({inside:true,readable:true,motion:0});
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(fan(page)).toHaveCount(0);
  await expect(page.locator('#tokens .selected')).toHaveCount(0);
});

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
