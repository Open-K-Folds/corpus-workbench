import {group, h, renderInto, viewFragment} from './effect-view';
import type {Document,View} from './contracts';
import {icon} from './icons';
import {AudioPlayer} from './player';
import {AudioView} from './audio-view';

function preference(key:string,fallback:number,min:number,max:number){try{const n=Number(localStorage.getItem(key));return n>=min&&n<=max?n:fallback}catch{return fallback}}
interface ResizeOptions {maximum?:()=>number;minimum?:()=>number;measure?:()=>number;onCommit?:(size:number)=>void}
export function resizePane(handle:HTMLElement,key:string,min:number,max:number,initial:number,axis:'x'|'y',direction:number,apply:(size:number,interactive:boolean)=>void,options:ResizeOptions={}){
  let preferred=preference(key,initial,min,max),size=preferred,start=0,origin=size,pointer:number|null=null,moved=false;
  const value=()=>Math.round(options.measure?.()||size);
  const limit=()=>Math.max(min,Math.min(max,options.maximum?.()??max));
  const sync=()=>{const actual=value();handle.setAttribute('aria-valuemin',String(options.minimum?.()??min));handle.setAttribute('aria-valuemax',String(Math.max(actual,Math.round(limit()))));handle.setAttribute('aria-valuenow',String(actual));handle.setAttribute('aria-valuetext',`${actual} pixels`)};
  const set=(n:number,persist=true,interactive=persist)=>{size=Math.round(Math.max(min,Math.min(Math.floor(limit()),n)));apply(size,interactive);sync();if(persist){preferred=size;options.onCommit?.(size);try{localStorage.setItem(key,String(preferred))}catch{/* Optional preference. */}}};
  const keys=axis==='y'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',axis==='y'?'horizontal':'vertical');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
  handle.setAttribute('aria-description',`${axis==='y'?'Up and Down':'Left and Right'} arrows resize. Shift resizes faster. Home collapses to the minimum; End expands to the maximum.`);
  handle.title=handle.getAttribute('aria-label')+`. ${axis==='y'?'Up / Down':'Left / Right'} to resize; Shift for larger steps.`;
  const coordinate=(e:PointerEvent)=>axis==='y'?e.clientY:e.clientX;
  const move=(e:PointerEvent)=>{moved=moved||coordinate(e)!==start;set(origin+direction*(coordinate(e)-start),false,true)};
  const finish=(cancel=false)=>{if(pointer===null)return;const id=pointer;pointer=null;if(cancel)set(origin,false,true);else if(moved)set(size);if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);document.documentElement.removeAttribute('data-resizing')};
  handle.onpointerdown=e=>{if(e.button!==0||pointer!==null||document.documentElement.hasAttribute('data-resizing'))return;pointer=e.pointerId;start=coordinate(e);origin=value();moved=false;handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);document.documentElement.dataset.resizing=axis;e.preventDefault()};
  handle.onpointermove=e=>{if(e.pointerId===pointer)move(e)};
  handle.onpointerup=e=>{if(e.pointerId===pointer){move(e);finish()}};
  handle.onpointercancel=e=>{if(e.pointerId===pointer)finish(true)};
  handle.onlostpointercapture=e=>{if(e.pointerId===pointer)finish(true)};
  window.addEventListener('blur',()=>finish(true));
  handle.onkeydown=e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.isComposing)return;if([...keys,'Home','End'].includes(e.key)){e.preventDefault();set(e.key==='Home'?min:e.key==='End'?max:value()+(e.key===keys[0]?-1:1)*direction*(e.shiftKey?40:12))}};
  set(size,false);return {set,sync,getSize:value,getPreferred:()=>preferred,isDragging:()=>pointer!==null};
}

