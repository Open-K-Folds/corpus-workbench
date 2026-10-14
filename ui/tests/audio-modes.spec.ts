import {test,expect,type Page} from '@playwright/test';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Generated tones only: no corpus recordings or transcript content enter this suite.
const root=resolve('..'),runtime=resolve(root,'.private',`browser-audio-modes-${process.pid}`);
const binary=process.env.WB_BINARY??resolve(root,'target/debug/corpus-workbench'+(process.platform==='win32'?'.exe':''));
let service:ChildProcess,code='';

function toneFixture(seconds=12,rate=16000){
  const samples=rate*seconds,bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<Math.min(samples,rate*8);i++){
    const t=i/rate,frequency=t<4?440:1800,envelope=t<8?Math.min(1,t/.05,(8-t)/.05):0;
    bytes.writeInt16LE(Math.round(15000*Math.max(0,envelope)*Math.sin(2*Math.PI*frequency*t)),44+i*2);
  }
  return bytes;
}

test.beforeAll(async()=>{
  if(existsSync(runtime))throw new Error('Fresh synthetic audio authority required');
  for(const folder of ['Resources','xmlfiles','Audio'])mkdirSync(resolve(runtime,'package',folder),{recursive:true});
  writeFileSync(resolve(runtime,'package/Resources/settings.xml'),'<ttsettings/>');
  const document=(title:string,media:string,text:string)=>`<TEI><teiHeader><title>${title}</title>${media?`<media url='${media}'/>`:''}</teiHeader><text>${text}</text></TEI>`;
  writeFileSync(resolve(runtime,'package/xmlfiles/alpha.xml'),document('SYNTHETIC frequency study','tones.wav',"<u id='u1' start='0' end='4'><tok id='low' start='1' end='2'>Low tone</tok></u><u id='u2' start='4' end='8'><tok id='high' start='5' end='6'>High tone</tok></u><u id='u3' start='8' end='12'><tok id='quiet' start='9' end='10'>Silence</tok></u>"));
  writeFileSync(resolve(runtime,'package/xmlfiles/beta.xml'),document('SYNTHETIC second recording','tones.wav',"<u id='other-u' start='0' end='12'><tok id='other' start='2' end='3'>Second document</tok></u>"));
  writeFileSync(resolve(runtime,'package/xmlfiles/corrupt.xml'),document('SYNTHETIC invalid recording','corrupt.wav',"<tok id='broken'>Invalid media fixture</tok>"));
  writeFileSync(resolve(runtime,'package/xmlfiles/long.xml'),document('SYNTHETIC long recording','long.wav',"<u id='long-u' start='0' end='601'><tok id='long' start='1' end='2'>Long recording fixture</tok></u>"));
  writeFileSync(resolve(runtime,'package/xmlfiles/silent.xml'),document('SYNTHETIC absent recording','',"<tok id='absent'>No recording fixture</tok>"));
  writeFileSync(resolve(runtime,'package/Audio/tones.wav'),toneFixture());
  writeFileSync(resolve(runtime,'package/Audio/long.wav'),toneFixture(601,8000));
  writeFileSync(resolve(runtime,'package/Audio/corrupt.wav'),'SYNTHETIC deliberately invalid WAV bytes');
  execFileSync(binary,['import','--store',resolve(runtime,'authority'),'--package',resolve(runtime,'package'),'--project','audio-modes']);
  service=spawn(binary,['serve','--store',resolve(runtime,'authority'),'--project','audio-modes','--ui',process.env.WB_UI??resolve(root,'ui/dist'),'--port','18912'],{cwd:runtime,stdio:'pipe'});
  await expect.poll(()=>existsSync(resolve(runtime,'.runtime/session-code'))).toBe(true);
  code=readFileSync(resolve(runtime,'.runtime/session-code'),'utf8');
  await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:18912/health/ready')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(service&&service.exitCode===null){service.kill();await new Promise<void>(done=>service.once('exit',()=>done()))}});

async function open(page:Page){
  await page.goto('/#session='+code);
  await expect(page.locator('[data-token="low"]')).toBeVisible();
  await expect(page.locator('#audio-play')).toBeEnabled();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','ready');
}
async function mode(page:Page,name:'Waveform'|'Spectrogram'|'Spectrum'){
  await page.getByRole('radio',{name,exact:true}).check();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-audio-view',name.toLowerCase());
}
async function seek(page:Page,seconds:number){
  const slider=page.getByRole('slider',{name:'Seek recording',exact:true});
  await slider.focus();await page.keyboard.press('Home');
  // Exercise the native range rather than dispatching synthetic implementation events.
  for(let i=0;i<Math.round(seconds*10);i++)await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeCloseTo(seconds,1);
}
async function canvasSignature(page:Page){return page.locator('#recording-waveform').evaluate((canvas:HTMLCanvasElement)=>{
  const data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  let hash=2166136261;for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);
  return hash>>>0;
})}
async function spectrumPeak(page:Page){return page.locator('#recording-waveform').evaluate((canvas:HTMLCanvasElement)=>{
  const {width,height}=canvas,data=canvas.getContext('2d')!.getImageData(0,0,width,height).data;
  let maximum=0,peak=0;
  for(let x=0;x<width;x++){
    let alpha=0;for(let y=0;y<height;y++)if(Math.abs(y-height/2)>4)alpha+=data[(y*width+x)*4+3];
    if(alpha>maximum){maximum=alpha;peak=x}
  }
  return {strength:maximum,position:peak/width};
})}

test('audio view radios support keyboard navigation and persist through documents and reload',async({page})=>{
  await open(page);
  const group=page.getByRole('group',{name:'Audio view',exact:true});await expect(group).toBeVisible();
  const waveform=group.getByRole('radio',{name:'Waveform',exact:true}),spectrogram=group.getByRole('radio',{name:'Spectrogram',exact:true}),spectrum=group.getByRole('radio',{name:'Spectrum',exact:true});
  await expect(waveform).toBeChecked();await waveform.focus();await page.keyboard.press('ArrowRight');
  await expect(spectrogram).toBeChecked();await expect(spectrogram).toBeFocused();
  await expect(page.getByRole('slider',{name:'Seek recording on spectrogram',exact:true})).toBeVisible();
  await page.keyboard.press('ArrowRight');await expect(spectrum).toBeChecked();await expect(spectrum).toBeFocused();
  await expect(page.locator('#recording-waveform')).toHaveAttribute('role','img');
  expect(await page.evaluate(()=>localStorage.getItem('wb-recording-view'))).toBe('spectrum');
  await page.locator('[data-document="xmlfiles/beta.xml"]').click();await expect(page.locator('[data-token="other"]')).toBeVisible();
  await expect(spectrum).toBeChecked();await expect(page.locator('#recording-pane')).toHaveAttribute('data-audio-view','spectrum');
  await page.reload();await expect(spectrum).toBeChecked();await expect(page.locator('#recording-pane')).toHaveAttribute('data-audio-view','spectrum');
  await spectrum.focus();await page.keyboard.press('ArrowRight');await expect(waveform).toBeChecked();await expect(waveform).toBeFocused();
});

test('spectrogram has real nonuniform tone data and shares pointer, keyboard and transcript seeking',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await mode(page,'Spectrogram');await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');
  await expect(page.locator('#recording-analysis-caption')).toContainText(/log Hz/);
  const pixels=await page.locator('#recording-waveform').evaluate((canvas:HTMLCanvasElement)=>{
    const {width,height}=canvas,data=canvas.getContext('2d')!.getImageData(0,0,width,height).data,colors=new Set<number>();
    // A flat decorative fill cannot satisfy this. Axis and cursor edges are excluded.
    for(let y=Math.floor(height*.12);y<height*.88;y++)for(let x=Math.floor(width*.1);x<width*.9;x++){
      const i=(y*width+x)*4;colors.add((data[i]<<16)|(data[i+1]<<8)|data[i+2]);
    }
    const peak=(fraction:number)=>{
      const x=Math.floor(width*fraction);let level=-1,row=0;
      for(let y=5;y<height-5;y++){
        let value=0;for(let offset=-2;offset<=2;offset++)value+=data[(y*width+x+offset)*4];
        if(value>level){level=value;row=y}
      }
      return {level:level/5,row};
    };
    return {colors:colors.size,low:peak(2/12),high:peak(6/12),silence:peak(10/12)};
  });
  expect(pixels.colors).toBeGreaterThan(12);
  expect(pixels.low.row).toBeGreaterThan(pixels.high.row);
  expect(pixels.low.level).toBeGreaterThan(pixels.silence.level+20);
  expect(pixels.high.level).toBeGreaterThan(pixels.silence.level+20);
  const chart=page.getByRole('slider',{name:'Seek recording on spectrogram',exact:true}),bounds=await chart.boundingBox();expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x+bounds!.width*.5,bounds!.y+bounds!.height*.5);
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeCloseTo(6,0);
  await expect(chart).toHaveAttribute('aria-valuenow',/^6(?:\.\d+)?$/);
  await chart.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeCloseTo(1,1);
  await expect(chart).toHaveAttribute('aria-valuenow','1');
  await page.keyboard.press('Shift+ArrowRight');await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeCloseTo(6,1);
  await mode(page,'Waveform');await expect(page.getByRole('slider',{name:'Seek recording on waveform',exact:true})).toHaveAttribute('aria-valuenow','6');
  await mode(page,'Spectrogram');await page.locator('[data-token="high"]').click();await page.getByRole('button',{name:'Listen to selection',exact:true}).click();
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(5);
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeLessThan(6);
  await expect(page.locator('[data-utterance="u2"]')).toHaveClass(/playing/);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  const time=await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime);
  expect(Number(await chart.getAttribute('aria-valuenow'))).toBeCloseTo(time,1);expect(errors).toEqual([]);
});

