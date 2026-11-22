import {expect, test, _electron as electron} from '@playwright/test';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executablePath = process.env.WB_ELECTRON_EXECUTABLE ??
  join(root, 'release/desktop/Open-K-Folds Workbench-win32-x64/Open-K-Folds Workbench.exe');
const evidence = process.env.WB_EVIDENCE_DIR ?? resolve(root, '../evidence/electron');

async function center(locator) {
  const {x, y, width, height} = await locator.boundingBox();
  return {x: x + width / 2, y: y + height / 2};
}

test('drag across words, move the pin and co-analyse the new passage', async () => {
  mkdirSync(evidence, {recursive: true});
  const env = {...process.env, WB_DESKTOP_USER_DATA: mkdtempSync(join(evidence, 'pin-profile-'))};
  delete env.WB_DESKTOP_PROJECT;
  delete env.WB_DESKTOP_STORE;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({executablePath, args: [], cwd: root, env});
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1160, 720));
    await page.getByRole('button', {name: /Start a new practice copy/}).click();
    const word = id => page.locator(`#tokens [data-token="${id}"] > .reading-text`);
    const tools = page.getByRole('toolbar', {name: 'Selection tools'});
    const pinned = () => page.locator('#tokens .passage-pinned').evaluateAll(nodes => nodes.map(n => n.dataset.token));
    const moveTo = async locator => {
      const target = await center(locator);
      await page.mouse.move(target.x, target.y, {steps: 8});
    };
    await expect(word('b2')).toBeVisible();
    await moveTo(word('b2'));
    await page.mouse.down();
    await moveTo(word('b4'));
    await expect(tools).toBeHidden();
    await page.mouse.up();
    await tools.getByRole('button', {name: 'Pin on canvas'}).click();
    await expect.poll(pinned).toEqual(['b2','b3','b4']);
    const handle = page.locator('.passage-pin-handle');
    await expect(handle).toHaveAccessibleName(/Pinned word “heard”/);
    await moveTo(handle);
    await page.mouse.down();
    await moveTo(word('c3'));
    await expect.poll(pinned).toEqual(['c2','c3','c4']);
    await expect(page.locator('.passage-pin-tether')).toBeVisible();
    await page.screenshot({path: join(evidence, 'drag-between-words.png')});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(pinned).toEqual(['b2','b3','b4']);
    await expect(page.locator('.passage-pin-tether')).toHaveCount(0);
    await moveTo(handle);
    await page.mouse.down();
    await moveTo(word('c3'));
    await page.mouse.up();
    await expect(handle).toHaveAccessibleName(/Pinned word “beforehand,”/);
    await handle.press('ArrowRight');
    await expect.poll(pinned).toEqual(['c3','c4','c5']);
    await page.screenshot({path: join(evidence, 'moved-passage.png')});
    await handle.press('Enter');
    await expect(tools.getByRole('button', {name:'Correct',exact:true})).toBeFocused();
    const analyse = tools.getByRole('button', {name:'Co-analyse selected tokens'});
    for (let i = 0; i < 8 && !(await analyse.evaluate(el => document.activeElement === el)); i++)
      await page.keyboard.press('Tab');
    await expect(analyse).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ca-source blockquote')).toHaveText('beforehand, from my');
    await expect(page.locator('.ca-source details')).toContainText('c3, c4, c5');
    expect(await page.evaluate(async () => (await (await fetch('/api/view')).json()).revision.id)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
