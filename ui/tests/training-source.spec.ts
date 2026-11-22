import {expect,test} from '@playwright/test';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

declare global {
  interface Window {trainingPlayback?:HTMLAudioElement; trainingStartedAt?:number}
}

test('saved comparison context plays its original bounded audio while an unrecorded seed stays text-only',async({page})=>{
  const root=resolve('..'),run=mkdtempSync(resolve(tmpdir(),'wb-training-listen-'));
  const pkg=resolve(run,'package');
  for(const dir of ['Resources','xmlfiles','Audio'])mkdirSync(resolve(pkg,dir),{recursive:true});
  writeFileSync(resolve(pkg,'Resources/settings.xml'),'<ttsettings/>');
  writeFileSync(resolve(pkg,'xmlfiles/a.xml'),"<TEI><teiHeader><title>Unrecorded source</title></teiHeader><text><u id='seed-turn' start='0' end='1'><tok id='seed'>notice</tok></u></text></TEI>");
  writeFileSync(resolve(pkg,'xmlfiles/b.xml'),"<TEI><teiHeader><title>Recorded source</title><media url='comparison.wav'/></teiHeader><text><u id='comparison-turn' start='0' end='3'><tok id='comp' start='0.7' end='1.8'>notice</tok></u></text></TEI>");
  const tone=[
    'import math, struct, sys, wave',
    'with wave.open(sys.argv[1], "wb") as wav:',
    '  wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))',
    '  wav.writeframes(b"".join(struct.pack("<h", int(1500*math.sin(2*math.pi*330*i/8000))) for i in range(24000)))',
  ].join('\n');
  execFileSync('python',['-c',tone,resolve(pkg,'Audio/comparison.wav')]);
  const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
  const authority=['--store',resolve(run,'authority'),'--project','training-listen'];
  execFileSync(binary,['import',...authority,'--package',pkg]);
  const server=spawn(binary,['serve',...authority,'--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','0'],{cwd:run,stdio:'pipe'});
  try {
    const launcher=resolve(run,'.runtime/Open-Workbench.html');
    await expect.poll(()=>existsSync(launcher)).toBe(true);
    const origin=readFileSync(launcher,'utf8').match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    await page.addInitScript(()=>{
      // Source excerpts use detached native Audio elements. Capture their identity
      // for observation while the browser still loads, decodes, seeks and plays.
      const nativePlay=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){
        if(this instanceof HTMLAudioElement&&!this.isConnected){
          window.trainingPlayback=this;
          window.trainingStartedAt=this.currentTime;
        }
        return nativePlay.call(this);
      };
    });
    await page.goto(origin+'/#session='+readFileSync(resolve(run,'.runtime/session-code'),'utf8'));
    await page.locator('[data-token="seed"]').click();
    await page.locator('#rail-training').click();
    const training=page.locator('#training-panel');
    await training.getByRole('radio',{name:'Similar wording'}).check();
    const seed=training.locator('[data-training-seed]');
    await seed.locator('summary').click();
    await expect(seed.locator('.training-context mark')).toHaveText('notice');
    await expect(seed.getByRole('button',{name:/Listen/})).toHaveCount(0);
    await training.getByLabel('Collection name').fill('Recorded practice');
    await training.getByLabel('Relationship').fill('Same meaning');
    await training.getByRole('button',{name:'Save reviewed example'}).click();
    await expect(page.locator('#save-state')).toContainText('Saved R2');
    await page.evaluate(async()=>{
      const view=await (await fetch('/api/view')).json();
      const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-WB-CSRF':sessionStorage.getItem('wb-csrf')!},
        body:JSON.stringify({schema:1,project:view.snapshot.project,command_id:'correct-current-comparison',base_revision:view.revision.id,
          preimage_hash:view.revision.snapshot_hash,config_version:view.snapshot.config.version,label:'Correct the comparison at head',
          operations:[{kind:'set_token',document:'xmlfiles/b.xml',token:'comp',fields:{nform:'announcement'}}]})});
      if(!response.ok)throw new Error(await response.text());
    });
    await page.reload();
    await expect(page.locator('#save-state')).toContainText('Saved R3');
    await page.locator('#rail-training').click();
    await training.getByRole('button',{name:'Saved collections'}).click();
    await training.locator('.training-record > summary').click();
    const comparison=training.locator('.training-record .training-source').filter({hasText:'Comparison passage'});
    await comparison.locator('summary').click();
    await expect(comparison.locator('.training-context mark')).toHaveText('notice');
    await expect(comparison.getByText('R1',{exact:true})).toBeVisible();
    const listen=comparison.getByRole('button',{name:/Listen · word timing/});
    await expect(listen).toBeEnabled();
    const media=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.pathname==='/api/media'&&url.searchParams.get('path')==='Audio/comparison.wav'&&url.searchParams.get('revision')==='1';
    });
    await listen.click();
    expect((await media).ok()).toBe(true);
    await expect(comparison.getByRole('button',{name:'Stop excerpt'})).toBeVisible();
    expect(await page.evaluate(()=>window.trainingStartedAt)).toBeCloseTo(0.7,2);
    await expect.poll(()=>page.evaluate(()=>{
      const audio=window.trainingPlayback;
      return !!audio&&!audio.paused&&audio.duration===3&&audio.currentTime>=0.7&&audio.currentTime<1.8;
    })).toBe(true);
    await expect(listen).toBeVisible();
    const stopped=await page.evaluate(()=>({paused:window.trainingPlayback!.paused,time:window.trainingPlayback!.currentTime}));
    expect(stopped.paused).toBe(true);
    expect(stopped.time).toBeGreaterThanOrEqual(1.79);
    expect(stopped.time).toBeLessThan(2.05);
    await listen.click();
    await expect(comparison.getByRole('button',{name:'Stop excerpt'})).toBeVisible();
    await comparison.locator('summary').click();
    await expect.poll(()=>page.evaluate(()=>window.trainingPlayback?.paused)).toBe(true);
  } finally {
    if(server.exitCode===null&&server.signalCode===null){
      const exited=new Promise<void>(done=>server.once('exit',()=>done()));
      server.kill();await exited;
    }
  }
});
