import {expect, type Page} from '@playwright/test';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {View} from '../src/contracts';
import {test} from './practice-fixture';

const head = (page: Page): Promise<View> => page.evaluate(async () => (await fetch('/api/view')).json());

test('an English meaning can be reused and opened across transcripts', async ({page, practiceUrl}, info) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) errors.push(msg.text()); });
  await page.goto(practiceUrl);
  await expect(page).toHaveTitle('Corpus workbench');
  await page.locator('#toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const before = await head(page);
  await page.locator('[data-token="a4"] .reading-text').click();
  await page.getByRole('button', {name:'Label meaning of selected passage'}).click();
  const panel = page.locator('.meanings-panel');
  const meaning = panel.getByLabel('English meaning');
  await expect(meaning).toBeFocused();
  await expect(panel.locator('blockquote')).toHaveText('notice');
  await panel.getByRole('button', {name:'Use “notice”'}).click();
  await expect(meaning).toHaveValue('notice');
  await meaning.fill('Gun');
  await expect(panel.locator('.dictionary-gloss')).toContainText(/weapon/i);
  await meaning.fill('announcement');
  await expect(panel.locator('.dictionary-gloss')).not.toContainText(/weapon/i);
  await panel.locator('.meaning-dictionary summary').click();
  const picker = panel.getByLabel('Sense for this passage (optional)');
  await picker.selectOption({index:1});
  const sense = await picker.inputValue();
  const gloss = await picker.locator('option:checked').textContent();
  await expect(panel.locator('.dictionary-gloss')).toContainText('Selected sense');
  await panel.screenshot({path:info.outputPath('desktop-meaning.png')});
  await panel.getByRole('button', {name:'Save meaning'}).click();
  await expect(page.locator('#save-state')).toContainText('Saved R2');
  const here = panel.getByRole('region', {name:'Saved meaning', exact:true});
  await expect(here.getByText('announcement', {exact:true})).toBeFocused();
  await expect(here.getByLabel('Labelled words')).toHaveText('notice');
  await expect(here.getByText(sense, {exact:false})).toBeVisible();
  await expect(meaning).toBeHidden();
  await panel.getByText('Add another meaning', {exact:true}).press('Enter');
  await expect(meaning).toBeFocused();
  const saved = await head(page);
  const mark = saved.documents[0].spans.find(span => span.id.startsWith('meaning-'))!;
  expect(mark.token_ids).toEqual(['a4']);
  expect(mark.fields).toMatchObject({label:'announcement', note:gloss!.split(' · ').slice(1).join(' · ') + '\nOpen English Wordnet 2025 · ' + sense});
  expect(saved.snapshot.config).toEqual(before.snapshot.config);

  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.locator('[data-document="xmlfiles/second-interview.xml"]').click();
  await page.locator('[data-token="h3"] .reading-text').click({button:'right'});
  await page.getByRole('toolbar',{name:'Selection tools'}).getByRole('button',{name:'Label meaning',exact:true}).click();
  await expect(panel.locator('#project-meaning-labels option')).toHaveAttribute('value','announcement');
  await meaning.fill('Announcement');
  await meaning.press('Enter');
  await expect(page.locator('#save-state')).toContainText('Saved R3');
  const second = (await head(page)).documents.find(doc => doc.path.includes('second-interview'))!;
  expect(second.spans[0].fields.note).toBeUndefined();
  await page.locator('.inspector-tools > summary').click();
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.getByRole('button',{name:'Record review',exact:true}).click();
  await expect(page.locator('#save-state')).toContainText('Approved exact revision');
  await page.locator('.inspector-tools > summary').click();
  await page.getByRole('button',{name:'Meaning labels',exact:true}).click();
  await panel.getByLabel('Find a meaning').fill('ANNOUNCEMENT');
  await expect(panel.locator('.meaning-passage')).toHaveCount(2);
  await panel.getByRole('button',{name:/Who gets the notice/}).click();
  const card = page.getByRole('dialog', {name:'announcement',exact:true});
  await expect(card).toBeVisible();
  await expect(card.locator('blockquote')).toHaveText('notice');
  await expect(card).toContainText('English meaning');
  await expect(card).toContainText(sense);
  await page.reload();
  await expect(page.locator('#document-title')).toBeVisible();
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await page.getByRole('button',{name:'Meaning labels',exact:true}).click();
  await expect(panel.locator('.meaning-passage')).toHaveCount(2);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('partial-word meaning drafts and local terms keep the exact selected text', async ({page, practiceUrl}) => {
  await page.goto(practiceUrl);
  const word = page.locator('[data-token="a4"] .reading-text');
  await word.evaluate(el => {
    const text = el.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 2, text, 5);
  });
  await page.getByRole('toolbar',{name:'Selection tools'}).getByRole('button',{name:'Label meaning',exact:true}).click();
  const panel = page.locator('.meanings-panel');
  await expect(panel.locator('blockquote')).toHaveText('tic');
  const input = panel.getByLabel('English meaning');
  await input.fill('meeting bell phrase');
  await expect(panel.getByText('You can save this as a project term.')).toBeVisible();
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('button',{name:'Close project files'}).click();
  await expect(input).toHaveValue('meeting bell phrase');
  await input.press('Enter');
  await expect(page.locator('#save-state')).toContainText('Saved R2');
  const mark = (await head(page)).documents[0].spans[0];
  expect(mark.fields).toMatchObject({label:'meeting bell phrase', wb_quote:'tic', wb_start:'2', wb_end:'5'});
  const saved = panel.getByRole('region', {name:'Saved meaning', exact:true});
  await expect(saved.getByLabel('Labelled words')).toHaveText('tic');
  await expect(input).toBeHidden();
  await panel.getByText('Label the whole word', {exact:true}).click();
  await expect(panel.getByLabel('Selected words')).toHaveText('notice');
  await word.evaluate(el => {
    el.closest<HTMLElement>('[data-token]')!.focus();
    window.getSelection()!.setBaseAndExtent(el.firstChild!, 0, el.firstChild!, 2);
  });
  await page.getByRole('toolbar',{name:'Selection tools'}).getByRole('button',{name:'Label meaning',exact:true}).click();
  await expect(saved).toHaveCount(0);
  await expect(panel.getByLabel('Selected words')).toHaveText('no');
});

