import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('..'),runtime=resolve(root,'.private',`browser-controls-${process.pid}`);
const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
let service:ChildProcess,code='';
test.beforeAll(async()=>{
  if(existsSync(runtime))throw new Error('Fresh synthetic authority required');
  for(const folder of ['Resources','xmlfiles','Audio'])mkdirSync(resolve(runtime,'package',folder),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  const text=Array.from({length:90},(_,i)=>`<u id='u${i}' start='0' end='8'><tok id='w${i}'>SYNTHETIC${i}</tok> <tok id='timed${i}' start='1' end='2'>timed</tok>.</u>`).join('\n');
  writeFileSync(resolve(runtime,'package/xmlfiles/controls.xml'),`<TEI><teiHeader><title>SYNTHETIC control qualification</title><media url='tone.wav'/></teiHeader><text>${text}</text></TEI>`);
  writeFileSync(resolve(runtime,'package/xmlfiles/silent.xml'),"<TEI><teiHeader><title>SYNTHETIC no recording</title></teiHeader><text><tok id='silent'>No media</tok></text></TEI>");
  execFileSync('python',['-c',`import wave,math,struct;w=wave.open(r'${resolve(runtime,'package/Audio/tone.wav')}','wb');w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b''.join(struct.pack('<h',int(1200*math.sin(2*math.pi*220*i/16000))) for i in range(128000)));w.close()`]);
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','controls']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','controls','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);
  code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(r=>service.once('exit',()=>r()))}});
async function open(page:Page){await page.goto('/#session='+code);await expect(page.locator('[data-token="w0"]')).toBeVisible();await expect(page.locator('#audio-play')).toBeEnabled()}
async function range(page:Page,selector:string,value:number,step:number){await page.locator(selector).focus();await page.keyboard.press('Home');for(let i=0;i<Math.round(value/step);i++)await page.keyboard.press('ArrowRight')}
async function seek(page:Page,value:string){await range(page,'#audio-seek',Number(value),.1)}

