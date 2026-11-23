import {expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