test.describe('a shared English label on a Spanish passage', () => {
  test.use({practicePackage:async ({}, use) => {
    const project = mkdtempSync(join(tmpdir(), 'wb-meaning-passage-'));
    mkdirSync(join(project, 'xmlfiles'));
    mkdirSync(join(project, 'Resources'));
    writeFileSync(join(project, 'Resources', 'settings.xml'), '<ttsettings/>');
    writeFileSync(join(project, 'xmlfiles', 'objects.xml'),
      '<TEI><teiHeader><title>Nombres de objetos</title></teiHeader><text><body>' +
      '<u id="u1" xml:lang="es"><tok id="uno">Una</tok> <tok id="objeto">pistola</tok>.</u></body></text></TEI>');
    await use(project);
  }});

  test('shows the saved word and dictionary only after the original save is confirmed', async ({page, practiceUrl}, info) => {
    await page.goto(practiceUrl);
    await page.locator('#toggle-theme').click();
    await page.getByRole('button',{name:'Tools',exact:true}).click();
    await page.getByRole('button',{name:'Meaning labels',exact:true}).click();
    await page.getByRole('button',{name:'Choose words in transcript'}).click();
    await expect(page.locator('#tokens')).toBeFocused();
    await page.locator('[data-token="objeto"] .reading-text').click();
    await page.getByRole('button',{name:'Label meaning of selected passage'}).click();
    const panel = page.locator('.meanings-panel');
    const input = panel.getByLabel('English meaning');
    await input.fill('gun');
    await expect(panel.locator('.dictionary-gloss')).toContainText(/weapon/i);
    await panel.screenshot({path:info.outputPath('english-meaning-of-gun.png')});
    await page.route('**/api/command', async route => { await route.fetch(); await route.abort(); }, {times:1});
    await input.press('Enter');
    await expect(page.locator('#save-state')).toContainText('Save outcome unknown');
    const saved = panel.getByRole('region', {name:'Saved meaning',exact:true});
    await expect(saved).toHaveCount(0);
    let releaseReading!: () => void;
    const delayedReading = new Promise<void>(done => { releaseReading = done; });
    await page.route(/\/api\/reading\?/, async route => { await delayedReading; await route.continue(); }, {times:1});
    try {
      await page.getByRole('button', {name:'Resolve original save'}).click();
      await expect(saved.getByText('gun',{exact:true})).toBeFocused();
      await expect(saved.getByLabel('Labelled words')).toHaveText('pistola');
      await saved.getByLabel('Labelled words').click();
      await saved.getByText('English dictionary', {exact:true}).click();
      await expect(saved.locator('ol li').first()).toContainText(/weapon/i);
      const view = await head(page);
      expect(view.documents[0].spans).toHaveLength(1);
      expect(view.documents[0].spans[0].fields.note).toBeUndefined();
      await saved.getByText('English dictionary',{exact:true}).click();
      await panel.screenshot({path:info.outputPath('desktop-saved-meaning.png')});
      await saved.getByRole('button',{name:'Show in transcript'}).click();
    } finally { releaseReading(); }
    await expect(page.getByRole('dialog',{name:'gun',exact:true}).locator('blockquote')).toHaveText('pistola');
  });
});

