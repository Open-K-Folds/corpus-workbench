import {expect, type Locator, type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {test} from './practice-fixture';

const launcher = (page: Page) => page.getByRole('button', {name: 'Open reading canvas'});
const token = (page: Page, id: string) => page.locator(`#tokens [data-token="${id}"] .reading-text`);
const head = (page: Page) => page.evaluate(async () => (await (await fetch('/api/view')).json()).revision);
const fontSize = (element: Locator) => element.evaluate(node => parseFloat(getComputedStyle(node).fontSize));

test.describe('dock position during timed listening', () => {
  test.use({practicePackage:resolve('../fixtures/spoken-reading')});

  test('reading and finding retain a single command row in the saved editing workspace',async({page,practiceUrl})=>{
    await page.addInitScript(()=>{localStorage.setItem('wb-studio-layout','editing');localStorage.setItem('wb-theme','light')});
    await page.goto(practiceUrl);
    const settings=page.locator('.reading-settings'),toggle=settings.locator('summary');
    const find=page.getByRole('button',{name:'Find in transcript'});
    await expect(settings).not.toHaveAttribute('open');
    const commandTop=()=>find.evaluate(button=>button.getBoundingClientRect().top);
    const top=await commandTop();
    await toggle.click();
    await expect(page.getByLabel('Reading layer')).toBeVisible();
    await expect(page.getByLabel('Go to source')).toBeVisible();
    expect(await commandTop()).toBe(top);
    await page.getByRole('button',{name:'Selection guide',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Selection guide'})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading',{name:'Selection guide'})).toBeHidden();
    await expect(settings).toHaveAttribute('open');
    await page.getByLabel('Go to source').fill('u3');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-location="u3"]')).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('Find tokens',{exact:true})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveAttribute('open');
    await expect(page.locator('#tokens')).toBeFocused();
  });

  test('transcript find reports matches, cycles with F3 and restores the reading position after an empty search',async({page,practiceUrl})=>{
    await page.setViewportSize({width:390,height:730});
    await page.goto(practiceUrl);
    const pane=page.locator('.transcript'),words=page.locator('#tokens [data-token]');
    await expect(words.first()).toBeVisible();
    const all=await words.count();
    const find=page.getByRole('button',{name:'Find in transcript'});
    await find.click();
    const query=page.getByLabel('Find tokens',{exact:true});
    await expect(query).toBeFocused();
    await expect(page.getByLabel('Go to source')).toBeHidden();
    await expect(page.getByLabel('Token filter')).toBeVisible();
    await page.locator('.reading-settings > summary').click();
    await expect(query).toBeHidden();
    await page.getByRole('button',{name:'Source',exact:true}).click();
    await expect(page.getByLabel('Go to source')).toBeVisible();
    await page.locator('.reading-settings > summary').click();
    const place=await pane.evaluate(el=>{el.scrollTop=150;return el.scrollTop});
    expect(place).toBeGreaterThan(30);
    await page.keyboard.press('Control+k');
    await expect(query).toBeFocused();
    await query.fill('bell');
    const status=page.locator('#reading-match-count');
    await expect(status).toHaveText('2 matches');
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('Match 1 of 2');
    await expect(words.first()).toBeFocused();
    await page.keyboard.press('F3');
    await expect(status).toHaveText('Match 2 of 2');
    await query.fill('no such word');
    await expect(status).toHaveText('No matches');
    await expect(page.locator('#tokens > .reading-block:visible')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Next match',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Clear search and filters'}).click();
    await expect(find).toBeVisible();
    await expect(words).toHaveCount(all);
    await expect(page.locator('.reading-settings')).not.toHaveAttribute('open');
    await expect(page.locator('#tokens')).toBeFocused();
    await expect.poll(()=>pane.evaluate(el=>el.scrollTop)).toBe(place);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  });

  for (const theme of ['dark','light']) {
    test(`utterance contrast tracks the recording through silence and backward seeks in ${theme} appearance`, async ({page,practiceUrl}) => {
      await page.addInitScript(value=>localStorage.setItem('wb-theme',value),theme);
      await page.goto(practiceUrl);
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      const follow=page.getByRole('button',{name:'Follow audio',exact:true});
      await expect(follow).toBeEnabled();
      const seek=(seconds:number)=>page.locator('#audio').evaluate((media:HTMLAudioElement,time)=>{media.currentTime=time},seconds);
      const turn=(id:string)=>page.locator(`.reading-block[data-utterance="${id}"]`);
      const opacity=(id:string)=>token(page,id).evaluate(text=>Number(getComputedStyle(text).opacity));

      // u4 has only utterance timing. Its words cannot establish their own progress.
      await seek(14);
      await expect(turn('u3')).toHaveAttribute('data-playback-progress','played');
      await expect(turn('u4')).toHaveAttribute('data-playback-progress','current');
      await expect(turn('u5')).toHaveAttribute('data-playback-progress','upcoming');
      await expect.poll(()=>opacity('w3-1')).toBe(1);
      await expect.poll(()=>opacity('w5-1')).toBeLessThan(1);

      await seek(16.5);
      await expect(turn('u4')).toHaveAttribute('data-playback-progress','played');
      await expect(page.locator('[data-playback-word],[data-playback-turn]')).toHaveCount(0);
      await expect.poll(()=>opacity('w4-1')).toBe(1);
      await expect.poll(()=>opacity('w5-1')).toBeLessThan(1);

      await follow.click();
      await expect(follow).toHaveAttribute('aria-pressed','false');
      await seek(1);
      await expect(turn('u1')).toHaveAttribute('data-playback-progress','current');
      await expect(turn('u4')).toHaveAttribute('data-playback-progress','upcoming');
      await expect.poll(()=>opacity('w4-1')).toBeLessThan(1);
      await token(page,'w4-1').click();
      await expect(page.locator('[data-token="w4-1"]')).toHaveClass(/selected/);
      await expect.poll(()=>opacity('w4-1')).toBe(1);
      await expect.poll(()=>opacity('w4-2')).toBeLessThan(1);
    });
  }

  test('the turn wheel follows paused audio and keyboard steering begins at that turn', async ({page,practiceUrl}) => {
    await page.goto(practiceUrl);
    const follow = page.locator('#follow-audio'), wheel = page.locator('.canvas-turn-handle');
    await expect(follow).toBeEnabled();
    const seek = (seconds:number) => page.locator('audio#audio').evaluate((media:HTMLAudioElement, time)=>{media.currentTime=time},seconds);
    await seek(14);
    await expect(page.locator('[data-playback-turn]')).toHaveAttribute('data-utterance','u4');
    await expect(page.locator('#canvas-position')).toHaveText('Turn 4 of 8');
    await expect(page.locator('#canvas-scrub')).toHaveValue('4');
    await expect(page.locator('[data-utterance="u4"] .canvas-turn-handle')).toBeVisible();
    await wheel.press('ArrowDown');
    await expect(follow).toHaveAttribute('aria-pressed','false');
    await expect(page.locator('#canvas-location')).toHaveText('u5');
    await expect(page.locator('#tokens')).not.toHaveAttribute('data-playback-following','');
    await seek(1);
    await expect(page.locator('[data-playback-word]')).toHaveText('librarian');
    await expect(page.locator('#canvas-location')).toHaveText('u5');
    await follow.click();
    await expect(page.locator('#canvas-location')).toHaveText('u1');
    await expect(page.locator('#tokens')).toHaveAttribute('data-playback-following','');
  });
});

