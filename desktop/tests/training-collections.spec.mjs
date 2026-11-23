import {expect, test, _electron as electron} from '@playwright/test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const executablePath = process.env.WB_ELECTRON_EXECUTABLE ?? join(root, 'release/desktop/Open-K-Folds Workbench-win32-x64/Open-K-Folds Workbench.exe');
const evidence = process.env.WB_EVIDENCE_DIR ?? resolve(root, '../evidence/electron');

async function launch(profile) {
  const env = {...process.env, WB_DESKTOP_USER_DATA: profile};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WB_DESKTOP_STORE;
  delete env.WB_DESKTOP_PROJECT;
  const app = await electron.launch({executablePath, cwd: root, args: [], env});
  const page = await app.firstWindow();
  page.on('dialog', dialog => {void dialog.accept().catch(() => {});});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
  return {app, page};
}

test('packaged practice corpus retains reviewed pairs and passage labels after relaunch and exports their source words', async ({}, info) => {
  test.setTimeout(210000);
  mkdirSync(evidence, {recursive: true});
  const work = mkdtempSync(join(evidence, 'training-')), profile = join(work, 'profile');
  const collection = 'Timing and access', note = 'Learning when a meeting happened differs from arriving there.';
  const sourceWords = 'I only heard after the meeting.', comparisonWords = 'I got there after the meeting.';
  const errors = [];
  let app, page;
  try {
    ({app, page} = await launch(profile));
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', {name: /Start a new practice copy/}).click();
    await expect(page.locator('#document-title')).toHaveText('Who gets the notice?');
    await page.locator('[data-token="b1"]').click();
    await page.locator('[data-token="b6"]').click({modifiers: ['Shift']});
    await page.locator('#rail-training').click();
    let panel = page.locator('#training-panel');
    await panel.getByRole('radio', {name: 'Easy to confuse'}).check();
    await panel.getByText('Refine search', {exact:true}).click();
    await panel.getByLabel('Find words in the corpus').fill('got there');
    await panel.getByRole('button', {name: 'Find passages'}).click();
    await expect(panel.locator('blockquote')).toHaveText([sourceWords, comparisonWords]);
    await panel.locator('summary').filter({hasText: 'Model second reading'}).click();
    if (process.env.WB_TRAINING_MODEL === '1') {
      await panel.getByRole('button', {name: 'Ask local model'}).click();
    } else {
      await panel.getByLabel('Model name').fill('practice review model');
      await panel.getByLabel('Model proposal').fill('Compare the actions in both passages.');
      await panel.getByRole('button', {name: 'Attach model reading'}).click();
    }
    await expect(panel.locator('[data-model-status]')).toContainText('Model reading attached', {timeout: 130000});
    const model = await panel.getByLabel('Model name').inputValue();
    const reply = await panel.getByLabel('Model proposal').inputValue();
    expect(model.trim()).not.toBe('');
    expect(reply.trim()).not.toBe('');
    info.annotations.push({type: 'model source', description: (process.env.WB_TRAINING_MODEL === '1' ? 'Local llama.cpp · ' : 'Manual · ') + model});
    await expect(panel.getByLabel('Relationship')).toHaveValue('');
    expect(await page.evaluate(async () => (await (await fetch('/api/view')).json()).revision.id)).toBe(1);
    await panel.getByLabel('Collection name').fill(collection);
    await panel.getByLabel('Relationship').fill('Different');
    await panel.getByLabel('Review note (optional)').fill(note);
    await panel.getByRole('button', {name: 'Save reviewed example'}).click();
    await expect(page.locator('#save-state')).toContainText('Saved R2');

    await panel.getByRole('radio', {name: 'Label a passage'}).check();
    await panel.getByLabel('Passage label').fill('Reported experience');
    await panel.getByRole('button', {name: 'Save reviewed example'}).click();
    await expect(page.locator('#save-state')).toContainText('Saved R3');
    // A public relaunch must reopen the same authority and leave its reviews usable.
    await app.close();
    app = null;
    ({app, page} = await launch(profile));
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#save-state')).toContainText('Saved R3');
    await page.locator('#rail-training').click();
    panel = page.locator('#training-panel');
    await panel.getByRole('button', {name: 'Saved collections'}).click();
    await expect(panel.getByRole('combobox', {name: 'Saved collection', exact: true})).toHaveValue(collection);
    await expect(panel.locator('.training-counts')).toContainText('2 reviewed');
    await expect(panel.locator('.training-counts')).toContainText('2 identified utterance');
    await expect(panel.locator('.training-counts')).toContainText('2 document-scoped speaker');
    await panel.locator('.training-record > summary').filter({hasText: 'Different'}).click();
    await expect(panel.locator('.training-record[open] blockquote')).toHaveText([sourceWords, comparisonWords]);
    await expect(panel.locator('.training-record[open]')).toContainText(note);
    await page.screenshot({path: join(work, 'reopened-collection.png')});
    await info.attach('Reopened collection', {path: join(work, 'reopened-collection.png'), contentType: 'image/png'});

    const destination = join(work, 'reviewed.jsonl');
    await app.evaluate(({BrowserWindow}, file) => {
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_, item) => {
        item.setSavePath(file);
        item.once('done', (_event, state) => {globalThis.trainingDownload = {state, suggestedName: item.getFilename()};});
      });
    }, destination);
    await panel.getByRole('button', {name: 'Export reviewed JSONL'}).click();
    await expect.poll(() => app.evaluate(() => globalThis.trainingDownload)).toEqual({state: 'completed', suggestedName: 'training-Timing-and-access-r3.jsonl'});
    const rows = readFileSync(destination, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(2);
    const pair = rows.find(row => row.kind === 'pair');
    expect(pair).toMatchObject({collection, label: 'Different', lens: 'contrast', note, discovery: 'manual text search',
      reviewer: 'local-owner', seed: {document: 'xmlfiles/noticeboard.xml', quote: sourceWords, speaker: 'B', revision: 1,
        tokenIds: ['b1','b2','b3','b4','b5','b6']},
      candidate: {document: 'xmlfiles/second-interview.xml', quote: comparisonWords, speaker: 'C', revision: 1,
        tokenIds: ['g1','g2','g3','g4','g5','g6']},
      assistance: {model, reply}, exportedFrom: {revision: 3}});
    expect(pair.assistance.prompt).toContain('"id":"b3","text":"heard"');
    expect(pair.assistance.prompt).toContain('"id":"g3","text":"there"');
    expect(pair.seed.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pair.candidate.snapshotHash).toBe(pair.seed.snapshotHash);
    expect(rows.find(row => row.kind === 'classification')).toMatchObject({collection, candidate: null,
      label: 'Reported experience', seed: {quote: sourceWords, revision: 2}});
    expect(errors).toEqual([]);
  } finally {
    if (app) {
      // Permit shutdown if an assertion leaves a form dirty on the disposable test profile.
      await app.evaluate(({dialog}) => {dialog.showMessageBox = async () => ({response: 1});}).catch(() => {});
      await app.close().catch(() => {});
    }
  }
  expect(existsSync(join(work, 'reviewed.jsonl'))).toBe(true);
});