test('spectrum is a live frequency view with honest pause state and separate seeking',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await mode(page,'Spectrum');await page.locator('#timeline-resizer').focus();await page.keyboard.press('End');
  const audio=page.locator('#audio'),chart=page.locator('#recording-waveform');
  await expect(chart).toHaveAttribute('role','img');await expect(chart).not.toHaveAttribute('aria-valuenow',/.+/);
  await expect(page.locator('#recording-analysis-status')).toContainText(/Paused.*play recording/i);
  await expect(page.locator('#recording-analysis-caption')).toContainText(/Live output.*Hz.*seek with player/i);
  await seek(page,2);const paused=await canvasSignature(page),time=await audio.evaluate((a:HTMLAudioElement)=>a.currentTime);
  await chart.click({position:{x:80,y:20}});await chart.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowRight');
  expect(await audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeCloseTo(time,1);
  await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(2.1);
  await expect.poll(()=>canvasSignature(page)).not.toBe(paused);
  await expect.poll(async()=>(await spectrumPeak(page)).strength).toBeGreaterThan(1000);
  const low=await spectrumPeak(page);expect(low.position).toBeGreaterThan(.35);expect(low.position).toBeLessThan(.55);
  await expect(page.locator('#recording-analysis-status')).not.toContainText(/Paused/);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await expect(page.locator('#recording-analysis-status')).toContainText(/Paused.*play recording/i);
  await seek(page,6);await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(6.2);
  await expect.poll(async()=>(await spectrumPeak(page)).position).toBeGreaterThan(low.position+.1);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await seek(page,9);await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await expect.poll(()=>audio.evaluate((a:HTMLAudioElement)=>a.currentTime)).toBeGreaterThan(9.2);
  await expect.poll(async()=>(await spectrumPeak(page)).strength).toBeLessThan(low.strength*.1);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await mode(page,'Waveform');expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);expect(errors).toEqual([]);
});