test.describe('touch dock with a linked recording', () => {
  test.use({practicePackage:resolve('../fixtures/spoken-reading'), hasTouch:true, isMobile:true, viewport:{width:320,height:700}});

  test('a short landscape screen keeps the transcript readable and discloses the full recording controls', async ({page,practiceUrl}) => {
    await page.setViewportSize({width:640,height:360});
    await page.goto(practiceUrl);
    const pane = page.locator('.transcript');
    const fitsReadingPane = (element:Locator) => element.evaluate(node => {
      const box = node.getBoundingClientRect(), pane = node.closest('.transcript')!.getBoundingClientRect();
      return box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1;
    });
    await expect(page.locator('#canvas-play')).toBeEnabled();
    await expect.poll(() => fitsReadingPane(token(page,'w1-2'))).toBe(true);
    const toggle = page.getByRole('button',{name:'Show recording controls'});
    await expect(toggle).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('#audio-speed')).toBeHidden();
    await page.locator('#canvas-scrub').press('End');
    await expect(page.locator('#canvas-position')).toHaveText('Turn 8 of 8');
    await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => fitsReadingPane(token(page,'w8-1'))).toBe(true);

    await toggle.tap();
    await page.locator('#audio-speed').selectOption('1.5');
    const timeline = page.getByRole('region',{name:'Recording timeline'});
    await timeline.focus();
    await expect(timeline).toBeFocused();
    await timeline.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(page.locator('#audio-speed')).toBeHidden();
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('#audio-speed')).toBeHidden();
    await toggle.tap();
    await expect(page.locator('#audio-speed')).toBeVisible();
    await expect(page.locator('#audio-speed')).toHaveValue('1.5');
  });

  test('a phone reader can open settings, follow playback and reveal the recording details',async({page,practiceUrl})=>{
    await page.setViewportSize({width:320,height:640});
    await page.goto(practiceUrl);
    const panel=page.locator('#recording-pane'), audio=page.locator('#audio');
    const toggle=page.getByRole('button',{name:'Show recording controls'});
    await expect(page.locator('#canvas-play')).toBeEnabled();
    await expect(page.locator('#audio-play')).toBeHidden();
    await expect(page.locator('#audio-clock')).toBeVisible();
    await expect.poll(()=>panel.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(60);
    await page.locator('.reading-settings > summary').tap();
    const first=token(page,'w1-1');
    await expect.poll(()=>first.evaluate(node=>{
      const r=node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    })).toBe(true);
    await page.locator('.reading-settings > summary').tap();
    await page.locator('#canvas-play').tap();
    await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0);
    await toggle.tap();
    await expect(page.locator('#audio-seek')).toBeVisible();
    await expect(page.locator('#recording-waveform')).toBeVisible();
    await page.getByRole('button',{name:'Hide recording controls'}).press('Escape');
    await expect(toggle).toBeFocused();
    await expect(page.locator('#audio-seek')).toBeHidden();
    expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
    await page.locator('#canvas-play').tap();
  });

  test('phone tools keep a compact playable recording and preserve the listening position',async({page,practiceUrl})=>{
    await page.setViewportSize({width:390,height:844});
    await page.goto(practiceUrl);
    const panel=page.locator('#recording-pane'), play=page.locator('#audio-play'), audio=page.locator('#audio');
    await expect(play).toBeEnabled();
    for(const size of [{width:390,height:844},{width:640,height:360}]){
      await page.setViewportSize(size);
      await page.locator('#toggle-navigation').tap();
      await expect(page.locator('#projects-pane')).toBeVisible();
      await expect.poll(()=>panel.evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(60);
      await page.locator('#rail-search').tap();
      await expect(page.locator('#properties-pane')).toBeVisible();
      const controls=page.getByRole('button',{name:'Show recording controls'});
      for(const target of [play,controls]){
        const rect=await target.boundingBox();
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      }
      await play.tap();
      await expect(play).toHaveAccessibleName('Pause recording');
      await controls.tap();
      await page.locator('#audio-speed').selectOption('1.25');
      await page.locator('#audio-seek').fill('3.1');
      await page.locator('#audio-speed').press('Escape');
      await expect(controls).toBeFocused();
      await expect(page.locator('#audio-speed')).toBeHidden();
      await expect(play).toHaveAccessibleName('Pause recording');
      await play.tap();
      const at=await audio.evaluate((node:HTMLAudioElement)=>node.currentTime);
      expect(at).toBeGreaterThanOrEqual(3);
      await page.locator('#properties-pane .pane-return').tap();
      await expect(page.locator('.transcript')).toBeVisible();
      expect(await audio.evaluate((node:HTMLAudioElement)=>[node.currentTime,node.playbackRate,node.paused])).toEqual([at,1.25,true]);
    }
  });

  for (const mode of ['workspace', 'focus']) {
    test(`each control has a separate touch target in a 320px ${mode}`, async ({page,practiceUrl}) => {
      await page.goto(practiceUrl);
      await expect(page.locator('#canvas-play')).toBeEnabled();
      if (mode === 'focus') await launcher(page).tap();
      const dock = page.getByRole('navigation', {name:'Reading canvas controls'});
      const next = dock.getByRole('button', {name:'Next source turn'});
      await next.tap();
      const scrubber = dock.getByRole('slider', {name:'Scrub source turns'});
      await expect(scrubber).toHaveValue('2');

      await expect.poll(() => dock.evaluate(nav => {
        const pane = nav.getBoundingClientRect();
        const targets = [...nav.querySelectorAll<HTMLElement>('button,input')]
          .filter(control => control.getClientRects().length)
          .map(control => ({control,box:control.getBoundingClientRect()}));
        return targets.flatMap(({control,box},index) => {
          const hit = document.elementFromPoint(box.x+box.width/2, box.y+box.height/2);
          const fits = box.left >= pane.left && box.right <= pane.right && box.top >= pane.top && box.bottom <= pane.bottom;
          const overlaps = targets.slice(index+1).some(({box:other}) =>
            box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom);
          return fits && !overlaps && box.width >= 44 && box.height >= 44 && control.contains(hit) ? [] : [control.id];
        });
      })).toEqual([]);
      const play = dock.getByRole('button', {name:'Play audio on canvas'});
      await play.tap();
      await dock.getByRole('button', {name:'Pause audio on canvas'}).tap();
      await dock.getByRole('button', {name:'Increase text size'}).tap();
      await expect(dock.locator('#canvas-scale')).toHaveText('110%');
    });
  }
});

