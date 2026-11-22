import {expect, type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {test} from './practice-fixture';

const seedQuote = 'I only heard after the meeting.';
const equivalent = 'By the time I found out, it was already over.';
const nearMiss = 'I got there after the meeting.';
const seedIds = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const collection = 'Notice study';
const panel = (page: Page) => page.locator('#training-panel');
const head = (page: Page) => page.evaluate(async () => (await fetch('/api/view')).json());

async function chooseSeed(page: Page, first: string, last: string) {
  await page.locator('#rail-reading').click();
  await page.locator(`#tokens [data-token="${first}"]`).click();
  if (first !== last) await page.locator(`#tokens [data-token="${last}"]`).click({modifiers: ['Shift']});
  await page.locator('#rail-training').click();
}

async function saveReview(page: Page, field: string, label: string, revision: number) {
  const trainer = panel(page);
  await trainer.getByLabel('Collection name').fill(collection);
  await trainer.getByLabel(field, {exact: true}).fill(label);
  await trainer.getByRole('button', {name: 'Save reviewed example'}).click();
  await expect(page.locator('#save-state')).toContainText(`Saved R${revision}`);
}

test('the canvas comparison can become a reviewed paraphrase without moving the source selection',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await chooseSeed(page,'b1','b6');
  await panel(page).getByRole('radio',{name:'Same meaning'}).check();
  const strip=page.getByRole('region',{name:'Compare with selected transcript'});
  await expect(strip.locator('blockquote')).toHaveText(nearMiss);
  await strip.getByRole('button',{name:'Next comparison'}).click();
  await expect(strip.locator('blockquote')).toHaveText(equivalent);
  await expect(panel(page).locator('[data-training-seed] blockquote')).toHaveText(seedQuote);
  await strip.getByRole('button',{name:'Review example'}).click();
  await expect(panel(page).getByLabel('Relationship',{exact:true})).toBeFocused();
  await saveReview(page,'Relationship','Same meaning',2);
  const view=await head(page);
  const record=JSON.parse(view.documents[0].spans[0].fields.note);
  expect(record).toMatchObject({label:'Same meaning',seed:{quote:seedQuote},candidate:{quote:equivalent}});
  await panel(page).getByRole('button',{name:'Saved collections'}).click();
  await expect(strip).toBeHidden();
});

