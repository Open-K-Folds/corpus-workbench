import {expect,type Page} from '@playwright/test';
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test as practice} from './practice-fixture';

const words=['artichoke','saffron','iris','pépper','poppy','fennel','ginger','basil','parsley','mint'];
const test=practice.extend({
  practicePackage:async({},use)=>{
    const pkg=await mkdtemp(join(tmpdir(),'wb-drag-garden-'));
    try {
      await mkdir(join(pkg,'Resources'));await mkdir(join(pkg,'xmlfiles'));
      await copyFile(resolve('../fixtures/coanalysis/Resources/settings.xml'),join(pkg,'Resources/settings.xml'));
      const tokens=Array.from({length:1400},(_,i)=>`<tok id="w${i}">${words[i%words.length]}</tok>`).join(' ');
      await writeFile(join(pkg,'xmlfiles/garden.xml'),`<TEI><teiHeader><title>Synthetic garden</title></teiHeader><text><body><p>${tokens}</p></body></text></TEI>`);
      await use(pkg);
    } finally {await rm(pkg,{recursive:true,force:true})}
  },
});

function word(page:Page,i:number){return page.locator(`#tokens [data-token="w${i}"] .reading-text`)}
async function point(page:Page,i:number,offset:number){
  return word(page,i).evaluate((el,offset)=>{
    const text=el.firstChild as Text,range=document.createRange();
    range.setStart(text,offset);range.collapse(true);
    const rect=range.getBoundingClientRect();
    return {x:rect.left+(offset===text.length ? -0.5 : 0.5),y:rect.top+rect.height/2};
  },offset);
}
function activeText(page:Page){return page.evaluate(()=>getSelection()?.toString())}
const selected=(page:Page)=>page.locator('#tokens .lexeme.selected').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-token')));
const ids=(start:number,end:number)=>Array.from({length:end-start+1},(_,n)=>'w'+(start+n));
const phrase=(start:number,end:number)=>Array.from({length:end-start+1},(_,n)=>words[(start+n)%10]).join(' ');

test('ordinary mouse drag previews a wrapped passage and releases exactly its source IDs, then starts a new range inside it',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await word(page,110).evaluate(el=>el.scrollIntoView({block:'center'}));
  const tools=page.getByRole('toolbar',{name:'Selection tools'});
  const start=await point(page,105,0),end=await point(page,123,words[3].length);
  expect(end.y).toBeGreaterThan(start.y);
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:14});
  await expect.poll(()=>activeText(page)).toBe(phrase(105,123));
  await expect(tools).toBeHidden();
  await page.mouse.up();
  await expect(tools).toBeVisible();
  await expect.poll(()=>selected(page)).toEqual(ids(105,123));
  const inside=await point(page,113,words[3].length),back=await point(page,107,0);
  await page.mouse.move(inside.x,inside.y);await page.mouse.down();
  await page.mouse.move(back.x,back.y,{steps:14});
  await expect.poll(()=>activeText(page)).toBe(phrase(107,113));
  await expect(tools).toBeHidden();await page.mouse.up();
  await expect.poll(()=>selected(page)).toEqual(ids(107,113));
  await tools.getByRole('button',{name:'Co-analyse selected tokens'}).click();
  await expect(page.locator('.ca-source blockquote')).toHaveText(phrase(107,113));
  await expect(page.locator('.ca-source details')).toContainText(ids(107,113).join(', '));
});

test('dragging part of a Unicode word opens an exact correction and survives undo',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await word(page,113).evaluate(el=>el.scrollIntoView({block:'center'}));
  const right=await point(page,113,4),left=await point(page,113,1);
  await page.mouse.move(right.x,right.y);await page.mouse.down();
  await page.mouse.move(left.x,left.y,{steps:6});await page.mouse.up();
  await expect.poll(()=>activeText(page)).toBe('ép');
  await word(page,113).click({button:'right'});
  await expect.poll(()=>page.evaluate(()=>getSelection()?.anchorOffset)).toBe(4);
  const tools=page.getByRole('toolbar',{name:'Selection tools'});
  await tools.getByRole('button',{name:'Correct',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Proposed correction'})).toHaveValue('ép');
  await expect(page.locator('.draft-prefix')).toHaveText('p');await expect(page.locator('.draft-suffix')).toHaveText('per');
  await page.getByRole('button',{name:'Undo draft'}).click();
  await expect.poll(()=>activeText(page)).toBe('ép');
  await expect.poll(()=>page.evaluate(()=>getSelection()?.anchorOffset)).toBe(4);
});

test('holding an ordinary drag at the bottom scrolls through the document and stops on release',async({page,practiceUrl})=>{
  await page.goto(practiceUrl);
  await word(page,110).evaluate(el=>el.scrollIntoView({block:'center'}));
  const pane=page.locator('.transcript'),rect=(await pane.boundingBox())!;
  const start=await point(page,110,0);
  const scrollTop=()=>pane.evaluate(el=>el.scrollTop);
  const before=await scrollTop();
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x,rect.y+rect.height-2,{steps:12});
  await expect.poll(scrollTop).toBeGreaterThan(before+45);
  await page.mouse.up();
  const stopped=await scrollTop();
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  expect(await scrollTop()).toBe(stopped);
  const result=await selected(page);
  expect(result[0]).toBe('w110');
  expect(Number(result.at(-1)?.slice(1))).toBeGreaterThan(125);
});
