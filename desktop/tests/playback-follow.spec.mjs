import {expect, test, _electron as electron} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const evidence = process.env.WB_EVIDENCE_DIR ?? resolve(root, '../evidence/electron');
const executablePath = process.env.WB_ELECTRON_EXECUTABLE ??
  join(root, 'release/desktop/Open-K-Folds Workbench-win32-x64/Open-K-Folds Workbench.exe');
const backend = join(dirname(executablePath), 'resources/backend/corpus-workbench.exe');

test('the canvas follows spoken words, marks a turn-only interval and clears during silence', async () => {
  mkdirSync(evidence, {recursive:true});
  const work = mkdtempSync(join(evidence, 'spoken-reading-'));
  const env = {...process.env, WB_DESKTOP_USER_DATA:join(work, 'profile'),
    WB_DESKTOP_STORE:join(work, 'authority'), WB_DESKTOP_PROJECT:'spoken-reading'};
  delete env.WB_DESKTOP_BACKEND;
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(backend, ['import', '--store', env.WB_DESKTOP_STORE, '--project', env.WB_DESKTOP_PROJECT,
    '--package', join(root, 'fixtures/spoken-reading')], {windowsHide:true});
  const app = await electron.launch({executablePath, cwd:root, args:[], env});
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1160, 720));
    await expect(page.locator('#document-title')).toHaveText('The library map');
    const audio = page.locator('#audio');
    const play = page.locator('#canvas-play');
    const follow = page.getByRole('button', {name:'Follow audio', exact:true});
    const word = page.locator('.lexeme[data-playback-word]');
    const turn = page.locator('.reading-block[data-playback-turn]');
    const caret = page.locator('.playback-caret');
    const time = () => audio.evaluate(media => media.currentTime);
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await expect(play).toBeEnabled();
    await play.click();
    await expect.poll(time).toBeGreaterThan(0.1);
    await expect(word).toHaveAttribute('data-token', 'w1-4', {timeout:5000});
    await expect(caret).toBeVisible();
    await play.click();
    expect(await audio.evaluate(media => media.paused)).toBe(true);
    const pausedAt = await time();
    await expect(play).toBeFocused();

    // Seek through the real recording controls. Each right arrow on the
    // waveform advances by a second, regardless of the current zoom or width.
    await page.locator('#timeline-resizer').focus();
    await page.keyboard.press('End');
    const waveform = page.getByRole('slider', {name:'Seek recording on waveform', exact:true});
    await expect(waveform).toBeVisible();
    expect(await time()).toBe(pausedAt);
    async function seek(seconds) {
      await waveform.focus();
      await page.keyboard.press('Home');
      for (let step = 0; step < seconds; step++) await page.keyboard.press('ArrowRight');
      await expect.poll(time).toBeCloseTo(seconds, 2);
    }
    await seek(1);
    await expect(word).toHaveText('librarian');
    await expect(caret).toBeVisible();
    await expect.poll(() => word.evaluate(node => {
      const text = node.querySelector('.reading-text').getClientRects()[0];
      const marker = document.querySelector('.playback-caret').getBoundingClientRect();
      return Math.abs(marker.left - text.left) <= 3 && Math.abs(marker.top - text.top) <= 2;
    })).toBe(true);
    await expect(waveform).toBeFocused();
    await page.screenshot({path:join(evidence, 'spoken-word.png')});
    await page.locator('.reading-block[data-utterance="u1"]').screenshot({path:join(evidence,'spoken-word-detail.png')});

    await seek(3);
    await expect(word).toHaveCount(0);
    await expect(turn).toHaveCount(0);
    await expect(caret).toBeHidden();
    await seek(14);
    await expect(turn).toHaveAttribute('data-utterance', 'u4');
    await expect(word).toHaveCount(0);
    await expect(caret).toBeHidden();
    await page.screenshot({path:join(evidence, 'spoken-turn.png')});

    const pane = page.locator('.transcript');
    const box = await pane.boundingBox();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
    await page.mouse.wheel(0, 380);
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await seek(1);
    await expect(word).toHaveText('librarian');
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await expect(word).toBeInViewport();
    expect(await page.evaluate(async () => (await (await fetch('/api/view')).json()).revision.id)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
