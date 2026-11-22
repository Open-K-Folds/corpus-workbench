import {expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {test} from './practice-fixture';

test('a model reply becomes a revision-bound annotation only after human assessment', async ({page, practiceUrl}) => {
  const base = new URL(practiceUrl).origin;
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base + '/')) external.push(request.url()); });
  await page.goto(practiceUrl);
  await expect(page).toHaveTitle('Corpus workbench');
  await page.locator('#rail-coanalysis').click();
  await expect(page.locator('.coanalysis')).toContainText('Select a word');
  await page.locator('[data-token="a7"]').click();
  await page.locator('[data-token="b2"]').click({modifiers: ['Shift']});
  const panel = page.locator('.coanalysis');
  await expect(panel.locator('.ca-excerpt')).toHaveCount(2);
  await expect(panel.locator('.ca-excerpt').first()).toContainText('turn-1');
  await expect(panel.locator('.ca-excerpt').last()).toContainText('turn-2');
  const firstReading = '  I first thought the notice reached everyone.\nCheck the second speaker.  ';
  await panel.getByLabel('Your first reading (optional)').fill(firstReading);
  const lenses = panel.getByRole('group', {name: 'Analytical lens'});
  await expect(lenses.getByRole('radio')).toHaveCount(3);
  await lenses.getByRole('radio', {name: 'Language in context'}).check();
  await lenses.getByRole('radio', {name: 'Language in context'}).press('ArrowRight');
  await expect(lenses.getByRole('radio', {name: 'Follow-up questions'})).toBeChecked();
  const question = panel.getByLabel('Research question');
  await question.fill(await question.inputValue() + ' Cite a source token.');
  const prompt = await panel.getByLabel('Exact model prompt').inputValue();
  expect(prompt).toContain('what is being inferred');
  expect(prompt).toContain('Cite a source token.');
  expect(prompt).not.toContain('notice reached everyone');
  await panel.getByLabel('Model name or version').fill('practice-model-v1');
  const proposal = 'Ask who heard the notice [a7, b2]. <b>literal</b>';
  await panel.getByLabel('Model reply').fill(proposal);
  await panel.getByRole('button', {name: 'Review this reply'}).click();
  await expect(panel.getByRole('heading', {name: 'Compare readings'})).toBeFocused();
  await expect(panel.locator('[data-proposal]')).toHaveText(proposal);
  expect(await panel.locator('[data-initial-text]').textContent()).toBe(firstReading);
  await expect(panel.getByText('Recorded before opening the proposal here.')).toBeVisible();
  await expect(panel.locator('[data-proposal] b')).toHaveCount(0);
  const save = panel.getByRole('button', {name: 'Save reviewed annotation'});
  await expect(save).toBeDisabled();
  const head = () => page.evaluate(async () => (await fetch('/api/view')).json());
  expect((await head()).revision.id).toBe(1);
  await page.locator('[data-token="c1"]').click();
  await expect(panel.locator('.ca-excerpt').first()).toContainText('board.');
  await panel.getByLabel('Your assessment').selectOption('Needs more context');
  await panel.getByLabel('Your interpretation').fill('The boundary splits two utterances. Ask who had access.');
  // An interrupted response can hide a successful write. Retry the original command only.
  await page.route('**/api/command', async route => { await route.fetch(); await route.abort(); }, {times: 1});
  await save.click();
  await page.getByRole('button', {name: 'Resolve original save'}).click();
  await expect(page.locator('#save-state')).toContainText('Saved R2');
  const saved = await head(), span = saved.documents[0].spans[0];
  expect(saved.approved).toBe(false);
  expect(span.token_ids).toEqual(['a7', 'b1', 'b2']);
  expect(JSON.parse(span.fields.note)).toMatchObject({model: 'practice-model-v1', proposal, first_reading: firstReading, prompt, method: 'manual', revision: 1,
    decision: 'Needs more context', interpretation: 'The boundary splits two utterances. Ask who had access.'});
  expect(JSON.parse(span.fields.note).prompt).toContain('"utterance":"turn-2"');
  await page.reload();
  await page.locator('#rail-coanalysis').click();
  await panel.locator('.ca-saved > summary').click();
  await expect(panel.locator('.ca-saved')).toContainText('The boundary splits two utterances.');
  expect(await panel.locator('.ca-saved p').allTextContents()).toContain(firstReading);
  await page.getByRole('button', {name: 'Export complete package'}).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', {name: 'Download complete package'}).click();
  const file = await (await downloadEvent).path();
  const readNote = [
    'import json,sys,zipfile,xml.etree.ElementTree as E',
    'with zipfile.ZipFile(sys.argv[1]) as package:',
    '  span=E.fromstring(package.read(sys.argv[2])).find(".//*[@id=\'" + sys.argv[3] + "\']")',
    '  print(json.dumps(json.loads(span.attrib["note"])))',
  ].join('\n');
  const exported = JSON.parse(execFileSync('python', ['-c', readNote, file!, span.sidecar, span.id], {encoding: 'utf8'}));
  expect(exported).toEqual(JSON.parse(span.fields.note));
  await page.locator('[data-token="c1"]').click();
  await panel.getByLabel('Model name or version').fill('practice-model-v1');
  await panel.getByLabel('Model reply').fill('Uncertain.');
  await panel.getByRole('button', {name: 'Review this reply'}).click();
  await panel.getByLabel('Your assessment').selectOption('Disagree');
  await panel.getByLabel('Your interpretation').fill('More detail needed.');
  // Here the request is lost before the authority sees it. A second writer advances the head.
  await page.route('**/api/command', route => route.abort(), {times: 1});
  await save.click();
  await expect(page.getByRole('button', {name: 'Resolve original save'})).toBeVisible();
  await page.evaluate(async () => {
    const view = await (await fetch('/api/view')).json();
    const response = await fetch('/api/command', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-WB-CSRF': sessionStorage.getItem('wb-csrf')!},
      body: JSON.stringify({schema: 1, project: view.snapshot.project, command_id: 'concurrent-update', base_revision: view.revision.id, preimage_hash: view.revision.snapshot_hash,
        config_version: view.snapshot.config.version, label: 'Synthetic concurrent correction', operations: [{kind: 'set_token', document: view.documents[0].path, token: 'c1', fields: {nform: 'We'}}]})});
    if (!response.ok) throw new Error(await response.text());
  });
  await page.getByRole('button', {name: 'Resolve original save'}).click();
  await expect(panel.getByRole('status')).toContainText('older revision');
  await expect(save).toBeDisabled();
  await expect(page.locator('#reapply-conflict')).toHaveCount(0);
  expect((await head()).documents[0].spans).toHaveLength(1);
  await panel.getByRole('button', {name: 'Discard co-analysis draft'}).click();
  await expect(page.locator('#save-state')).toContainText('Saved R3');
  await expect(panel.locator('.ca-excerpt')).toContainText('We');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