async function nativeSelection(page: Page, from: string, to: string) {
  const first = token(page, from), last = token(page, to);
  await first.scrollIntoViewIfNeeded();
  await last.scrollIntoViewIfNeeded();
  const start = (await first.boundingBox())!, end = (await last.boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {steps: 12});
  await page.mouse.up();
  await expect(page.getByRole('toolbar', {name: 'Selection tools'})).toBeVisible();
}

test('the standard stage steers with the dock and the handle attached to the current source turn', async ({page, practiceUrl}) => {
  await page.goto(practiceUrl);
  const dock = page.getByRole('navigation', {name:'Reading canvas controls'});
  const position = dock.locator('#canvas-position');
  await expect(dock).toBeVisible();
  await expect(position).toHaveText('Turn 1 of 3');
  const before = await head(page);
  const size = await fontSize(token(page,'a1'));
  await dock.getByRole('button', {name:'Increase text size'}).click();
  await expect.poll(() => fontSize(token(page,'a1'))).toBeGreaterThan(size);
  const pane=page.locator('.transcript');
  const beforeNext=await pane.evaluate(node=>node.scrollTop);
  await dock.getByRole('button', {name:'Next source turn'}).click();
  await expect(position).toHaveText('Turn 2 of 3');
  // Sample the frames in which a reader aims for the newly displayed handle.
  const scrollPositions=await pane.evaluate(async node=>{
    const offsets:number[]=[];
    for(let frame=0;frame<8;frame++){
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      offsets.push(node.scrollTop);
    }
    return offsets;
  });
  expect(scrollPositions.every(offset=>offset===beforeNext)).toBe(true);
  const handle = page.getByRole('button', {name:/^Steer source turn/});
  const grip = (await handle.boundingBox())!;
  const x = grip.x+grip.width/2, y = grip.y+grip.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+30,{steps:7});
  await page.mouse.up();
  await expect(position).toHaveText('Turn 3 of 3');
  await expect(handle).toBeFocused();
  await handle.press('ArrowUp');
  await expect(position).toHaveText('Turn 2 of 3');
  await expect(page.locator('[data-canvas-current]')).toContainText('only heard after');
  await handle.press('Home');
  await expect(position).toHaveText('Turn 1 of 3');
  await expect(page.getByRole('button',{name:'Find in transcript'})).toBeVisible();
  expect(await head(page)).toEqual(before);
});

