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
  });
}
