import {expect} from '@playwright/test';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test as practice} from './practice-fixture';

const test=practice.extend({
  practicePackage:async({},use)=>{
    const path=mkdtempSync(join(tmpdir(),'wb-annotation-source-'));
    for(const dir of ['Resources','xmlfiles','Annotations'])mkdirSync(join(path,dir));
    writeFileSync(join(path,'Resources/settings.xml'),'<ttsettings/>');
    writeFileSync(join(path,'xmlfiles/notes.xml'),'<TEI><teiHeader><fileDesc><titleStmt><title>Field notes</title></titleStmt></fileDesc></teiHeader><text><u id="turn-1"><tok id="one" nform="a🙂bc">abc</tok> <tok id="two">walked</tok> <tok id="three">home</tok></u></text></TEI>');
    writeFileSync(join(path,'Annotations/review_notes.xml'),`<spanGrp>
      <span id="a" corresp="#one #three" label="Two locations" note="Compare the ends of the phrase."/>
      <span id="b" corresp="#one" label="Character note" wb_start="1" wb_end="2" wb_quote="🙂" wb_coordinate="unicode-codepoint" wb_layer="corrected" wb_status="resolved"/>
      <span id="c" corresp="#two" label="Needs review" wb_start="0" wb_end="3" wb_quote="old" wb_coordinate="unicode-codepoint" wb_layer="corrected" wb_status="unresolved"/>
    </spanGrp>`);
    await use(path);
  }
});

test('margin notes preserve Unicode and discontinuous evidence and dismiss independently of the source selection',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  const pin=page.getByRole('button',{name:'2 annotations here, starting with Two locations'});
  const detail=page.getByRole('dialog',{name:'Two locations'});
  const first=page.locator('[data-token="one"] .reading-text');
  await page.locator('[data-token="three"] .reading-text').hover();
  await expect(page.locator('.saved-span-frame')).toHaveCount(2);
  await expect(detail).toBeHidden();
  await page.locator('[data-token="two"] .reading-text').click();
  await pin.focus();
  await expect(page.locator('.saved-span-frame')).toHaveCount(2);
  await pin.press('Enter');
  await expect(detail.getByRole('blockquote')).toHaveText('a🙂bc … home');
  await expect(detail).toContainText('Compare the ends of the phrase.');
  await expect(detail.getByRole('button',{name:'Close annotation detail'})).toBeFocused();
  await test.info().attach('Discontinuous note in the reader',{body:await page.screenshot(),contentType:'image/png'});
  await detail.getByRole('button',{name:'Next annotation here'}).click();
  await expect(page.getByRole('dialog',{name:'Character note'}).getByRole('blockquote')).toHaveText('🙂');
  await expect(pin).toHaveAttribute('data-mark','2');
  await expect(page.locator('.saved-mark-index')).toHaveText('2 / 2');
  await expect(page.locator('.saved-span-frame')).toHaveCount(1);
  const exact=await first.evaluate(e=>{
    const range=document.createRange();range.setStart(e.firstChild!,1);range.setEnd(e.firstChild!,3);
    return range.getBoundingClientRect().width;
  });
  expect((await page.locator('.saved-span-frame').boundingBox())!.width).toBeCloseTo(exact+2,0);
  await page.keyboard.press('Escape');await expect(pin).toBeFocused();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('[data-token="two"]')).toHaveClass(/selected/);
  await pin.click();await page.getByRole('heading',{name:'Field notes'}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.reading-settings > summary').click();
  await page.locator('#reading-layer').selectOption('original');
  await expect(page.locator('.saved-annotation-pin')).toHaveCount(0);
  await page.locator('#reading-layer').selectOption('corrected');
  await expect(pin).toBeVisible();
  await page.locator('.reading-settings > summary').click();
  await page.locator('#find-in-transcript').click();
  await page.locator('#token-query').fill('home');
  await expect(page.locator('#tokens .lexeme.filtered').first()).toBeAttached();
  await expect(page.locator('.saved-annotation-pin')).toHaveCount(0);
});