test('offscreen turn navigation scrolls smoothly while direct scrubbing is immediate',async({page,practiceUrl})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(practiceUrl);
  const pane=page.locator('.transcript');
  const position=page.locator('#canvas-position');
  await expect(position).toHaveText('Turn 1 of 3');
  const behavior=await pane.evaluateHandle(node=>{
    const modes:ScrollBehavior[]=[];
    const scroll=node.scrollTo.bind(node);
    node.scrollTo=(target?:ScrollToOptions|number,y?:number)=>{
      if(typeof target==='number') return scroll(target,y??0);
      modes.push(target?.behavior??'auto');
      scroll(target);
    };
    return modes;
  });
  await page.getByRole('button',{name:'Next source turn'}).click();
  await page.locator('.canvas-turn-handle').click();
  await expect.poll(()=>pane.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  expect(await behavior.evaluate(modes=>modes.includes('smooth'))).toBe(true);
  await behavior.evaluate(modes=>{modes.length=0});
  await pane.evaluate(node=>{node.scrollTop=node.scrollHeight});
  await expect(position).toHaveText('Turn 3 of 3');
  await expect(token(page,'b2')).not.toBeInViewport();
  await page.getByRole('button',{name:'Previous source turn'}).click();
  await expect(position).toHaveText('Turn 2 of 3');
  expect(await behavior.evaluate(modes=>modes.includes('smooth'))).toBe(true);
  await expect(token(page,'b2')).toBeInViewport();
  const scrub=page.getByRole('slider',{name:'Scrub source turns'});
  await scrub.press('End');
  await expect(position).toHaveText('Turn 3 of 3');
  expect(await behavior.evaluate(modes=>modes.at(-1))).toBe('instant');
  await expect(token(page,'c6')).toBeInViewport();
  await behavior.dispose();
});

