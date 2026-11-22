import {expect} from '@playwright/test';
import {test} from './practice-fixture';

for (const width of [390, 1160]) {
  test(`passage tools stay inside the reading pane at ${width}px`, async ({page, practiceUrl}) => {
    await page.setViewportSize({width,height:680});
    await page.goto(practiceUrl);
    const word = page.locator('#tokens [data-token="b2"] .reading-text');
    await word.click({button:'right'});
    const tools = page.getByRole('toolbar',{name:'Selection tools'});
    await expect(tools).toBeVisible();
    await expect.poll(async () => {
      const popup = await tools.boundingBox(), pane = await page.locator('.transcript').boundingBox();
      if (!popup || !pane) return false;
      return popup.x >= pane.x && popup.y >= pane.y &&
        popup.x + popup.width <= pane.x + pane.width && popup.y + popup.height <= pane.y + pane.height;
    }).toBe(true);
    await tools.getByRole('button',{name:'Correct',exact:true}).click();
    const replacement = page.getByLabel('Proposed correction');
    await replacement.fill('a newly heard wording for this recording');
    await expect(page.locator('#accept-draft')).toBeEnabled();
    const panel = await page.locator('.transcript').boundingBox();
    for (const control of [replacement,page.locator('#accept-draft')]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel!.x + panel!.width);
    }
    await page.locator('.transcript').click({position:{x:4,y:55}});
    await expect(replacement).toHaveCount(0);
    await page.getByRole('button',{name:'Recover correction',exact:true}).click();
    await expect(replacement).toHaveValue('a newly heard wording for this recording');
  });
}

test.describe('touch passage tools',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  for(const focus of [false,true]){
    test(`tapping the selected count opens passage actions in ${focus?'focus mode':'the workspace'}`,async({page,practiceUrl})=>{
      // Measure the text-only workspace while its saved transcript is still loading.
      let showTranscript!:()=>void;
      const loading=new Promise<void>(resolve=>{showTranscript=resolve});
      await page.route('**/api/reading?*',async route=>{await loading;await route.continue()},{times:1});
      await page.goto(practiceUrl);
      if(focus)await page.getByRole('button',{name:'Open reading canvas'}).tap();
      const dock=page.locator('#canvas-tools');
      const before=await dock.boundingBox();
      showTranscript();
      await page.locator('[data-token="b3"] .reading-text').tap();
      const trigger=page.getByRole('button',{name:'Open tools for 1 selected word',exact:true});
      await expect(trigger).toBeInViewport();
      const box=(await trigger.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await dock.boundingBox()).toEqual(before);
      const tools=page.getByRole('toolbar',{name:'Selection tools'});
      await expect(tools).toBeHidden();
      await trigger.tap();
      await expect(tools).toBeVisible();
      await tools.getByRole('button',{name:'Tokenize',exact:true}).tap();
      await expect(page.getByLabel('New token ID 1',{exact:true})).toBeVisible();
      await expect(page.locator('[data-token="b3"]')).toHaveClass(/selected/);
    });
  }
});
