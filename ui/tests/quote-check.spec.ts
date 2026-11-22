import {expect, type Page} from '@playwright/test';
import {test as base} from './practice-fixture';
import {literalMatches} from '../src/quote-check';

const test = base.extend<{practice: Page}>({
  practice: async ({page, practiceUrl}, use) => {
    await page.goto(practiceUrl);
    await page.getByRole('button', {name: 'Open co-analysis', exact: true}).click();
    await use(page);
  },
});

const proposal = 'The speaker said “only heard after”. Did they say they never saw the board?';
async function review(page: Page, first: string, last: string, modifier: 'Shift' | 'Control' = 'Shift') {
  await page.locator(`[data-token="${first}"]`).click();
  await page.locator(`[data-token="${last}"]`).click({modifiers: [modifier]});
  await page.getByLabel('Model name or version').fill('G1 synthetic reply');
  await page.getByLabel('Model reply').fill(proposal);
  await page.getByRole('button', {name: 'Review this reply'}).click();
  await page.getByText('Check a quoted phrase', {exact: true}).click();
  return page.locator('details').filter({has: page.getByLabel('Quoted phrase', {exact: true})});
}

test('an exact in-scope phrase resolves; wrong-turn and invented wording do not', async ({practice: page}) => {
  const check = await review(page, 'b1', 'b6');
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  for (const [phrase, expected] of [
    ['only heard after', 'Literal match · turn-2 · b2, b3, b4'],
    ['from my neighbour.', 'No literal match in the pinned passage.'],
    ['never saw the board', 'No literal match in the pinned passage.'],
  ]) {
    await check.getByLabel('Quoted phrase', {exact: true}).fill(phrase);
    await check.getByRole('button', {name: 'Check quote'}).click();
    await expect(check.getByRole('status')).toHaveText(expected);
  }
  await expect(page.locator('[data-proposal]')).toHaveText(proposal);
  await expect(page.getByRole('button', {name: 'Save reviewed annotation'})).toBeDisabled();
  expect(writes).toEqual([]);
  const view = await page.evaluate(async () => (await fetch('/api/view')).json());
  expect(view.revision.id).toBe(1);
  expect(view.documents[0].spans).toHaveLength(0);
});

test('repeated wording needs an explicit occurrence and a quote cannot join turns', async ({practice: page}) => {
  const check = await review(page, 'b1', 'c6');
  const phrase = check.getByLabel('Quoted phrase', {exact: true});
  await phrase.fill('heard');
  await check.getByRole('button', {name: 'Check quote'}).click();
  await expect(check.getByRole('status')).toHaveText('2 literal matches. Choose an occurrence.');
  const occurrence = check.getByLabel('Matching occurrence');
  await expect(occurrence).toHaveValue('');
  for (const label of ['turn-2 · b3', 'turn-3 · c2']) {
    await occurrence.selectOption({label});
    await expect(check.getByRole('status')).toHaveText('Selected literal match · ' + label);
  }
  await phrase.fill('meeting. I');
  await expect(check.getByRole('status')).toBeEmpty();
  await expect(occurrence).toBeHidden();
  await check.getByRole('button', {name: 'Check quote'}).click();
  await expect(check.getByRole('status')).toHaveText('No literal match in the pinned passage.');
  await expect(page.locator('[data-proposal]')).toHaveText(proposal);
});

test('selected tokens from the same turn cannot bridge an omission', async ({practice: page}) => {
  const check = await review(page, 'b1', 'b3', 'Control');
  await expect(page.getByLabel('omitted tokens')).toBeVisible();
  await check.getByLabel('Quoted phrase', {exact: true}).fill('I heard');
  await check.getByRole('button', {name: 'Check quote'}).click();
  await expect(check.getByRole('status')).toHaveText('No literal match in the pinned passage.');
});

test('literal anchors preserve Unicode spelling, punctuation, case and whitespace inside source tokens', () => {
  const groups = [{utterance: null, gap_before: false, tokens: [
    {id: 'x', text: 'e\u0301'}, {id: 'y', text: '👩🏾‍🔬'}, {id: 'z', text: 'Two  words.'},
  ]}];
  expect(literalMatches(groups, 'e\u0301 👩🏾‍🔬')).toEqual([{utterance: null, ids: ['x', 'y']}]);
  expect(literalMatches(groups, 'Two  words.')).toEqual([{utterance: null, ids: ['z']}]);
  for (const query of ['é', '👩', 'Two words.', 'two  words.', 'words.', 'Two  words', '']) {
    expect(literalMatches(groups, query)).toEqual([]);
  }
});