test('canvas navigation and sizing preserve a live source selection for co-analysis', async ({page, practiceUrl}, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(practiceUrl);
  await expect(token(page, 'a1')).toBeVisible();
  const initial = await head(page);
  const source = await token(page, 'b2').elementHandle();
  await launcher(page).click();
  const tools = page.locator('#canvas-tools');
  await expect(tools).toBeVisible();
  await expect(page.locator('#canvas-position')).toContainText('1 of 3');
  await expect(page.getByRole('button', {name: 'Previous source turn'})).toBeDisabled();
  await page.getByRole('button', {name: 'Next source turn'}).click();
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  await expect(token(page, 'b2')).toBeInViewport();
  const firstSize = await fontSize(token(page, 'b2'));
  await page.getByRole('button', {name: 'Increase text size'}).click();
  await expect.poll(() => fontSize(token(page, 'b2'))).toBeGreaterThan(firstSize);
  await page.getByRole('button', {name: 'Decrease text size'}).click();
  await expect.poll(() => fontSize(token(page, 'b2'))).toBe(firstSize);
  await expect(page.locator('#canvas-scale')).toHaveText('100%');
  const scrub = page.getByRole('slider', {name: 'Scrub source turns'});
  await scrub.focus();
  await scrub.press('End');
  await expect(page.locator('#canvas-position')).toContainText('3 of 3');
  await expect(page.getByRole('button', {name: 'Next source turn'})).toBeDisabled();
  await expect(token(page, 'c6')).toBeInViewport();
  await scrub.press('ArrowLeft');
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  const pane = page.locator('.transcript');
  const beforePan = await pane.evaluate(node => node.scrollTop);
  const margin = (await pane.boundingBox())!;
  const x = margin.x + 5, y = margin.y + margin.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 110, {steps: 8});
  await page.mouse.up();
  await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeGreaterThan(beforePan + 60);
  await scrub.focus();
  await scrub.press('Home');
  await scrub.press('ArrowRight');
  await expect(page.locator('#canvas-position')).toContainText('2 of 3');
  expect(await source!.evaluate(node => node === document.querySelector('#tokens [data-token="b2"] .reading-text'))).toBe(true);
  await nativeSelection(page, 'b2', 'b4');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('only heard after');
  await info.attach('Reading canvas with native selection', {body: await page.screenshot(), contentType: 'image/png'});
  await page.getByRole('button', {name: 'Co-analyse selected tokens'}).click();
  await expect(page.getByRole('button',{name:'Exit reading canvas'})).toBeHidden();
  await expect(tools).toBeVisible();
  await expect(page.locator('.ca-source blockquote')).toHaveText('only heard after');
  await expect(page.locator('.ca-source details')).toContainText('b2, b3, b4');
  expect(await head(page)).toEqual(initial);
  expect(errors).toEqual([]);
});