test('absent, corrupt and oversized recordings never retain an old analysis',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await open(page);await mode(page,'Spectrogram');
  await page.locator('[data-document="xmlfiles/silent.xml"]').click();await expect(page.locator('[data-token="absent"]')).toBeVisible();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','empty');
  await expect(page.locator('#audio-availability')).toBeVisible();await expect(page.locator('#recording-waveform')).toHaveAttribute('aria-disabled','true');
  await page.locator('[data-document="xmlfiles/corrupt.xml"]').click();await expect(page.locator('[data-token="broken"]')).toBeVisible();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','unavailable');
  await expect(page.locator('#recording-analysis-status')).toContainText(/unavailable/i);await expect(page.locator('#audio-play')).toBeDisabled();
  // Simulate the authoritative size guard without creating a 33 MiB fixture. The
  // small real WAV still plays, proving this limit disables analysis only.
  await page.route('**/api/view',async route=>{const response=await route.fetch(),view=await response.json();view.snapshot.files['Audio/tones.wav'].bytes=32*1024*1024+1;await route.fulfill({response,json:view})});
  await page.reload();await page.locator('[data-document="xmlfiles/alpha.xml"]').click();await expect(page.locator('[data-token="low"]')).toBeVisible();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','unavailable');
  await expect(page.locator('#recording-analysis-status')).toContainText(/32 MiB/);await expect(page.locator('#audio-play')).toBeEnabled();
  await page.getByRole('button',{name:'Play recording',exact:true}).click();await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(.1);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();expect(errors).toEqual([]);
});