/** Keep a useful reading surface when saved side panes meet a smaller window. */
export function resizeWorkbenchSides(workspace:HTMLElement,navigationHandle:HTMLElement,propertiesHandle:HTMLElement){
  const root=document.documentElement,navigationPane=navigationHandle.parentElement!,propertiesPane=propertiesHandle.parentElement!;
  const visible=(side:string)=>!workspace.classList.contains(side+'-folded') && workspace.dataset.parked!==side;
  const defaultNavigation=240,defaultProperties=368;
  const budget=()=>workspace.clientWidth-320;
  // Keep boundary hit targets outside the panes' scrolling content.
  const resizeGroup=document.createElement('div');
  resizeGroup.className='workspace-resizers';
  resizeGroup.setAttribute('role','region');
  resizeGroup.setAttribute('aria-label','Resize side panels');
  resizeGroup.append(navigationHandle,propertiesHandle);
  workspace.append(resizeGroup);
  navigationHandle.style.right='auto';
  const positionHandles=()=>{const bounds=workspace.getBoundingClientRect(),narrow=matchMedia('(max-width:700px)').matches;navigationHandle.hidden=narrow||!visible('navigation');propertiesHandle.hidden=narrow||!visible('properties');navigationHandle.style.left=navigationPane.getBoundingClientRect().right-bounds.left+'px';propertiesHandle.style.left=propertiesPane.getBoundingClientRect().left-bounds.left+'px'};
  let fitting=true,constraints='',constraintWidth=-1,previousParked:string|undefined;
  const navigation=resizePane(navigationHandle,'wb-navigation-width',160,360,defaultNavigation,'x',1,size=>{root.style.setProperty('--navigation-width',size+'px');positionHandles()},{maximum:()=>fitting||!visible('navigation')?360:budget()-(visible('properties')?propertiesPane.getBoundingClientRect().width:0),measure:()=>visible('navigation')?navigationPane.getBoundingClientRect().width:0});
  const properties=resizePane(propertiesHandle,'wb-properties-width',260,520,defaultProperties,'x',-1,size=>{root.style.setProperty('--properties-width',size+'px');positionHandles()},{maximum:()=>fitting||!visible('properties')?520:budget()-(visible('navigation')?navigationPane.getBoundingClientRect().width:0),measure:()=>visible('properties')?propertiesPane.getBoundingClientRect().width:0});
  const fit=()=>{
    if(navigation.isDragging()||properties.isDragging()){positionHandles();return}
    const showNavigation=visible('navigation'),showProperties=visible('properties');
    const narrow=matchMedia('(max-width:700px)').matches,width=workspace.clientWidth,next=[width,showNavigation,showProperties,narrow].join(':');
    // Pane notifications during dragging/scrolling only refresh the controls.
    // Refit preferences when the available width changes; folds keep the last
    // effective widths so reopening a pane restores the layout just left.
    if(next===constraints){positionHandles();navigation.sync();properties.sync();return}
    const spaceChanged=width!==constraintWidth || workspace.dataset.parked!==previousParked;
    constraints=next;constraintWidth=width;previousParked=workspace.dataset.parked;
    if(narrow){fitting=false;positionHandles();return}
    const automatic=navigation.getPreferred()===defaultNavigation && properties.getPreferred()===defaultProperties;
    let left=spaceChanged||automatic?navigation.getPreferred():navigation.getSize(),right=spaceChanged||automatic?properties.getPreferred():properties.getSize();
    // Leave a full reading line, turn numbers and scrollbar between the default desktop drawers.
    const fullMeasure=automatic && showNavigation && showProperties && matchMedia('(min-width:1121px)').matches;
    const available=Math.max((showNavigation?160:0)+(showProperties?260:0),fullMeasure?width-680:budget());
    const total=(showNavigation?left:0)+(showProperties?right:0);
    if(total>available){
      if(showNavigation&&showProperties){left=Math.max(160,Math.min(available-260,Math.round(left*available/total)));right=available-left}
      else if(showNavigation)left=Math.min(left,available);
      else if(showProperties)right=Math.min(right,available);
    }
    // Apply both values together before deriving either control's moving bound.
    // Automatic fitting leaves the user's saved larger-window preference intact.
    fitting=true;navigation.set(left,false);properties.set(right,false);
    fitting=false;navigation.set(left,false);properties.set(right,false);positionHandles();
  };
  fit();window.addEventListener('resize',fit);
  new MutationObserver(fit).observe(workspace,{attributes:true,attributeFilter:['class','data-parked']});
  const layout=new ResizeObserver(fit);layout.observe(workspace);layout.observe(navigationPane);layout.observe(propertiesPane);
  return {navigation,properties};
}
export class RecordingPanel {
  overview(){return this.visual.overview()}
  private visual:AudioView;private lanes:HTMLElement;private view:View|null=null;private doc:Document|null=null;
  private shortWindow = matchMedia('(max-height: 500px) and (orientation: landscape)');
  private phone = matchMedia('(max-width:700px)');
  private workspace:HTMLElement;
  fitToWorkspace(){
    const {panel}=this;
    const disclosure=this.phone.matches || this.shortWindow.matches;
    const tools=disclosure && this.workspace.dataset.focus!=='transcript';
    const changed=panel.hasAttribute('data-compact-controls')!==disclosure || panel.hasAttribute('data-tool-transport')!==tools;
    panel.toggleAttribute('data-compact-controls',disclosure);
    panel.toggleAttribute('data-tool-transport',tools);
    if(changed){
      panel.removeAttribute('data-short-open');
      panel.scrollTop=0;
      this.syncTimelineToggle();
    }
  }
  constructor(private panel:HTMLElement,private audio:HTMLAudioElement, signal: AbortSignal){
    panel.prepend(
      viewFragment(
        group(
          h.div
            .id('timeline-resizer')
            .class('pane-resizer')
            .attrs({'aria-label': 'Resize recording panel'})
            .children(h.span.class('resize-grip').attrs({'aria-hidden': 'true'})),
          h.div
            .class('recording-heading')
            .children(
              h.strong(icon('graphic_eq'), 'Recording'),
              h.span.id('recording-summary'),
              h.button
                .id('timeline-toggle')
                .class('secondary')
                .attrs({'aria-label': 'Cycle recording detail'})
                .children(icon('unfold_more')),
            ),
          h.canvas.id('recording-waveform').attrs({'aria-label': 'Recorded audio waveform'}),
          h.div.id('recording-layers'),
        ),
      ),
    );
    const availability = panel.querySelector<HTMLElement>('#audio-availability')!;
    availability.textContent = 'No audio linked';
    panel.querySelector('#timeline-toggle')!.before(availability);
    const player=new AudioPlayer(audio, signal);
    const actions = panel.querySelector<HTMLElement>('.actions')!;
    player.element.querySelector('.player-status')!.before(actions);
    this.lanes=panel.querySelector('#recording-layers')!;
    this.lanes.tabIndex=0;
    this.lanes.setAttribute('role','region');
    this.lanes.setAttribute('aria-label','Recording timeline');
    panel.append(this.lanes);
    this.visual=new AudioView(panel,audio,panel.querySelector('#recording-summary')!);
    type Detail='minimal'|'compact'|'expanded';let preferredDetail:Detail|null=null;
    let compactHeight=preference('wb-recording-compact-height',180,110,440),expandedHeight=preference('wb-recording-expanded-height',360,220,440);
    try{const saved=localStorage.getItem('wb-recording-detail');if(saved==='minimal'||saved==='compact'||saved==='expanded')preferredDetail=saved}catch{/* Optional preference. */}
    const minimum=(detail:Detail)=>parseFloat(getComputedStyle(panel).getPropertyValue('--recording-'+detail+'-min'))||({minimal:104,compact:130,expanded:220})[detail];
    const workspace=this.workspace=document.querySelector<HTMLElement>('.workspace')!;
    this.fitToWorkspace();
    const transcript = workspace.querySelector<HTMLElement>('.transcript')!;
    const maximum=()=>Math.max(70,panel.getBoundingClientRect().height+(transcript.getBoundingClientRect().height || workspace.clientHeight)-(matchMedia('(min-width:701px)').matches?240:180));
    const detailFor=(size:number):Detail=>size<minimum('compact')?'minimal':size<minimum('expanded')?'compact':'expanded';
    const resize=resizePane(panel.querySelector('#timeline-resizer')!,'wb-recording-height',70,440,130,'y',-1,(size,interactive)=>{
      preferredDetail??=size<110?'minimal':size<220?'compact':'expanded';
      let detail=interactive?detailFor(size):preferredDetail;if(minimum(detail)>maximum())detail=detailFor(maximum());
      panel.dataset.detail=detail;panel.style.height=size+'px';document.documentElement.style.setProperty('--recording-height',panel.getBoundingClientRect().height+'px');
      this.syncTimelineToggle();
    },{maximum,minimum:()=>minimum('minimal'),measure:()=>panel.getBoundingClientRect().height,onCommit:size=>{preferredDetail=panel.dataset.detail as Detail;if(preferredDetail==='compact')compactHeight=size;if(preferredDetail==='expanded')expandedHeight=size;try{localStorage.setItem('wb-recording-detail',preferredDetail);if(preferredDetail!=='minimal')localStorage.setItem('wb-recording-'+preferredDetail+'-height',String(size))}catch{/* Optional preference. */}}});
    const toggle = panel.querySelector<HTMLButtonElement>('#timeline-toggle')!;
    toggle.onclick=()=>{
      if (panel.dataset.recordingSource === 'absent') {
        panel.toggleAttribute('data-timing-open');
        this.syncTimelineToggle();
        return;
      }
      if (panel.hasAttribute('data-compact-controls')) {
        panel.toggleAttribute('data-short-open');
        panel.scrollTop = 0;
        this.syncTimelineToggle();
        return;
      }
      resize.set(panel.dataset.detail==='minimal'?Math.max(compactHeight,minimum('compact')):panel.dataset.detail==='compact'?Math.max(expandedHeight,minimum('expanded')):70);
    };
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !panel.hasAttribute('data-short-open') || event.defaultPrevented) return;
      panel.removeAttribute('data-short-open');
      this.syncTimelineToggle();
      toggle.focus({preventScroll:true});
      event.stopPropagation();
    });
    this.shortWindow.addEventListener('change',()=>this.fitToWorkspace());
    this.phone.addEventListener('change',()=>this.fitToWorkspace());
    audio.addEventListener('loadedmetadata',()=>this.renderLanes());
    let floors='';const refit=()=>{const next=[minimum('minimal'),minimum('compact'),minimum('expanded'),Math.round(maximum())].join(':');if(!resize.isDragging()&&next!==floors){floors=next;resize.set(resize.getPreferred(),false)}resize.sync()};
    window.addEventListener('resize',()=>{floors='';refit()});
    const fitLanes=()=>{
      refit();
      const padding = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
      if (panel.dataset.recordingSource === 'linked') {
        // Status text and transport rows wrap independently of the viewport once the rail is present.
        const bounds = panel.getBoundingClientRect();
        const controlsEnd = Math.max(player.element.getBoundingClientRect().bottom, actions.getBoundingClientRect().bottom);
        const laneSpace = panel.dataset.detail === 'expanded' ? 48 : 0;
        const contentHeight = Math.ceil(controlsEnd - bounds.top + padding + laneSpace);
        panel.style.setProperty('--recording-content-min', Math.min(contentHeight, maximum()) + 'px');
      }
      const bounds = panel.getBoundingClientRect();
      document.documentElement.style.setProperty('--recording-height', bounds.height+'px');
      this.lanes.style.maxHeight = Math.max(0,Math.floor(bounds.bottom-this.lanes.getBoundingClientRect().top-padding))+'px';
      const showLanes=this.lanes.clientHeight>0;
      this.lanes.tabIndex = showLanes ? 0 : -1;
      this.lanes.style.overflow=showLanes?'':'clip';
    };
    const layout=new ResizeObserver(fitLanes);
    for(const region of [panel,workspace,transcript,player.element,actions,panel.querySelector('.recording-analysis-info')!,panel.querySelector('canvas')!])layout.observe(region);
  }
  async update(view:View,doc:Document,media:string|undefined){
    const source = media ? 'linked' : 'absent';
    if (this.doc?.path !== doc.path || this.panel.dataset.recordingSource !== source) {
      this.panel.removeAttribute('data-timing-open');
      this.panel.removeAttribute('data-short-open');
    }
    this.panel.dataset.recordingSource = source;
    this.syncTimelineToggle();
    this.view=view;this.doc=doc;this.renderLanes();await this.visual.update(view,media);
  }
  private syncTimelineToggle() {
    const panel = this.panel;
    const unavailable = panel.dataset.recordingSource === 'absent';
    const short = !unavailable && panel.hasAttribute('data-compact-controls');
    const expanded = unavailable ? panel.hasAttribute('data-timing-open')
      : short ? panel.hasAttribute('data-short-open') : panel.dataset.detail === 'expanded';
    const label = unavailable ? (expanded ? 'Hide supplied timing' : 'Show supplied timing')
      : short ? (expanded ? 'Hide recording controls' : 'Show recording controls')
      : expanded ? 'Collapse recording timeline' : panel.dataset.detail === 'minimal' ? 'Expand recording panel' : 'Show recording timeline';
    const toggle = panel.querySelector<HTMLButtonElement>('#timeline-toggle')!;
    toggle.setAttribute('aria-controls', short ? 'recording-waveform audio-play audio-seek audio-speed recording-layers' : 'recording-layers');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    const visibleLabel=expanded?'Controls':'Recording controls';
    renderInto(toggle,
      short ? h.span.class('short-recording-label').children(visibleLabel) : '',
      icon(expanded ? 'expand_more' : 'expand_less'),
    );
  }
  private renderLanes(){if(!this.lanes||!this.doc||!this.view)return;const duration=this.audio.duration;const timed=this.doc.segments.filter(s=>s.start_us!==null&&s.end_us!==null&&s.start_us>=0&&s.end_us>s.start_us);
    const lane=(label:string,items:{id:string;start:number;end:number;className?:string;title:string}[])=>h.div.class('timeline-lane').children(
      h.span.class('lane-label').children(label),
      h.div.class('lane-track').children(
        items.map((i) =>
          h.span
            .class('interval ' + (i.className ?? ''))
            .attrs({'data-start': String(i.start), 'data-end': String(i.end), title: i.title})
            .children(i.id),
        ),
      ),
    );
    const segments=timed.map(s=>({id:s.id,start:s.start_us!/1e6,end:s.end_us!/1e6,title:`${s.id} · supplied utterance bounds ${s.start_us!/1e6}–${s.end_us!/1e6} s`}));
    const words=this.doc.tokens.filter(t=>t.start_us!==null&&t.end_us!==null&&t.end_us>t.start_us).map(t=>({id:t.id,start:t.start_us!/1e6,end:t.end_us!/1e6,title:`${t.id} · supplied word bounds`}));
    const lastSegment = segments.reduce((latest, segment) => Math.max(latest, segment.end), 0);
    const extent = this.panel.dataset.recordingSource === 'linked' && Number.isFinite(duration) && duration > 0
      ? duration : words.reduce((latest, word) => Math.max(latest, word.end), lastSegment);
    const changes=this.doc.tokens.filter(t=>t.corrected!==null);const groups=timed.filter(s=>changes.some(t=>t.utterance===s.id)).map(s=>({id:`${s.id} corrections`,start:s.start_us!/1e6,end:s.end_us!/1e6,className:'association',title:'Corrected tokens associated with this utterance. Exact word time may be unavailable; correction revision is inspected in History.'}));
    renderInto(this.lanes,
      h.div
      .class('timeline-ruler')
      .children(h.span('0 s'), h.span(extent ? extent.toFixed(1) + ' s' : 'No observed time axis')),
      extent ? lane('Utterances', segments) : h.p('No supplied utterance intervals'),
      words.length && extent
      ? lane('Word timing', words)
      : h.div
          .class('timeline-lane')
          .children(
            h.span.class('lane-label').children('Word timing'),
            h.small('No complete word times · no inference'),
          ),
      extent ? lane('Corrections', groups) : '',
      h.div.class('text-only-tray').children(
        'Text-only / unresolved: ',
        this.doc.spans
          .filter((s) => s.fields.wb_status === 'unresolved')
          .map((s) => s.id)
          .join(', ') || 'none marked',
        ' · ',
        String(this.view.issues.filter((i) => i.blocking).length),
        ' blocking / ',
        String(this.view.issues.filter((i) => !i.blocking).length),
        ' advisory package issues',
      ),
    );
    for(const track of this.lanes.querySelectorAll<HTMLElement>('.lane-track')){
      const ends:number[]=[];
      for(const element of track.querySelectorAll<HTMLElement>('.interval')){
        const start=Number(element.dataset.start),end=Number(element.dataset.end);let row=ends.findIndex(last=>last<=start);if(row<0)row=ends.length;ends[row]=end;
        element.style.left=(start/extent*100)+'%';element.style.width=((end-start)/extent*100)+'%';element.style.top=(3+row*24)+'px';
      }
      track.style.height=Math.max(24,ends.length*24)+'px';
    }
  }
}