test('canvas controls fit a phone and Escape keeps a correction recoverable on its token', async ({page, practiceUrl}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(practiceUrl);
  const open = launcher(page);
  await open.focus();
  await open.press('Enter');
  const tools = page.locator('#canvas-tools');
  await expect(tools).toBeVisible();
  await expect(page.locator('#canvas-position')).toContainText('1 of 3');
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    const geometry = await page.evaluate(() => {
      const bounds = [...document.querySelectorAll<HTMLElement>('#canvas-tools :is(button,input)')]
        .filter(el => el.getClientRects().length)
        .map(el => el.getBoundingClientRect());
      return {
        pageFits: document.documentElement.scrollWidth <= innerWidth,
        controlsFit: bounds.every(box => box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight),
      };
    });
    expect(geometry).toEqual({pageFits: true, controlsFit: true});
  }
  await info.attach('Reading canvas at 390 pixels', {body: await page.screenshot(), contentType: 'image/png'});
  const exit = page.getByRole('button', {name: 'Exit reading canvas'});
  await exit.focus();
  await exit.press('Escape');
  await expect(exit).toBeHidden();
  await expect(tools).toBeVisible();
  await expect(open).toBeFocused();
  await open.press('Enter');
  await nativeSelection(page, 'a4', 'a4');
  await page.getByRole('button', {name: 'Correct', exact: true}).click();
  const input = page.getByRole('textbox', {name: 'Proposed correction'});
  await input.fill('printed poster');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.locator('#tokens .selected')).toHaveCount(0);
  await expect(exit).toBeVisible();
  await page.getByRole('button',{name:'Recover correction',exact:true}).click();
  await expect(input).toHaveValue('printed poster');
  expect((await head(page)).id).toBe(1);
  await page.getByRole('button', {name: 'Undo draft'}).click();
  await expect(input).toHaveCount(0);
  await expect(token(page, 'a4')).toHaveText('notice');
  expect((await head(page)).id).toBe(1);
});

test('clicks, context tools and Escape have separate effects in focus mode',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await launcher(page).click();
  const selected=page.locator('#tokens .lexeme.selected');
  const tools=page.getByRole('toolbar',{name:'Selection tools'});
  await token(page,'b2').click();
  await expect(selected).toHaveCount(1);
  await expect(tools).toBeHidden();
  await token(page,'b4').click({modifiers:['Shift']});
  await expect(selected).toHaveCount(3);
  await expect(tools).toBeHidden();
  await token(page,'b3').click({button:'right'});
  await expect(tools).toBeVisible();
  await expect(selected).toHaveCount(3);
  await tools.getByRole('button',{name:'Pin on canvas'}).click();
  await expect(page.locator('.passage-pinned')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(selected).toHaveCount(0);
  await expect(page.locator('.passage-pin-handle')).toHaveCount(0);
  await expect(page.locator('#canvas-exit')).toBeVisible();
  await nativeSelection(page,'b2','b4');
  const pane=(await page.locator('.transcript').boundingBox())!;
  await page.mouse.click(pane.x+4,pane.y+pane.height/2);
  await expect(tools).toBeHidden();
  await expect(selected).toHaveCount(0);
  expect(await page.evaluate(()=>window.getSelection()?.toString())).toBe('');
  await page.locator('#tokens').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tokens .lexeme').first()).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(tools.getByRole('button',{name:'Correct',exact:true})).toBeFocused();
  await expect(selected).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(selected).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#canvas-exit')).toBeHidden();
});
