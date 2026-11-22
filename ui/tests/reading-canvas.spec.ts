import {expect, type Locator, type Page} from '@playwright/test';
import {test} from './practice-fixture';

const launcher = (page: Page) => page.getByRole('button', {name: 'Open reading canvas'});
const token = (page: Page, id: string) => page.locator(`#tokens [data-token="${id}"] .reading-text`);
const head = (page: Page) => page.evaluate(async () => (await (await fetch('/api/view')).json()).revision);
const fontSize = (element: Locator) => element.evaluate(node => parseFloat(getComputedStyle(node).fontSize));

async function nativeSelection(page: Page, from: string, to: string) {
  const first = token(page, from), last = token(page, to);
  await first.scrollIntoViewIfNeeded();
  await last.scrollIntoViewIfNeeded();
  const start = (await first.boundingBox())!, end = (await last.boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {steps: 12});
  await page.mouse.up();
  await expect(page.getByRole('toolbar', {name: 'Selection tools'})).toBeVisible();
}

test('the standard stage steers with the dock and the handle attached to the current source turn', async ({page, practiceUrl}) => {
  await page.goto(practiceUrl);
  const dock = page.getByRole('navigation', {name:'Reading canvas controls'});
  const position = dock.locator('#canvas-position');
  await expect(dock).toBeVisible();
  await expect(position).toHaveText('Turn 1 of 3');
  const before = await head(page);
  const size = await fontSize(token(page,'a1'));
  await dock.getByRole('button', {name:'Increase text size'}).click();
  await expect.poll(() => fontSize(token(page,'a1'))).toBeGreaterThan(size);
  await dock.getByRole('button', {name:'Next source turn'}).click();
  await expect(position).toHaveText('Turn 2 of 3');
  const handle = page.getByRole('button', {name:/^Steer source turn/});
  const grip = (await handle.boundingBox())!;
  const x = grip.x+grip.width/2, y = grip.y+grip.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+30,{steps:7});
  await page.mouse.up();
  await expect(position).toHaveText('Turn 3 of 3');
  await expect(handle).toBeFocused();
  await handle.press('ArrowUp');
  await expect(position).toHaveText('Turn 2 of 3');
  await expect(page.locator('[data-canvas-current]')).toContainText('only heard after');
  await handle.press('Home');
  await expect(position).toHaveText('Turn 1 of 3');
  await expect(page.getByRole('button',{name:'Next match',exact:true})).toBeVisible();
  expect(await head(page)).toEqual(before);
});

test('canvas navigation and sizing preserve a live source selection for co-analysis', async ({page, practiceUrl}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(practiceUrl);
  await expect(token(page, 'a1')).toBeVisible();
  const initial = await head(page);
  const source = await token(page, 'b2').elementHandle();
  await launcher(page).click();
  const tools = page.locator('#canvas-tools');
  await expect(tools).toBeVisible();
  await expect(page.locator('#canvas-position')).toContainText('1 of 3');
  await expect(page.getByRole('button', {name: 'Previous source turn'})).toBeDisabled();
  await page.getByRole('button', {name: 'Next source turn'}).click();
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  await expect(token(page, 'b2')).toBeInViewport();
  const firstSize = await fontSize(token(page, 'b2'));
  await page.getByRole('button', {name: 'Increase text size'}).click();
  await expect.poll(() => fontSize(token(page, 'b2'))).toBeGreaterThan(firstSize);
  await page.getByRole('button', {name: 'Decrease text size'}).click();
  await expect.poll(() => fontSize(token(page, 'b2'))).toBe(firstSize);
  await expect(page.locator('#canvas-scale')).toHaveText('100%');
  const scrub = page.getByRole('slider', {name: 'Scrub source turns'});
  await scrub.focus();
  await scrub.press('End');
  await expect(page.locator('#canvas-position')).toContainText('3 of 3');
  await expect(page.getByRole('button', {name: 'Next source turn'})).toBeDisabled();
  await expect(token(page, 'c6')).toBeInViewport();
  await scrub.press('ArrowLeft');
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  const pane = page.locator('.transcript');
  const beforePan = await pane.evaluate(node => node.scrollTop);
  const margin = (await pane.boundingBox())!;
  const x = margin.x + 5, y = margin.y + margin.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 110, {steps: 8});
  await page.mouse.up();
  await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeGreaterThan(beforePan + 60);
  await scrub.focus();
  await scrub.press('Home');
  await scrub.press('ArrowRight');
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  expect(await source!.evaluate(node => node === document.querySelector('#tokens [data-token="b2"] .reading-text'))).toBe(true);
  await nativeSelection(page, 'b2', 'b4');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('only heard after');
  await info.attach('Reading canvas with native selection', {body: await page.screenshot(), contentType: 'image/png'});
  await page.getByRole('button', {name: 'Co-analyse selected tokens'}).click();
  await expect(page.getByRole('button',{name:'Exit reading canvas'})).toBeHidden();
  await expect(tools).toBeVisible();
  await expect(page.locator('.ca-source blockquote')).toHaveText('only heard after');
  await expect(page.locator('.ca-source details')).toContainText('b2, b3, b4');
  expect(await head(page)).toEqual(initial);
  expect(errors).toEqual([]);
});

test('canvas controls fit a phone and a correction draft stays attached to its token', async ({page, practiceUrl}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(practiceUrl);
  const open = launcher(page);
  await open.focus();
  await open.press('Enter');
  const tools = page.locator('#canvas-tools');
  await expect(tools).toBeVisible();
  await expect(page.locator('#canvas-position')).toContainText('1 of 3');
  const geometry = await page.evaluate(() => {
    const bounds = [...document.querySelectorAll<HTMLElement>('#canvas-tools :is(button,input)')]
      .filter(el => el.getClientRects().length)
      .map(el => el.getBoundingClientRect());
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      controlsFit: bounds.every(box => box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight),
    };
  });
  expect(geometry).toEqual({pageFits: true, controlsFit: true});
  await info.attach('Reading canvas at 390 pixels', {body: await page.screenshot(), contentType: 'image/png'});
  const exit = page.getByRole('button', {name: 'Exit reading canvas'});
  await exit.focus();
  await exit.press('Escape');
  await expect(exit).toBeHidden();
  await expect(tools).toBeVisible();
  await expect(open).toBeFocused();
  await open.press('Enter');
  await nativeSelection(page, 'a4', 'a4');
  await page.getByRole('button', {name: 'Correct', exact: true}).click();
  const input = page.getByRole('textbox', {name: 'Proposed correction'});
  await input.fill('poster');
  await input.press('Escape');
  await expect(input).toHaveValue('poster');
  expect((await head(page)).id).toBe(1);
  await page.getByRole('button', {name: 'Undo draft'}).click();
  await expect(input).toHaveCount(0);
  await expect(token(page, 'a4')).toHaveText('notice');
  expect((await head(page)).id).toBe(1);
});
