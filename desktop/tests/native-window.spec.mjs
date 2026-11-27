import {test, expect, _electron as electron} from '@playwright/test';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {symbols} from '../../ui/src/icons.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const invoke = promisify(execFile);
const packaged = join(root, 'release/desktop/Open-K-Folds Workbench-win32-x64/Open-K-Folds Workbench.exe');
const nativeControl = (script, ...args) => invoke('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
  join(root, 'desktop/tests', script), ...args.map(String),
], {windowsHide: true, timeout: 30000});
const nativeButton = (handle, button) => nativeControl('native-caption.ps1', handle, button);

test('Windows caption buttons, keyboard menus and appearance work on the desktop', async ({}, testInfo) => {
  test.setTimeout(180000);
  test.skip(process.platform !== 'win32', 'Windows UI Automation exercises the integrated Windows frame');
  const installed = process.env.WB_ELECTRON_EXECUTABLE || (existsSync(packaged) && packaged);
  const executablePath = installed || createRequire(import.meta.url)('electron');
  const env = {...process.env, WB_DESKTOP_USER_DATA: testInfo.outputPath('profile')};
  mkdirSync(env.WB_DESKTOP_USER_DATA, {recursive: true});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WB_DESKTOP_STORE;
  delete env.WB_DESKTOP_PROJECT;
  const application = await electron.launch({executablePath, args: installed ? ['--lang=en-US'] : [root, '--lang=en-US'], cwd: root, env});
  let closed = false;
  try {
    const page = await application.firstWindow();
    await expect(page.locator('#desktop-open')).toBeVisible();
    const handle = await application.evaluate(({app, BrowserWindow}) => {
      app.setAccessibilitySupportEnabled(true);
      const window = BrowserWindow.getAllWindows()[0];
      window.focus();
      return window.getNativeWindowHandle().readUInt32LE(0);
    });
    const geometry = () => page.evaluate(() => {
      const overlay = navigator.windowControlsOverlay;
      const rect = overlay.getTitlebarAreaRect();
      return {visible: overlay.visible, top: rect.top, height: rect.height, reserved: innerWidth - rect.right};
    });
    expect(await geometry()).toMatchObject({visible: true, top: 0, height: 40});
    expect((await geometry()).reserved).toBeGreaterThan(0);

    await nativeButton(handle, 'Maximize');
    await expect.poll(() => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
    await nativeButton(handle, 'Restore');
    await expect.poll(() => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
    await nativeButton(handle, 'Minimize');
    await expect.poll(() => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await application.evaluate(({BrowserWindow}) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); });

    const menus = [['F10', ['File', 'Edit', 'View', 'Help']], ['F', ['Open existing workbench', 'Import TEITOK package', 'Save verified backup']],
      ['E', ['Undo']], ['V', ['Revision history']], ['H', ['Corpus workflow and research handoff']]];
    for (const [keyCode, expected] of menus) {
      await application.evaluate(({BrowserWindow}, keyCode) => {
        const contents = BrowserWindow.getAllWindows()[0].webContents;
        contents.focus();
        for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({type, keyCode, modifiers: keyCode === 'F10' ? [] : ['alt']});
      }, keyCode);
      const {stdout} = await nativeControl('native-menu.ps1', handle);
      const items = JSON.parse(stdout);
      for (const name of expected) expect(items.some(item => item.startsWith(name))).toBe(true);
    }

    await page.locator('#desktop-demo').click();
    await expect(page.locator('[data-token]').first()).toBeVisible();
    expect(await geometry()).toMatchObject({visible: true, top: 0, height: 40});
    await page.evaluate(() => document.fonts.ready);
    const missing = await page.evaluate(names => {
      const span = document.createElement('span');
      span.className = 'material-symbol';
      document.body.append(span);
      const size = parseFloat(getComputedStyle(span).fontSize);
      const missing = names.filter(name => {
        span.textContent = name;
        return Math.abs(span.getBoundingClientRect().width - size) > 0.1;
      });
      span.remove();
      return missing;
    }, symbols);
    expect(missing).toEqual([]);

    for (const [theme, background] of [['dark', '#101411'], ['light', '#f1f3ec']]) {
      await page.evaluate(theme => window.workbenchDesktop.reportAppearance(theme), theme);
      await expect.poll(() => application.evaluate(({BrowserWindow, nativeTheme, systemPreferences}, background) => {
        const expected = nativeTheme.inForcedColorsMode ? systemPreferences.getColor('window') : background;
        return BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase() === expected.toLowerCase();
      }, background)).toBe(true);
    }

    const exit = application.waitForEvent('close');
    await nativeButton(handle, 'Close');
    await exit;
    closed = true;
  } finally {
    if (!closed) await application.close();
  }
});