test('a reviewed pair, negative pair and passage label survive reload and export with their original anchors', async ({page, practiceUrl}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(practiceUrl);
  const trainer = panel(page);
  await page.locator('#rail-training').click();
  await expect(trainer).toContainText('Select words within one transcript passage');
  await chooseSeed(page, 'b1', 'b6');
  await expect(trainer.locator('[data-training-seed] blockquote')).toHaveText(seedQuote);
  await trainer.getByRole('radio', {name: 'Same meaning'}).check();
  const choices = trainer.getByRole('combobox', {name: 'Comparison passage'});
  const options = await choices.locator('option').allTextContents();
  expect(options[0]).toContain(nearMiss);
  expect(options[1]).toContain(equivalent);
  await choices.selectOption({index: 1});
  await expect(trainer.locator('.training-discovery blockquote')).toHaveText(equivalent);

  await trainer.locator('.training-assistant > summary').click();
  await trainer.getByLabel('Model name', {exact: true}).fill('Local fixture model');
  const proposal = 'Possibly a delay in receiving news. <source>still ambiguous</source>';
  await trainer.getByLabel('Model proposal').fill(proposal);
  await trainer.getByRole('button', {name: 'Attach model reading'}).click();
  await expect(trainer.getByLabel('Relationship', {exact: true})).toHaveValue('');
  await trainer.getByLabel('Review note (optional)').fill('An announcement and the end of a meeting could refer to different events.');
  await trainer.getByRole('button', {name: 'Saved collections'}).click();
  await expect(trainer.locator('[data-status]')).toContainText('Save or discard');
  await page.locator('#rail-history').click();
  await page.locator('#tokens [data-token="c4"]').click();
  await page.locator('#rail-training').click();
  await expect(trainer.locator('[data-training-seed] blockquote')).toHaveText(seedQuote);
  await expect(trainer.locator('.training-discovery blockquote')).toHaveText(equivalent);
  await expect(trainer.getByLabel('Review note (optional)')).toHaveValue(/different events/);
  const initial = await head(page);
  expect(initial.revision.id).toBe(1);
  await saveReview(page, 'Relationship', 'Needs context', 2);

  await chooseSeed(page, 'b1', 'b6');
  await trainer.getByRole('radio', {name: 'Easy to confuse'}).check();
  await expect(trainer.locator('.training-discovery blockquote')).toHaveText(nearMiss);
  await saveReview(page, 'Relationship', 'Different', 3);
  await chooseSeed(page, 'a1', 'a7');
  await trainer.getByRole('radio', {name: 'Label a passage'}).check();
  await saveReview(page, 'Passage label', 'Public notice', 4);

  await page.reload();
  await page.locator('#rail-training').click();
  await trainer.getByRole('button', {name: 'Saved collections'}).click();
  await expect(trainer.getByRole('combobox', {name: 'Saved collection', exact: true})).toHaveValue(collection);
  await expect(trainer.locator('.training-counts')).toContainText('3 reviewed');
  await expect(trainer.locator('.training-record')).toHaveCount(3);
  const savedPair = trainer.locator('.training-record').filter({has: page.getByText('Needs context', {exact: true})});
  await savedPair.locator('summary').first().click();
  await savedPair.locator('.training-source').last().getByText('Source context', {exact: true}).click();
  await expect(savedPair.locator('.training-source mark').first()).toHaveText('By');
  await expect(savedPair.locator('.training-source mark').last()).toHaveText('over.');
  await savedPair.getByText('Model second reading', {exact: true}).click();
  await expect(savedPair).toContainText(proposal);
  await expect(savedPair.locator('source')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await trainer.getByRole('button', {name: 'Export reviewed JSONL'}).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('training-Notice-study-r4.jsonl');
  const rows = (await readFile((await download.path())!, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  expect(rows).toHaveLength(3);
  const pair = rows.find(row => row.label === 'Needs context');
  expect(pair).toMatchObject({
    collection, kind: 'pair', lens: 'meaning', label: 'Needs context', discovery: 'local meaning ranking',
    seed: {document: 'xmlfiles/noticeboard.xml', utterance: 'turn-2', revision: 1, snapshotHash: initial.revision.snapshot_hash, tokenIds: seedIds, quote: seedQuote, speaker: 'B'},
    candidate: {document: 'xmlfiles/second-interview.xml', utterance: 'follow-1', revision: 1, quote: equivalent, speaker: 'C', startUs: null, endUs: null},
    assistance: {model: 'Local fixture model', reply: proposal},
  });
  expect(pair.assistance.prompt).toContain('follow-1');
  expect(pair.seed.readings.map((r: {id: string}) => r.id)).toEqual(seedIds);
  expect(pair.seed.readings[2]).toEqual({id: 'b3', original: 'heard', corrected: null, language: null, languageSource: 'unknown'});
  expect(pair.assistance.prompt).toContain('turn-2');
  expect(rows.find(row => row.label === 'Different')).toMatchObject({kind: 'pair', lens: 'contrast', seed: {revision: 2}, candidate: {utterance: 'follow-2', quote: nearMiss}});
  expect(rows.find(row => row.label === 'Public notice')).toMatchObject({kind: 'classification', candidate: null, seed: {utterance: 'turn-1', revision: 3}});
  const final = await head(page);
  for (const row of rows) expect(row.exportedFrom).toMatchObject({revision: 4, snapshotHash: final.revision.snapshot_hash});
  expect(final.documents.map((d: {tokens: unknown[]}) => d.tokens)).toEqual(initial.documents.map((d: {tokens: unknown[]}) => d.tokens));
  expect(errors).toEqual([]);
});

test('a narrow trainer finds manually searched source words and keeps the review reachable', async ({page, practiceUrl}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(practiceUrl);
  await chooseSeed(page, 'b1', 'b6');
  const trainer = panel(page);
  await trainer.getByRole('radio', {name: 'Similar wording'}).check();
  const search = trainer.getByRole('searchbox', {name: 'Find words in the corpus'});
  const find = trainer.getByRole('button', {name: 'Find passages'});
  await search.fill('definitely absent');
  await find.click();
  await expect(trainer).toContainText('No other passage matched.');
  await search.fill('ALREADY OVER');
  await trainer.getByLabel('Candidate limit').selectOption('6');
  await find.click();
  await expect(trainer.getByRole('combobox', {name: 'Comparison passage'}).locator('option')).toHaveCount(1);
  await expect(trainer.locator('.training-discovery blockquote')).toHaveText(equivalent);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await saveReview(page, 'Relationship', 'Partial overlap', 2);
  await trainer.getByRole('button', {name: 'Saved collections'}).click();
  await expect(trainer.locator('.training-record summary')).toContainText('Partial overlap');
  const v = await head(page);
  const note = JSON.parse(v.documents.find((d: {path: string}) => d.path.endsWith('noticeboard.xml')).spans[0].fields.note);
  expect(note).toMatchObject({discovery: 'manual text search', lens: 'wording', candidate: {utterance: 'follow-1'}});
});

test('another writer advancing the revision blocks the pinned training review until it is discarded', async ({page, practiceUrl}) => {
  await page.goto(practiceUrl);
  await chooseSeed(page, 'b1', 'b6');
  const trainer = panel(page);
  await trainer.getByLabel('Collection name').fill(collection);
  await trainer.getByLabel('Passage label', {exact: true}).fill('Provisional');
  // This separate write really changes a token in the pinned passage at the authority.
  await page.evaluate(async () => {
    const v = await (await fetch('/api/view')).json();
    const response = await fetch('/api/command', {method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-WB-CSRF': sessionStorage.getItem('wb-csrf')!},
      body: JSON.stringify({schema: 1, project: v.snapshot.project, command_id: 'training-concurrent-writer',
        base_revision: v.revision.id, preimage_hash: v.revision.snapshot_hash, config_version: v.snapshot.config.version,
        label: 'Synthetic correction', operations: [{kind: 'set_token', document: 'xmlfiles/noticeboard.xml', token: 'b3', fields: {nform: 'learned'}}]})});
    if (!response.ok) throw new Error(await response.text());
  });
  const save = trainer.getByRole('button', {name: 'Save reviewed example'});
  await save.click();
  await expect(trainer.locator('[data-status]')).toContainText(/revision changed/i);
  await expect(save).toBeDisabled();
  await expect(trainer.locator('[data-training-seed] blockquote')).toHaveText(seedQuote);
  await expect(page.locator('#reapply-conflict')).toHaveCount(0);
  await trainer.getByRole('button', {name: 'Discard review'}).click();
  await chooseSeed(page, 'b1', 'b6');
  await expect(trainer.locator('[data-training-seed] blockquote')).toHaveText('I only learned after the meeting.');
  const v = await head(page);
  expect(v.revision.id).toBe(2);
  expect(v.documents.flatMap((d: {spans: unknown[]}) => d.spans)).toEqual([]);
});
