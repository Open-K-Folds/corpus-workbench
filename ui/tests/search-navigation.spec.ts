import {expect, type Page} from '@playwright/test';
import {cpSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from './practice-fixture';

test.use({practicePackage: async ({}, use) => {
  const project = mkdtempSync(join(tmpdir(), 'wb-search-navigation-'));
  cpSync(resolve('../fixtures/coanalysis'), project, {recursive:true});
  const turns = Array.from({length:85}, (_, i) =>
    '<u id="turn' + i + '"><tok id="word' + i + '">Walking</tok></u>').join('');
  writeFileSync(join(project, 'xmlfiles', 'second-interview.xml'),
    '<TEI><teiHeader><title>Evening walk</title></teiHeader><text><body>' + turns +
    '<u id="last"><tok id="metal">silver</tok> <tok id="light">lantern</tok></u></body></text></TEI>');
  await use(project);
}});

async function openDelayedMatch(page: Page, practiceUrl: string, whileLoading?: () => Promise<void>) {
  await page.goto(practiceUrl);
  await page.getByRole('button', {name:'Open corpus search'}).click();
  await page.getByLabel('Exact token sequence', {exact:true}).fill('silver\nlantern');
  await page.getByRole('button', {name:'Search corpus', exact:true}).click();
  await expect(page.locator('#corpus-search-status')).toContainText('1 match ·');

  const reading = /\/api\/reading\?path=xmlfiles%2Fsecond-interview\.xml/;
  let release!: () => void;
  const delayed = new Promise<void>(done => { release = done; });
  await page.route(reading, async route => { await delayed; await route.continue(); }, {times:1});
  const requested = page.waitForRequest(reading);
  try {
    await page.getByRole('button', {name:'Show in transcript', exact:true}).click();
    await requested;
    await whileLoading?.();
  } finally { release(); }
  await expect(page.locator('#tokens .lexeme.selected .reading-text')).toHaveText(['silver','lantern']);
}

for (const width of [390,1440]) {
  test.describe('search navigation at ' + width + 'px', () => {
    test.use({viewport:{width,height:844}, hasTouch:width === 390, isMobile:width === 390});

    test('opens and focuses the exact passage after the other transcript loads', async ({page, practiceUrl}) => {
      await openDelayedMatch(page, practiceUrl);
      const first = page.locator('[data-token="metal"]');
      await expect(first).toBeFocused();
      await expect(first).toBeInViewport({ratio:1});
      await expect(page.locator('[data-token="light"]')).toBeInViewport({ratio:1});
      await expect(page.locator('#document-title')).toHaveText('Evening walk');
      await expect(page.locator('#save-state')).toContainText('R1');
    });

    test('keeps focus in Projects if the reader moves there before the transcript loads', async ({page, practiceUrl}) => {
      const filter = page.getByLabel('Find documents or sources');
      await openDelayedMatch(page, practiceUrl, async () => {
        await page.getByRole('button', {name:'Projects', exact:true}).click();
        await filter.fill('Evening');
      });
      await expect(filter).toBeFocused();
      await expect(filter).toHaveValue('Evening');
    });
  });
}
