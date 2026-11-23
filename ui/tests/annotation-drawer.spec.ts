import {expect} from '@playwright/test';
import {test} from './practice-fixture';

test('saved annotations lead with their source and disclose the stored fields', async ({page, practiceUrl}, info) => {
  await page.setViewportSize({width:390, height:844});
  await page.goto(practiceUrl);
  await expect(page.locator('#tokens [data-token=a1]')).toBeVisible();
  await page.evaluate(async () => {
    const view = await (await fetch('/api/view')).json();
    const document = 'xmlfiles/noticeboard.xml';
    const response = await fetch('/api/command', {
      method:'POST', headers:{'Content-Type':'application/json', 'X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},
      body:JSON.stringify({schema:1, project:view.snapshot.project, command_id:'seed-annotation-drawer',
        base_revision:view.revision.id, preimage_hash:view.revision.snapshot_hash, config_version:view.snapshot.config.version,
        label:'Annotate fictional noticeboard dialogue', operations:[
          {kind:'add_span', document, id:'an-earlier', token_ids:['a1','a4'], fields:{label:'Shared notice'}, character:null},
          {kind:'add_span', document, id:'an-later', token_ids:['b2','b3','b4'],
            fields:{label:'Timing',note:'The timing qualifies who could act on the notice.'}, character:null},
        ]})
    });
    if (!response.ok) throw new Error(await response.text());
  });
  await page.reload();
  await page.locator('#toggle-properties').click();
  await page.getByRole('button',{name:'Annotations',exact:true}).click();

  const rows = page.locator('details[data-saved-annotation]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator(':scope > summary')).toContainText('We … notice');
  const later = rows.filter({has:page.locator('summary .annotation-summary strong', {hasText:'only heard after'})});
  const summary = later.locator(':scope > summary');
  await expect(summary).toContainText('Annotation · Timing');
  await expect(later.locator('.annotation-note')).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(later.locator('.annotation-note')).toHaveText('The timing qualifies who could act on the notice.');
  await expect(later.locator('.annotation-source')).toContainText('turn-2');
  await expect(later.locator('pre')).toBeHidden();
  const capture=info.outputPath('phone-annotation-detail.png');
  await page.locator('.inspector').screenshot({path:capture});
  await info.attach('Phone annotation detail', {path:capture,contentType:'image/png'});
  await later.getByText('Source record',{exact:true}).click();
  await expect(later.locator('pre')).toContainText('"label": "Timing"');
  await expect(later.locator('dd')).toContainText(['xmlfiles/noticeboard.xml', 'Annotations/', 'an-later', 'b2 → b3 → b4']);
  await later.getByRole('button',{name:'Edit span an-later'}).click();
  await expect(later.getByLabel('Saved span label')).toBeFocused();
});
