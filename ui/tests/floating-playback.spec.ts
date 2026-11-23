import {expect, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {test} from './practice-fixture';

test.use({practicePackage:resolve('../fixtures/spoken-reading'), contextOptions:{reducedMotion:'reduce'}});

const word = (page: Page, id: string) => page.locator(`#tokens [data-token="${id}"] .reading-text`);

test('a dragged passage can be heard at its saved times and opened for co-analysis from the dock', async ({page, practiceUrl}) => {
  await page.goto(practiceUrl);
  const dock = page.getByRole('navigation', {name:'Reading canvas controls'});
  const surface = dock.locator('.canvas-console');
  const context = dock.locator('#canvas-passage-context');
  await expect(surface).toBeVisible();
  await expect(dock.locator('#canvas-play')).toBeVisible();
  await expect(page.locator('#audio-play')).toBeHidden();
  await expect(page.getByRole('slider', {name:'Seek recording', exact:true})).toBeVisible();
  await expect(context).toBeHidden();
  const finish = await surface.evaluate(node => {
    const style = getComputedStyle(node);
    return {radius:parseFloat(style.borderBottomLeftRadius), shadow:style.boxShadow, background:style.backgroundColor};
  });
  expect(finish.radius).toBeGreaterThan(0);
  expect(finish.shadow).not.toBe('none');
  expect(finish.background).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);

  const first = word(page, 'w1-4'), last = word(page, 'w1-5');
  await first.scrollIntoViewIfNeeded();
  const start = (await first.boundingBox())!, end = (await last.boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {steps:12});
  await page.mouse.up();

  await expect(context.locator('.canvas-passage-excerpt')).toContainText('librarian opens');
  const listen = dock.locator('#dock-listen-passage');
  await expect(listen).toHaveAccessibleName(/listen|play/i);
  await expect(listen).toBeEnabled();
  const audio = page.locator('#audio');
  // Record the native media clock at play, before polling could miss this short phrase.
  const [startedAt] = await Promise.all([
    audio.evaluate((element: HTMLAudioElement) => new Promise<number>(done =>
      element.addEventListener('play', () => done(element.currentTime), {once:true}))),
    listen.click(),
  ]);
  expect(startedAt).toBeCloseTo(.945, 1);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused && Math.abs(element.currentTime - 2.135) < .025)).toBe(true);

  await page.getByRole('button', {name:'Play from selection', exact:true}).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 2.2)).toBe(true);
  await dock.locator('#canvas-play').click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);

  const analyze = dock.locator('#dock-analyze-passage');
  await expect(analyze).toHaveAccessibleName(/analy[sz]/i);
  await analyze.click();
  const source = page.locator('.coanalysis .ca-source');
  await expect(source.locator('blockquote')).toHaveText('librarian opens');
  await expect(source.locator('details')).toContainText('w1-4, w1-5');
});

test.describe('touch passage controls', () => {
  test.use({hasTouch:true, isMobile:true});

  for (const width of [320, 390]) {
    test(`at ${width}px the contextual controls fit beside the reading rail and dismiss in place`, async ({page, practiceUrl}) => {
      await page.setViewportSize({width, height:780});
      await page.goto(practiceUrl);
      const pane = page.locator('.transcript');
      const token = word(page, 'w5-4');
      await token.evaluate(node => node.scrollIntoView({block:'center',behavior:'instant'}));
      await token.tap();
      const dock = page.locator('#canvas-tools');
      const context = dock.locator('#canvas-passage-context');
      await expect(context.locator('.canvas-passage-excerpt')).toContainText('twice');

      for (const id of ['dock-listen-passage', 'dock-analyze-passage']) {
        const action = dock.locator('#' + id);
        await expect(action).toBeInViewport({ratio:1});
        const box = (await action.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(await action.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        })).toBe(true);
      }
      const body = (await dock.locator('.canvas-console').boundingBox())!, reading = (await pane.boundingBox())!;
      expect(body.x).toBeGreaterThan(reading.x);
      expect(body.x + body.width).toBeLessThan(reading.x + reading.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const prior = await pane.evaluate(node => node.scrollTop);
      await page.keyboard.press('Escape');
      await expect(context).toBeHidden();
      await expect(page.locator('#tokens .lexeme.selected')).toHaveCount(0);
      expect(Math.abs(await pane.evaluate(node => node.scrollTop) - prior)).toBeLessThanOrEqual(2);
      await expect(dock.locator('#canvas-play')).toBeInViewport();
    });
  }
});