test('loading analysis is announced and a delayed old document cannot replace an empty view',async({page})=>{
  let release!:()=>void;const held=new Promise<void>(done=>release=done);let waiting=false;
  let finished!:()=>void;const delivered=new Promise<void>(done=>finished=done);
  await page.route('**/api/media?**',async route=>{const analysis=route.request().resourceType()==='fetch';if(analysis){waiting=true;await held}try{await route.continue()}catch{/* The old analysis may be cancelled on document switch. */}finally{if(analysis)finished()}});
  try{
    await page.goto('/#session='+code);await expect(page.locator('[data-token="low"]')).toBeVisible();await expect.poll(()=>waiting).toBe(true);
    await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','loading');
    await expect(page.locator('#recording-analysis-status')).toHaveAttribute('role','status');
    await expect(page.locator('#recording-analysis-status')).toContainText(/prepar|load|analys/i);
    await page.locator('[data-document="xmlfiles/silent.xml"]').click();await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','empty');
  }finally{release()}
  await delivered;await page.unroute('**/api/media?**');await expect(page.locator('[data-token="absent"]')).toBeVisible();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','empty');
});

test('recordings over ten minutes skip overview fetch while actual playback and live spectrum work',async({page})=>{
  const analysisRequests:string[]=[];page.on('request',request=>{if(request.resourceType()==='fetch'&&request.url().includes('/api/media?')&&request.url().includes('long.wav'))analysisRequests.push(request.url())});
  await open(page);await mode(page,'Spectrogram');await page.locator('[data-document="xmlfiles/long.xml"]').click();
  await expect(page.locator('[data-token="long"]')).toBeVisible();await expect(page.locator('#audio-play')).toBeEnabled();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','unavailable');
  await expect(page.locator('#recording-analysis-status')).toContainText(/10 minutes/);
  expect(await page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.duration)).toBeCloseTo(601,0);expect(analysisRequests).toEqual([]);
  await mode(page,'Spectrum');await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(.2);
  await expect(page.locator('#recording-analysis-status')).toContainText(/Live.*frequencies/);
  await expect.poll(async()=>(await spectrumPeak(page)).strength).toBeGreaterThan(1000);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();expect(analysisRequests).toEqual([]);
});

test('analysis worker failure remains recoverable through the recording player',async({page})=>{
  await page.route('**/*audio-analysis.worker*',route=>route.abort('failed'));
  await page.goto('/#session='+code);await expect(page.locator('[data-token="low"]')).toBeVisible();
  await expect(page.locator('#recording-pane')).toHaveAttribute('data-analysis-state','unavailable');
  await expect(page.locator('#recording-analysis-status')).toContainText(/overview unavailable/i);
  await expect(page.locator('#audio-play')).toBeEnabled();await page.getByRole('button',{name:'Play recording',exact:true}).click();
  await expect.poll(()=>page.locator('#audio').evaluate((audio:HTMLAudioElement)=>audio.currentTime)).toBeGreaterThan(.1);
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
});

test('mode controls and player fit narrow panes, both themes and reduced motion without interrupting audio',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);await mode(page,'Spectrum');
  const audio=page.locator('#audio'),source=await audio.getAttribute('src');await audio.evaluate((a:HTMLAudioElement)=>{a.loop=true});await page.getByRole('button',{name:'Play recording',exact:true}).click();
  const fits=(selector:string)=>page.locator(selector).evaluate(control=>{const r=control.getBoundingClientRect(),panel=control.closest('#recording-pane')!.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=panel.left&&r.right<=panel.right&&r.top>=panel.top&&r.bottom<=panel.bottom&&r.bottom<=innerHeight});
  const playerControls=['#audio-play','#audio-seek','#audio-mute','#audio-volume','#audio-speed'];
  for(const width of [1440,820,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['light','dark']){
      if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByRole('button',{name:'Dark appearance',exact:true}).click();
      for(const label of ['Waveform','Spectrogram','Spectrum']){
        const radio=page.getByRole('radio',{name:label,exact:true});await radio.check();
        expect(await radio.evaluate(input=>{const r=input.closest('label')!.getBoundingClientRect(),p=input.closest('#recording-pane')!.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom}),`${width}px ${theme} ${label}`).toBe(true);
        await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','compact');
        for(const selector of [...playerControls,'#listen-selected','#loop-selection'])await expect.poll(()=>fits(selector),{message:`${width}px ${theme} ${label} compact ${selector}`}).toBe(true);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(await audio.getAttribute('src')).toBe(source);expect(await audio.evaluate((a:HTMLAudioElement)=>a.paused)).toBe(false);
    }
    await page.locator('#timeline-resizer').focus();await page.keyboard.press('Home');await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','minimal');
    for(const selector of playerControls)await expect.poll(()=>fits(selector),{message:`${width}px minimal ${selector}`}).toBe(true);
    await page.getByRole('button',{name:'Expand recording panel',exact:true}).click();await expect(page.locator('#recording-pane')).toHaveAttribute('data-detail','compact');
  }
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
});
