import {group, h, renderInto} from './effect-view';
import type {Document,View} from './contracts';
import type {AudioAnalysis} from './audio-analysis';
import {desktop,type SemanticaState} from './desktop';
import './overview.css';

interface Sources {
  view:()=>View;doc:()=>Document;selected:()=>string[];audio:HTMLAudioElement;
  analysis:()=>{state:string;analysis:AudioAnalysis|null};
  busy:()=>boolean;
  go:(target:'review'|'research')=>void;
}
const stamp=()=>new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const duration=(n:number)=>Number.isFinite(n)&&n>=0?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'—';
const bytes=(n:number)=>n<1048576?`${(n/1024).toFixed(1)} KiB`:`${(n/1048576).toFixed(1)} MiB`;

// These members ship in Chromium 157. The desktop's older engine uses the HTML labels directly.
type DrawableCanvas = HTMLCanvasElement & {content?:string; requestPaint?:()=>void};
type DrawableContext = CanvasRenderingContext2D & {drawElementImage?:(source:Element,x:number,y:number,w:number,h:number)=>void};

/** Read-only instrument view. Every line is snapshot membership, never inference. */
export class ResearchOverview {
  private dialog=document.createElement('dialog');
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private paused=false;private previous:HTMLElement|null=null;private frame=0;private lastFrame=0;
  private timer:ReturnType<typeof setInterval>|null=null;private request=0;private pending=false;
  private basis='';private selection='';private media:string|undefined;private state:SemanticaState|null=null;
  private stateKey='';private events:{time:string;text:string}[]=[];private abort=new AbortController();
  private resize:ResizeObserver;private theme:MutationObserver;
  private displayTime=0;
  constructor(private sources:Sources){
    this.dialog.id='research-overview';this.dialog.className='overview';
    this.dialog.setAttribute('aria-labelledby','overview-heading');this.dialog.setAttribute('aria-describedby','overview-intro');
    renderInto(this.dialog,
      h.div
      .class('overview-header')
      .children(
        h.div
          .class('overview-title')
          .children(
            h.h2.id('overview-heading').children('Research overview'),
            h.p.id('overview-intro').class('overview-project'),
          ),
        h.div
          .class('overview-controls')
          .children(
            h.button.id('overview-refresh').class('secondary').children('Refresh state'),
            h.button
              .id('overview-pause')
              .class('secondary')
              .attrs({'aria-pressed': 'false'})
              .children('Pause motion'),
            h.button.id('overview-close').children('Return to transcript'),
          ),
      ),
      h.div.id('overview-basis').class('overview-basis'),
      h.div.class('overview-stage').children(
        h.section
          .class('overview-evidence')
          .attrs({'aria-labelledby': 'overview-evidence-heading'})
          .children(
            h.h3
              .id('overview-evidence-heading')
              .children(
                'Preserved evidence ',
                h.span.class('overview-label').children('Snapshot membership'),
              ),
            h.div
              .class('overview-diagram')
              .children(
                h.svg
                  .id('overview-map')
                  .attrs({
                    role: 'img',
                    viewBox: '0 0 570 390',
                    'aria-labelledby': 'overview-map-title overview-map-description',
                  }),
                h.p
                  .class('overview-label')
                  .children(
                    'Lines connect files to this saved package. They are not semantic relationships or a claim that one file generated another.',
                  ),
              ),
            h.ul.id('overview-file-preview').attrs({'aria-label': 'Snapshot files'}),
            h.details
              .class('overview-files')
              .children(h.summary.id('overview-files-summary'), h.ul.id('overview-files-list')),
          ),
        h.section
          .class('overview-signal')
          .attrs({'aria-labelledby': 'overview-signal-heading'})
          .children(
            h.h3
              .id('overview-signal-heading')
              .children('Recording trace ', h.span.id('overview-media').class('overview-label')),
            h.div.class('overview-plot').children(
              h.canvas
                .id('overview-traces')
                .attrs({
                  role: 'img',
                  'aria-label': 'Recording peak envelope and eight sampled frequency bands',
                }),
              h.div
                .id('overview-trace-key')
                .attrs({role: 'group', 'aria-label': 'Recording trace labels', hidden: ''})
                .children(
                  h.div
                    .class('overview-trace-labels')
                    .children(
                      h.span.class('overview-peak-label').children('Peak envelope'),
                      h.span.class('overview-bands-label').children('Sampled frequency bands'),
                      h.div
                        .class('overview-trace-axis')
                        .children(
                          h.span('0:00'),
                          h.span.id('overview-trace-mid'),
                          h.span.id('overview-trace-end'),
                        ),
                    ),
                ),
            ),
            h.p.id('overview-analysis-status').class('overview-label'),
            h.div
              .class('overview-player')
              .children(
                h.button.id('overview-play').class('secondary').children('Play recording'),
                h.label(
                  'Recording position',
                  h.input
                    .id('overview-seek')
                    .attrs({
                      type: 'range',
                      min: '0',
                      max: '1',
                      step: '0.1',
                      value: '0',
                      'aria-label': 'Seek recording',
                    }),
                ),
                h.output.id('overview-time'),
              ),
            h.p.id('overview-motion-status').class('overview-label'),
          ),
      ),
      h.div
      .class('overview-instruments')
      .children(
        h.section
          .class('overview-instrument')
          .children(
            h.span('Preserved files'),
            h.strong.id('overview-file-count'),
            h.small.id('overview-file-bytes'),
          ),
        h.section
          .class('overview-instrument')
          .children(
            h.span('Selected tokens'),
            h.strong.id('overview-selection-count'),
            h.small.id('overview-token-total'),
          ),
        h.section
          .class('overview-instrument')
          .children(
            h.span('Exact-revision review'),
            h.strong.id('overview-review'),
            h.button.id('overview-open-review').class('secondary').children('Inspect review'),
          ),
        h.section
          .class('overview-instrument')
          .children(
            h.span('Local Semantica'),
            h.strong.id('overview-runtime'),
            h.small.id('overview-generation'),
            h.button.id('overview-open-handoff').class('secondary').children('Open handoff'),
          ),
      ),
      h.div
      .class('overview-detail-row')
      .children(
        h.section
          .class('overview-selection')
          .children(
            h.h3('Selection in context'),
            h.p.id('overview-selection-text'),
            h.p.id('overview-selection-timing').class('overview-label'),
            h.p
              .id('overview-draft-status')
              .class('overview-label')
              .children('Saved readings only. Unsaved drafts are excluded.'),
          ),
        h.section
          .class('overview-activity')
          .children(
            h.h3('This session ', h.span.class('overview-label').children('Observed changes')),
            h.ol.id('overview-events'),
          ),
      ),
      h.footer
      .class('overview-footer')
      .children(
        'Local evidence, not inferred certainty. Waveforms and sampled frequency bands describe the recording, not speech alignment, language, confidence or transcription accuracy.',
      ),
    );
    document.body.append(this.dialog);
    this.enableCanvasLabels();
    this.find('overview-close').onclick=()=>this.close();
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close()});
    this.dialog.addEventListener('keydown',event=>event.stopPropagation());
    this.find('overview-pause').onclick=()=>{this.paused=!this.paused;this.motion();this.draw();this.animate()};
    this.find('overview-refresh').onclick=()=>void this.refresh();
    this.find('overview-open-review').onclick=()=>{this.close();sources.go('review')};
    this.find('overview-open-handoff').onclick=()=>{this.close();sources.go('research')};
    this.find('overview-play').onclick=()=>{if(sources.audio.paused)void sources.audio.play().catch(()=>{this.find('overview-media').textContent='Playback unavailable; use the recording panel to retry.'});else sources.audio.pause()};
    this.find<HTMLInputElement>('overview-seek').oninput=event=>{if(this.playable()){sources.audio.currentTime=Number((event.target as HTMLInputElement).value);this.displayTime=sources.audio.currentTime;this.draw();this.player()}};
    for(const event of ['play','pause','ended','seeking','seeked','loadedmetadata','durationchange','error','emptied','timeupdate','canplay'])sources.audio.addEventListener(event,()=>{
      if(!this.dialog.open)return;
      if(['play','pause','ended','seeked'].includes(event))this.record(event==='play'?'Recording playback started':event==='pause'?'Recording playback paused':event==='ended'?'Recording playback ended':`Recording seeked to ${duration(sources.audio.currentTime)}`);
      this.player();this.motion();if(!this.paused&&event!=='timeupdate')this.draw();this.animate();
    },{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{this.motion();this.animate();if(!document.hidden&&this.dialog.open){this.draw();void this.refresh()}},{signal:this.abort.signal});
    document.addEventListener('wb-audio-analysis',()=>{if(this.dialog.open){this.draw();this.player()}},{signal:this.abort.signal});
    this.resize=new ResizeObserver(()=>{if(this.dialog.open)this.draw()});this.resize.observe(this.dialog);
    this.theme=new MutationObserver(()=>{if(this.dialog.open)this.draw()});this.theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    this.reduced.addEventListener('change',()=>{this.motion();this.draw();this.animate()},{signal:this.abort.signal});
  }
  private find<T extends HTMLElement=HTMLElement>(id:string){return this.dialog.querySelector<T>('#'+id)!}
  private enableCanvasLabels(){
    const canvas=document.createElement('canvas') as DrawableCanvas;
    canvas.setAttribute('content','drawable');
    if(canvas.content!=='drawable'||typeof canvas.requestPaint!=='function')return;
    const ctx=canvas.getContext('2d') as DrawableContext|null;
    if(typeof ctx?.drawElementImage!=='function')return;

    const host=this.find('overview-trace-key'),labels=host.firstElementChild!;
    labels.setAttribute('drawable','');
    canvas.append(labels);
    host.append(canvas);
    const resize=new ResizeObserver(()=>{
      const {width,height}=canvas.getBoundingClientRect();
      if(!width||!height)return;
      const scale=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.round(width*scale);
      canvas.height=Math.round(height*scale);
      canvas.requestPaint!();
    });
    resize.observe(canvas);
    this.abort.signal.addEventListener('abort',()=>resize.disconnect(),{once:true});
    // Only repaint the text when its snapshot or dimensions change. Playback draws on the sibling canvas.
    canvas.addEventListener('paint',()=>{
      if(!this.dialog.open||host.hidden)return;
      try{
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawElementImage!(labels,0,0,canvas.width,canvas.height);
      }catch{
        resize.disconnect();
        labels.removeAttribute('drawable');
        host.replaceChildren(labels);
      }
    },{signal:this.abort.signal});
  }
  open(){if(this.dialog.open)return;this.previous=document.activeElement as HTMLElement;this.displayTime=this.sources.audio.currentTime;this.dialog.showModal();this.record('Overview opened on the saved editor basis');this.update();this.player();this.motion();this.draw();this.animate();void this.refresh();this.timer=setInterval(()=>{if(!document.hidden)void this.refresh()},3000);this.find('overview-close').focus()}
  private close(){this.dialog.close();this.request++;if(this.timer)clearInterval(this.timer);this.timer=null;cancelAnimationFrame(this.frame);this.frame=0;this.previous?.focus()}
  dispose(){this.close();this.abort.abort();this.resize.disconnect();this.theme.disconnect();this.dialog.remove()}
  update(){
    if(!this.dialog.open)return;
    const {view,doc,selected}=this.sources,v=view(),d=doc(),ids=new Set(selected()),tokens=d.tokens.filter(token=>ids.has(token.id));
    const basis=[v.snapshot.project,v.revision.id,v.revision.snapshot_hash,v.approved,d.path].join(':');
    if(this.basis!==basis){if(this.basis)this.record(`Saved basis observed: R${v.revision.id}${v.approved?' approved':' unreviewed'}`);this.basis=basis;this.state=null;this.stateKey='';this.generation();}
    const selection=[d.path,...tokens.map(token=>token.id)].join(':');if(this.selection!==selection){if(this.selection)this.record(`${tokens.length} token${tokens.length===1?'':'s'} selected`);this.selection=selection;}
    this.media=this.resolveMedia(v,d);
    this.dialog.toggleAttribute('data-no-recording', !this.media);
    const priority=(path:string)=>path===d.path?0:path===this.media?1:2;
    const entries=Object.entries(v.snapshot.files).sort(([a],[b])=>priority(a)-priority(b)||a.localeCompare(b));
    this.find('overview-basis').textContent=`Saved R${v.revision.id} · ${v.revision.snapshot_hash} · ${v.documents.length} document${v.documents.length===1?'':'s'}`;
    this.dialog.querySelector('.overview-project')!.textContent=d.title;
    this.find('overview-file-count').textContent=String(entries.length);this.find('overview-file-bytes').textContent=`${bytes(entries.reduce((sum,[,file])=>sum+file.bytes,0))} retained in this snapshot`;
    this.find('overview-selection-count').textContent=String(tokens.length);this.find('overview-token-total').textContent=`of ${d.tokens.length} saved tokens in this document`;
    this.find('overview-review').textContent=v.approved?'Approved':'Unreviewed';
    this.find<HTMLButtonElement>('overview-open-review').disabled=this.sources.busy();this.find<HTMLButtonElement>('overview-open-handoff').disabled=this.sources.busy();
    this.find('overview-selection-text').textContent=tokens.length?tokens.slice(0,32).map(token=>token.corrected??token.original).join(' ')+(tokens.length>32?' …':''):'Select transcript tokens, then open this overview to follow their saved context.';
    const timed=tokens.filter(t=>t.start_us!==null&&t.end_us!==null),bounds=this.extent();
    this.find('overview-selection-timing').textContent=!tokens.length?'No selection.':timed.length===tokens.length?`Supplied word bounds: ${duration(bounds![0])}–${duration(bounds![1])}.`:bounds?`Supplied segment/chunk bounds: ${duration(bounds[0])}–${duration(bounds[1])}. Word timing is incomplete or unknown.`:'No supplied timing. Word positions are not aligned to the recording.';
    this.find('overview-files-summary').textContent=`Inspect snapshot files · ${entries.length} total${entries.length>16?' · first 16 shown':''}`;
    renderInto(this.find('overview-files-list'),
      entries
      .slice(0, 16)
      .map(([path, file]) =>
        h.li(
          h.span(path),
          h.code.attrs({title: file.sha256}).children(file.sha256.slice(0, 12)),
          h.small(bytes(file.bytes), ' · ', file.role),
        ),
      ),
    );
    const preview=entries.filter(([path])=>path===d.path || path===this.media);
    if(!preview.length) preview.push(...entries.slice(0,1));
    renderInto(this.find('overview-file-preview'),
      preview.map(([path, file]) => {
        const label =
          path === d.path ? 'Active transcript' : path === this.media ? 'Linked recording' : file.role;
        return h.li(h.small(label), h.span(path));
      }),
    );
    this.map(entries);this.player();this.generation();this.draw();
  }
  private resolveMedia(v:View,d:Document){const paths=[...new Set(d.media.flatMap(path=>[path,`Audio/${path}`,`Video/${path}`]).filter(path=>v.snapshot.files[path]?.role==='source-media'))];return paths.length===1?paths[0]:undefined}
  private extent():[number,number]|null{const d=this.sources.doc(),ids=new Set(this.sources.selected()),bounds=d.tokens.filter(t=>ids.has(t.id)).map(t=>t.start_us!==null&&t.end_us!==null?[t.start_us,t.end_us]:d.segments.find(s=>s.id===t.utterance)).map(s=>Array.isArray(s)?s:s?.start_us!==null&&s?.end_us!==null?[s?.start_us,s?.end_us]:null).filter((s):s is number[]=>!!s&&s.every(n=>typeof n==='number'));return bounds.length?[Math.min(...bounds.map(s=>s[0]))/1e6,Math.max(...bounds.map(s=>s[1]))/1e6]:null}
  private map(entries:[string,View['snapshot']['files'][string]][]){
    const v=this.sources.view(),d=this.sources.doc(),visible=entries.slice(0,16),count=visible.length;
    const map = this.find('overview-map');
    renderInto(map,
      h.circle.class('overview-orbit').attrs({cx: '104', cy: '195', r: '69'}),
      h.circle.class('overview-orbit').attrs({cx: '104', cy: '195', r: '56'}),
      h.circle.class('overview-core').attrs({cx: '104', cy: '195', r: '42'}),
      h.svgText
      .class('overview-revision')
      .attrs({x: '104', y: '190', 'text-anchor': 'middle'})
      .children('R', String(v.revision.id)),
      h.svgText
      .class('overview-svg-small')
      .attrs({x: '104', y: '211', 'text-anchor': 'middle'})
      .children('SAVED BASIS'),
      visible.flatMap(([path, file], i) => {
        const y = 28 + i * (334 / Math.max(1, count - 1)),
          x = 320 + 52 * Math.sin((Math.PI * i) / Math.max(1, count - 1)),
          active = path === d.path || path === this.media;
        return group(
          h.path
            .class('overview-link ' + (active ? 'overview-link-current' : ''))
            .attrs({d: 'M 150 195 C 225 195, 235 ' + String(y) + ', ' + String(x - 12) + ' ' + String(y)}),
          h.path
            .class('overview-flow')
            .attrs({
              'data-recording': path === this.media ? 'true' : undefined,
              d: 'M 150 195 C 225 195, 235 ' + String(y) + ', ' + String(x - 12) + ' ' + String(y),
            }),
          h.circle
            .class('overview-node')
            .attrs({cx: String(x - 7), cy: String(y), r: String(active ? 3 : 1.7)}),
          h.svgText
            .class('overview-svg-file')
            .attrs({x: String(x), y: String(y - 3)})
            .children(
              path.length > 25 ? path.slice(0, 22) + '…' : path,
            ),
          h.svgText
            .class('overview-svg-small')
            .attrs({x: String(x), y: String(y + 11)})
            .children(
              file.role,
              path === d.path ? ' · active source' : path === this.media ? ' · recording reference' : '',
            ),
        );
      }),
      h.svgText
      .class('overview-svg-small')
      .attrs({x: '30', y: '382'})
      .children(
        entries.length > count
          ? `${entries.length - count} more files retained · inspect file list below`
          : 'Original source bytes stay in the saved package',
      ),
    );

    // Accessible SVG metadata needs the SVG namespace, including tooltips on individual files.
    const label = (parent: Element, tag: 'title'|'desc', text: string, id?: string) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (id) node.id = id;
      node.textContent = text;
      parent.prepend(node);
    };
    label(map, 'desc', entries.length + ' package files; first ' + count + ' shown. Highlighted files are the active document source and its unambiguous recording association. Lines show snapshot membership, not semantic inference.', 'overview-map-description');
    label(map, 'title', 'Files retained in saved revision ' + v.revision.id, 'overview-map-title');
    map.querySelectorAll('.overview-svg-file').forEach((node, i) => label(node, 'title', visible[i][0]));
  }
  private playable(){const a=this.sources.audio;return !!this.media&&!a.hidden&&!!a.getAttribute('src')&&!a.error&&Number.isFinite(a.duration)&&a.duration>0}
  private player(){const a=this.sources.audio,available=this.playable();const play=this.find<HTMLButtonElement>('overview-play'),seek=this.find<HTMLInputElement>('overview-seek');play.disabled=!available;play.textContent=a.paused?'Play recording':'Pause recording';seek.disabled=!available;seek.max=String(available?a.duration:1);seek.value=String(available?a.currentTime:0);this.find('overview-time').textContent=available?`${duration(a.currentTime)} / ${duration(a.duration)}`:'No playback';this.find('overview-media').textContent=available?this.media!:this.media?'Recording unavailable or still loading':'No unambiguous recording reference';}
  private motion(){const reduced=this.reduced.matches,a=this.sources.audio;this.dialog.dataset.motion=reduced?'reduced':this.paused?'paused':!a.paused&&this.playable()&&!document.hidden?'playing':'ready';this.dialog.dataset.canFlow=String(!document.hidden&&this.playable()&&!a.paused&&!a.ended&&!a.seeking&&a.readyState>=3);const button=this.find<HTMLButtonElement>('overview-pause');button.disabled=reduced;button.textContent=this.paused?'Resume motion':'Pause motion';button.setAttribute('aria-pressed',String(this.paused||reduced));this.find('overview-motion-status').textContent=reduced?'Reduced motion: static view':this.paused?'Motion paused; playback continues':'Motion follows playback';}
  private animate(){cancelAnimationFrame(this.frame);this.frame=0;if(!this.dialog.open||document.hidden||this.paused||this.reduced.matches||!this.playable()||this.sources.audio.paused)return;const tick=(now:number)=>{if(now-this.lastFrame>=100){this.lastFrame=now;this.draw();this.player()}this.frame=requestAnimationFrame(tick)};this.frame=requestAnimationFrame(tick)}
  private draw(){
    if(!this.dialog.open||document.hidden)return;
    const canvas=this.find<HTMLCanvasElement>('overview-traces');
    if(!this.media){
      this.find('overview-analysis-status').textContent='A single recording could not be matched to this document.';
      this.find('overview-trace-key').hidden=true;
      canvas.setAttribute('aria-label','No recording association; no measured trace available');
      return;
    }
    const rect=canvas.getBoundingClientRect();if(!rect.width)return;
    if(!this.paused&&!this.reduced.matches)this.displayTime=this.sources.audio.currentTime;
    const scale=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);const c=canvas.getContext('2d');if(!c)return;c.scale(scale,scale);
    const styles=getComputedStyle(this.dialog),ink=styles.getPropertyValue('--ov-ink').trim()||'#fff',muted=styles.getPropertyValue('--ov-muted').trim()||'#888',line=styles.getPropertyValue('--ov-line').trim()||'#444';
    const width=rect.width,height=rect.height,left=38,right=width-15,plot=right-left;const {state,analysis:a}=this.sources.analysis();
    this.find('overview-trace-key').hidden=!this.playable()||!a;
    c.font='10px ui-monospace,Consolas,monospace';c.fillStyle=muted;
    if(!this.playable()||!a){this.find('overview-analysis-status').textContent=state==='loading'?'Preparing bounded local audio analysis…':'Audio overview unavailable. Playback may remain available in the recording panel.';canvas.setAttribute('aria-label',state==='loading'?'Recording analysis loading; no measured trace available':'Recording analysis unavailable; no measured trace available');c.fillText('No measured trace available',left,height/2);return;}
    this.find('overview-analysis-status').textContent='Peak amplitude + 8 sampled frequency bands · display intensity, low → high. No word alignment.';
    const mid=this.find('overview-trace-mid'),end=this.find('overview-trace-end');
    if(mid.textContent!==duration(a.duration/2))mid.textContent=duration(a.duration/2);
    if(end.textContent!==duration(a.duration))end.textContent=duration(a.duration);
    const extent=this.extent();if(extent){c.fillStyle=line;c.globalAlpha=.3;c.fillRect(left+Math.max(0,extent[0]/a.duration)*plot,25,Math.max(2,Math.min(a.duration,extent[1])/a.duration*plot-Math.max(0,extent[0]/a.duration)*plot),height-52);c.globalAlpha=1;}
    const columns=Math.min(220,a.peaks.length),point=(index:number)=>left+index/Math.max(1,columns-1)*plot;
    c.strokeStyle=ink;c.lineWidth=.9;c.beginPath();for(let i=0;i<columns;i++){let peak=0;for(let bin=Math.floor(i*a.peaks.length/columns);bin<Math.floor((i+1)*a.peaks.length/columns);bin++)peak=Math.max(peak,a.peaks[bin]);const x=point(i);c.moveTo(x,54-peak*25);c.lineTo(x,54+peak*25)}c.stroke();
    const space=(height-142)/8;
    for(let band=0;band<8;band++){const y=116+(7-band)*space;c.strokeStyle=line;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.strokeStyle=ink;c.globalAlpha=.6+band*.045;c.beginPath();for(let i=0;i<columns;i++){const column=Math.min(a.columns-1,Math.floor(i/columns*a.columns));let intensity=0;for(let bin=band*16;bin<(band+1)*16;bin++)intensity+=a.spectrogram[column*a.bins+Math.min(bin,a.bins-1)]/(255*16);const x=point(i),py=y-intensity*space*.82;if(i)c.lineTo(x,py);else c.moveTo(x,py)}c.stroke();c.globalAlpha=1;}
    const x=left+Math.max(0,Math.min(1,this.displayTime/a.duration))*plot;c.strokeStyle=ink;c.lineWidth=1.1;c.beginPath();c.moveTo(x,25);c.lineTo(x,height-28);c.stroke();c.fillStyle=ink;c.beginPath();c.arc(x,54,3,0,Math.PI*2);c.fill();
    canvas.setAttribute('aria-label',`Recording envelope and eight sampled frequency bands across ${duration(a.duration)}; displayed playhead ${duration(this.displayTime)}. No word alignment.`);
  }
  private async refresh(){
    if(!this.dialog.open||document.hidden||this.pending)return;
    if(!desktop){this.generation();return;}const v=this.sources.view(),basis=[v.snapshot.project,v.revision.id,v.revision.snapshot_hash].join(':'),request=++this.request;this.pending=true;
    try{const state=await desktop.semanticaState(),latest=this.sources.view();if(!this.dialog.open||request!==this.request||basis!==[latest.snapshot.project,latest.revision.id,latest.revision.snapshot_hash].join(':'))return;const key=JSON.stringify([state.status,state.current,state.export,state.lastAttempt]);if(this.stateKey&&this.stateKey!==key)this.record(`Local handoff state observed: ${state.status}`);this.stateKey=key;this.state=state;this.generation();}
    catch{if(this.dialog.open&&request===this.request){this.state=null;this.find('overview-runtime').textContent='State unavailable';this.find('overview-generation').textContent='Could not read the local runtime. Refresh to retry.';}}
    finally{this.pending=false;}
  }
  private generation(){
    const v=this.sources.view(),s=this.state,current=s?.current;
    const exact=!!current&&current.revision===v.revision.id&&current.snapshot_hash===v.revision.snapshot_hash&&v.approved&&!v.issues.some(i=>i.blocking);
    let label=!desktop?'Desktop runtime unavailable':!s?'Checking local state':exact&&current!.native_reopen?'Verified current graph':exact?'Accepted receipt':current?'Earlier graph':s.configured?'Ready after review':'Not configured';
    let detail=!desktop?'Open the desktop workbench for actual Semantica state.':!s?'No graph counts claimed until the runtime responds.':exact?`${current!.node_count} nodes · ${current!.edge_count} edges · R${current!.revision}${current!.native_reopen?' · reopened by Semantica':' · native reopening unverified'}${current!.mapping_version!=='corpus-evidence/2'?' · legacy mapping; upgrade in handoff':''}`:current?`Graph basis R${current.revision} differs in snapshot, review or validation. Not current for this saved basis.`:'No current accepted generation for this saved basis.';
    if(s){
      if(['running','checking','verifying','exporting'].includes(s.status)){label={running:'Running locally',checking:'Checking runtime',verifying:'Verifying graph',exporting:'Exporting graph'}[s.status]!;detail=`Observed local operation: ${s.status}. ${detail}`;}
      else if(s.status==='failed'||s.lastAttempt?.status==='failed'){label='Latest attempt failed';detail=`${s.lastAttempt?.message??'Open handoff, check the runtime and retry.'} ${detail}`;}
      else if(s.status==='interrupted'||s.lastAttempt?.status==='interrupted'){label='Attempt interrupted';detail=`Saved evidence is retained. Open handoff to retry safely. ${detail}`;}
      else if(s.export?.validated)detail+=` · Portable export verified${s.export.filename?`: ${s.export.filename}`:''}`;
    }
    this.find('overview-runtime').textContent=label;this.find('overview-generation').textContent=detail;
  }
  private record(text:string){this.events.unshift({time:stamp(),text});this.events=this.events.slice(0,6);renderInto(this.find('overview-events'),
    this.events.map((event) => h.li.class('overview-event').children(h.time(event.time), h.span(event.text))),
  )}
}
