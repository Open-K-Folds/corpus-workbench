import {expect, test as base} from '@playwright/test';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

// Each test gets an independent native authority on an OS-assigned loopback port.
export const test = base.extend<{practiceUrl: string}>({
  practiceUrl: async ({}, use) => {
    const root = resolve('..'), run = mkdtempSync(resolve(tmpdir(), 'wb-practice-'));
    const binary = process.env.WB_BINARY ?? resolve(root, 'target/debug/corpus-workbench' + (process.platform === 'win32' ? '.exe' : ''));
    const args = ['--store', resolve(run, 'authority'), '--project', 'coanalysis-practice'];
    execFileSync(binary, ['import', ...args, '--package', resolve(root, 'fixtures/coanalysis')]);
    const service = spawn(binary, ['serve', ...args, '--ui', process.env.WB_UI ?? resolve(root, 'ui/dist'), '--port', '0'], {cwd: run, stdio: 'pipe'});
    try {
      const launcher = resolve(run, '.runtime/Open-Workbench.html');
      await expect.poll(() => existsSync(launcher)).toBe(true);
      const baseUrl = readFileSync(launcher, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+/)![0];
      await use(baseUrl + '/#session=' + readFileSync(resolve(run, '.runtime/session-code'), 'utf8'));
    } finally {
      if (service.exitCode === null && service.signalCode === null) {
        const exited = new Promise<void>(done => service.once('exit', () => done()));
        service.kill();
        await exited;
      }
    }
  },
});