test.describe('phone meaning labels', () => {
  test.use({hasTouch:true, isMobile:true, viewport:{width:390,height:844}});
  test('a later English label keeps its dictionary sense while an earlier lookup finishes', async ({page,practiceUrl}, info) => {
    await page.goto(practiceUrl);
    await page.locator('[data-token="a4"] .reading-text').tap();
    const action = page.getByRole('button',{name:'Label meaning of selected passage'});
    await expect(action).toBeInViewport({ratio:1});
    await action.tap();
    const form = page.locator('#meaning-form'), input = form.getByLabel('English meaning');
    let release!: () => void;
    const gate = new Promise<void>(done => {release=done});
    await page.route('**/english-wordnet-2025/g.json.gz', async route => {await gate; await route.continue()});
    const requested = page.waitForRequest('**/english-wordnet-2025/g.json.gz');
    const received = page.waitForResponse('**/english-wordnet-2025/g.json.gz');
    try {
      await input.fill('Gun');
      await requested;
      await input.fill('announcement');
      await form.locator('.meaning-dictionary summary').tap();
      await form.getByLabel('Sense for this passage (optional)').selectOption({index:1});
    } finally {release()}
    await received;
    await expect(form.locator('.dictionary-gloss')).toContainText('Selected sense');
    await expect(form.locator('.dictionary-gloss')).not.toContainText(/weapon/i);
    const width = await form.evaluate(el => ({available:el.clientWidth, used:el.scrollWidth}));
    expect(width.used).toBeLessThanOrEqual(width.available+1);
    await page.locator('.meanings-panel').screenshot({path:info.outputPath('phone-dictionary.png')});
    await form.getByRole('button',{name:'Save meaning'}).tap();
    await expect(page.locator('#save-state')).toContainText('Saved R2');
    const span = (await head(page)).documents[0].spans[0];
    expect(span.fields.label).toBe('announcement');
    expect(span.fields.note).toContain('a formal public statement');
  });

  test('the spoken-language settings lead back to the selection, even without a dictionary', async ({page,practiceUrl}, info) => {
    await page.route('**/third-party/english-wordnet-2025/*.json.gz', route => route.fulfill({status:503,body:'Unavailable'}));
    await page.goto(practiceUrl);
    await page.locator('[data-token="a4"] .reading-text').tap();
    await page.getByRole('button',{name:'Tools',exact:true}).tap();
    const chooser = page.locator('.inspector-tools');
    if (!await chooser.locator('nav').isVisible()) await chooser.locator('summary').tap();
    await chooser.getByRole('button',{name:'Spoken languages',exact:true}).tap();
    await expect(page.getByLabel('Spoken language for otherwise unlabelled words')).toHaveValue('');
    await page.getByRole('button',{name:'Open meaning labels'}).tap();
    const input = page.getByLabel('English meaning');
    await expect(input).toBeFocused();
    await expect(page.locator('#meaning-form blockquote')).toHaveText('notice');
    await input.fill('community announcement');
    await expect(page.locator('.meaning-dictionary')).toContainText('Dictionary unavailable');
    await page.getByRole('button',{name:'Save meaning'}).tap();
    await expect(page.locator('#save-state')).toContainText('Saved R2');
    const matches = page.locator('.meaning-library .meaning-passage');
    await expect(matches).toHaveCount(0);
    const saved = page.getByRole('region', {name:'Saved meaning',exact:true});
    await expect(saved.getByText('community announcement',{exact:true})).toBeFocused();
    await expect(saved.getByLabel('Labelled words')).toHaveText('notice');
    await expect(input).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.meanings-panel').screenshot({path:info.outputPath('phone-saved-meaning.png')});
    const search = page.getByLabel('Find a meaning');
    await search.fill('community');
    await expect(matches).toContainText('community announcement');
    await search.fill('');
    expect((await saved.getByRole('button',{name:'Show in transcript'}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await saved.getByRole('button',{name:'Show in transcript'}).tap();
    await expect(page.getByRole('dialog',{name:'community announcement',exact:true}).locator('blockquote')).toHaveText('notice');
    const view = await head(page);
    expect(view.snapshot.config.language_values).toEqual({});
    expect(view.snapshot.config.language_default).toBeNull();
  });
});