test('view radios, switches and grouped navigation expose real keyboard state and persist preferences',async({page})=>{
  await open(page);
  const flow=page.getByRole('radio',{name:'Flowing paragraphs',exact:true}),lines=page.getByRole('radio',{name:'Source lines',exact:true});
  await flow.focus();await page.keyboard.press('ArrowRight');await expect(lines).toBeChecked();await expect(lines).toBeFocused();await expect(page.locator('#tokens')).toHaveAttribute('data-layout','lines');
  const interlinear=page.getByRole('switch',{name:'Interlinear',exact:true});await interlinear.focus();await page.keyboard.press('Space');await expect(interlinear).toBeChecked();await expect(page.locator('#tokens')).toHaveAttribute('data-interlinear','true');
  await page.reload();await expect(lines).toBeChecked();await expect(interlinear).toBeChecked();
  await page.getByRole('button',{name:'Documents',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('button',{name:'Sources',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Sources',exact:true})).toBeFocused();
  await page.keyboard.press('Home');await expect(page.getByRole('button',{name:'Documents',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('switch',{name:'Loop selection',exact:true}).check();await expect(page.locator('#loop-selection')).toBeChecked();
  await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('button',{name:'History',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('heading',{name:'Per-edit history',exact:true})).toBeVisible();
});

test('custom player performs actual play, pause, seek, volume, rate and end transitions without autoplay',async({page})=>{
  await open(page);const audio=page.locator('#audio');
  expect(await audio.evaluate((a:HTMLAudioElement)=>({paused:a.paused,controls:a.controls,currentTime:a.currentTime}))).toEqual({paused:true,controls:false,currentTime:0});
  await audio.evaluate((a:HTMLAudioElement)=>{(window as any).mediaEvents=[];for(const e of ['play','pause','seeked','ratechange','volumechange','ended'])a.addEventListener(e,()=>{(window as any).mediaEvents.push(e)})});
  await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(0.1);await expect(page.getByRole('button',{name:'Pause recording',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await seek(page,'3');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(3,1);
  await page.getByRole('slider',{name:'Seek recording',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(3.1,1);
  await range(page,'#audio-volume',.4,.05);expect(await audio.evaluate((a:HTMLAudioElement)=>a.volume)).toBeCloseTo(.4);
  await page.getByRole('button',{name:'Mute recording',exact:true}).click();await expect(page.locator('#audio-mute')).toHaveAttribute('aria-pressed','true');expect(await audio.evaluate((a:HTMLAudioElement)=>a.muted)).toBe(true);
  await range(page,'#audio-volume',.5,.05);expect(await audio.evaluate((a:HTMLAudioElement)=>a.muted)).toBe(false);
  await page.getByRole('combobox',{name:'Speed',exact:true}).selectOption('1.5');expect(await audio.evaluate((a:HTMLAudioElement)=>a.playbackRate)).toBe(1.5);
  await seek(page,'7.8');await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect(page.locator('#audio-status')).toHaveText('Recording ended');await expect(page.getByRole('button',{name:'Play recording from start',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Play recording from start',exact:true}).click();await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeLessThan(2);await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).mediaEvents)).toEqual(expect.arrayContaining(['play','pause','seeked','volumechange','ratechange','ended']));
});

test('resizing panes preserves running audio and collapsed controls, and nested overflow remains scrollable',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Play recording',exact:true}).click();const audio=page.locator('#audio'),source=await audio.getAttribute('src');
  await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','expanded');
  await expect(page.locator('#recording-layers')).toContainText('Word timing');expect(await audio.getAttribute('src')).toBe(source);expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
  await page.locator('#recording-layers').hover();await page.mouse.wheel(0,320);await expect.poll(()=>page.locator('#recording-layers').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  await page.locator('#timeline-resizer').focus();await page.keyboard.press('Home');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','minimal');await expect(page.locator('#audio-play')).toBeVisible();
  const fits=await page.locator('#audio-play').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('#recording-pane')!.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom});expect(fits).toBe(true);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await page.locator('#properties-resizer').focus();await page.keyboard.press('End');await expect(page.locator('#properties-resizer')).toHaveAttribute('aria-valuenow','520');
  await page.locator('.transcript').hover();await page.mouse.wheel(0,900);await expect.poll(()=>page.locator('.transcript').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.transcript').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});

test('both themes and mobile widths keep custom controls within the pane and Material Symbols local',async({page})=>{
  const external:string[]=[];page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:18912/'))external.push(request.url())});
  await open(page);await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('20px "Material Symbols Outlined"'))).toBe(true);
  for(const width of [1440,820,390,320]){
    await page.setViewportSize({width,height:width>700?1000:844});
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'Dark appearance',exact:true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      for(const control of ['#audio-play','#audio-seek','#audio-mute','#audio-volume','#audio-speed','#listen-selected','#loop-selection'])expect(await page.locator(control).evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('#recording-pane')!.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom}),control).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(width<=700){await page.getByRole('button',{name:'Tools',exact:true}).click();await expect(page.locator('.inspector')).toBeVisible();await page.getByRole('button',{name:'Tools',exact:true}).click()}
    }
  }
  expect(external).toEqual([]);
});

test('missing and failed media have honest unavailable states and never expose native controls',async({page})=>{
  await open(page);await page.locator('[data-document="xmlfiles/silent.xml"]').click();await expect(page.locator('#audio-availability')).toBeVisible();await expect(page.getByRole('group',{name:'Recording playback',exact:true})).toBeHidden();await expect(page.getByRole('switch',{name:'Loop selection',exact:true})).toBeDisabled();
  await page.route('**/api/media?**',route=>route.abort());await page.locator('[data-document="xmlfiles/controls.xml"]').click();await expect(page.locator('#audio-status')).toContainText('Recording unavailable');await expect(page.locator('#audio-play')).toBeDisabled();expect(await page.locator('#audio').evaluate((a:HTMLAudioElement)=>a.controls)).toBe(false);
});

test('forced colors restores system scrollbars and controls, and reduced motion disables switch animation',async({page})=>{
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await open(page);
  expect(await page.locator('.transcript').evaluate(e=>getComputedStyle(e).scrollbarWidth)).toBe('auto');
  expect(await page.locator('#show-interlinear').evaluate(e=>getComputedStyle(e).appearance)).toBe('auto');
  expect(await page.locator('#show-interlinear').evaluate(e=>getComputedStyle(e,'::before').transitionDuration)).toBe('0s');
  await page.getByRole('switch',{name:'Interlinear',exact:true}).check();await expect(page.locator('#tokens')).toHaveAttribute('data-interlinear','true');
  await page.emulateMedia({forcedColors:'none',contrast:'more'});expect(await page.locator('.transcript').evaluate(e=>getComputedStyle(e).scrollbarWidth)).toBe('auto');
});

test('a new search cannot replay the prior hit through retained custom controls',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Corpus search',exact:true}).click();
  await page.getByLabel('Exact token sequence',{exact:true}).fill('SYNTHETIC0');await page.getByRole('button',{name:'Search corpus',exact:true}).click();await expect(page.locator('#corpus-search-status')).toContainText('1 hits');
  await page.getByRole('button',{name:'Play utterance',exact:true}).click();await expect.poll(()=>page.locator('#search-audio').evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(.1);await expect(page.locator('#search-audio-play')).toBeVisible();
  await page.getByLabel('Exact token sequence',{exact:true}).fill('ABSENT-SYNTHETIC');await expect(page.locator('#search-audio-play')).toBeHidden();
  await page.getByRole('button',{name:'Search corpus',exact:true}).click();await expect(page.locator('#corpus-search-status')).toContainText('0 hits');await expect(page.locator('#search-audio-play')).toBeHidden();await expect(page.locator('#search-audio-basis')).toBeEmpty();
  expect(await page.locator('#search-audio').getAttribute('src')).toBeNull();expect(await page.locator('#search-audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
});

test('collapsed recording pane keeps loading, error and ended explanations fully visible after resizing',async({page})=>{
  await open(page);await page.locator('#timeline-resizer').focus();await page.keyboard.press('Home');
  await seek(page,'7.8');await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect(page.locator('#audio-status')).toHaveText('Recording ended');
  const fits=()=>page.locator('#audio-status').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('#recording-pane')!.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom});
  for(const width of [1440,1101,820,700,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(fits).toBe(true)}
  await page.route('**/api/media?**',route=>route.abort());await page.reload();await expect(page.locator('#audio-status')).toContainText('Recording unavailable');
  for(const width of [1440,1101,820,700,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(fits).toBe(true)}
  await page.locator('#timeline-resizer').focus();for(let i=0;i<13;i++)await page.keyboard.press('ArrowUp');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','expanded');
  for(const width of [1440,1101,820,700,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('#recording-layers').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('#recording-pane')!.getBoundingClientRect();return r.height>0&&r.top>=p.top&&r.bottom<=p.bottom})).toBe(true)}
  await page.locator('#timeline-resizer').focus();await page.keyboard.press('Home');
  await page.unroute('**/api/media?**');let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/api/media?**',async route=>{await held;await route.continue()});await page.reload();await expect(page.locator('#audio-status')).toContainText('Loading recording');
  for(const width of [1440,1101,820,700,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(fits).toBe(true)}
  release();await expect(page.locator('#audio-play')).toBeEnabled();
  await page.getByRole('button',{name:'Expand recording panel',exact:true}).click();await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','compact');await expect(page.getByRole('button',{name:'Show recording timeline',exact:true})).toBeVisible();
});