test('enlarging transcript text keeps the margin pin inside the scrollable reading area',async({page,practiceUrl})=>{
  await page.setViewportSize({width:850,height:800});
  await page.goto(practiceUrl);
  const pin=page.locator('.saved-annotation-pin');
  await expect(pin).toBeVisible();
  for(let i=0;i<15;i++)await page.locator('#canvas-zoom-in').click();
  await expect(page.locator('#canvas-scale')).toHaveText('250%');
  await expect.poll(()=>pin.evaluate(button=>{
    const pane=button.closest<HTMLElement>('.transcript')!;
    return button.getBoundingClientRect().right<=pane.getBoundingClientRect().left+pane.clientLeft+pane.clientWidth && pane.scrollWidth===pane.clientWidth;
  })).toBe(true);
});

test.describe('phone',()=>{
  test.use({isMobile:true,hasTouch:true});
  test('touch margin target and note stay inside the reading pane after reflow',async({page,practiceUrl})=>{
    await page.setViewportSize({width:320,height:640});
    await page.goto(practiceUrl);
    const pin=page.locator('.saved-annotation-pin').first();
    await pin.click();
    const card=page.getByRole('dialog',{name:'Two locations'});
    await expect(card).toBeVisible();
    for(const control of [card,pin]){
      const box=(await control.boundingBox())!,pane=(await page.locator('.transcript').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(pane.x);
      expect(box.x+box.width).toBeLessThanOrEqual(pane.x+pane.width);
    }
    await expect(page.locator('.saved-span-tether')).toBeVisible();
    await test.info().attach('Phone annotation detail',{body:await page.screenshot(),contentType:'image/png'});
    await card.getByRole('button',{name:'Close annotation detail'}).click();
    await expect(pin).toBeFocused();
  });
});


test.describe('recorded long passages',()=>{
  test.use({hasTouch:true,isMobile:true,practicePackage:async({},use)=>{
    const path=mkdtempSync(join(tmpdir(),'wb-annotation-recording-'));
    cpSync(resolve('../fixtures/spoken-reading'),path,{recursive:true});
    mkdirSync(join(path,'Annotations'));
    const xml=readFileSync(join(path,'xmlfiles/library-map.xml'),'utf8');
    const refs=[...xml.matchAll(/<tok id="([^"]+)"/g)].map(match=>'#'+match[1]).join(' ');
    writeFileSync(join(path,'Annotations/review_library-map.xml'),`<spanGrp>
      <span id="a-long" corresp="${refs}" label="Whole account" note="${'Listen again to check the sequence. '.repeat(45)}End of note."/>
      <span id="b-part" corresp="#w1-1" label="Opening word" wb_start="1" wb_end="3" wb_quote="ve" wb_coordinate="unicode-codepoint" wb_layer="corrected" wb_status="resolved"/>
    </spanGrp>`);
    await use(path);
  }});
  test('a long quote and note scroll inside the card and an active saved character stays legible ahead of playback',async({page,practiceUrl})=>{
    await page.setViewportSize({width:320,height:640});
    await page.goto(practiceUrl);
    const first=page.locator('[data-token="w1-1"] > .reading-text');
    const other=page.locator('[data-token="w1-2"] > .reading-text');
    await expect(page.locator('#canvas-play')).toBeEnabled();
    await expect.poll(()=>other.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeLessThan(1);
    await page.locator('.saved-annotation-pin').first().tap();
    const card=page.getByRole('dialog',{name:'Whole account'});
    const content=card.getByRole('region',{name:'Annotation text'});
    await expect(content).toHaveAttribute('tabindex','0');
    expect(await content.evaluate(e=>e.scrollHeight)).toBeGreaterThan(await content.evaluate(e=>e.clientHeight));
    await content.focus();await content.press('End');
    await expect.poll(()=>content.evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight-1)).toBe(true);
    await expect(card.getByRole('button',{name:'Open in annotations'})).toBeInViewport({ratio:1});
    await expect(card.getByRole('button',{name:'Close annotation detail'})).toBeInViewport({ratio:1});
    await card.getByRole('button',{name:'Next annotation here'}).tap();
    await expect(first).toHaveCSS('opacity','1');
    await expect.poll(()=>other.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeLessThan(1);
    expect(await first.evaluate(()=>[...CSS.highlights.get('active-saved-annotation')!][0].toString())).toBe('ve');
    await expect(page.getByRole('dialog',{name:'Opening word'}).getByRole('blockquote')).toHaveText('ve');
  });
});
