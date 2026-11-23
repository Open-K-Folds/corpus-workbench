import {api,ApiError,commit,loadView,login,makeCommand,resumeSession} from './api';
import type {Command,Document,Operation,View} from './contracts';
import {el,esc,field,formValues,seconds} from './dom';
import {emptyTokenInspector,tokenInspector,annotationInspector} from './inspector';
import {historyInspector} from './history';
import {reviewInspector} from './review';
import {researchInspector} from './research';
import {coanalysisInspector} from './coanalysis';
import {TrainingPanel} from './training-panel';
import {passageAnchor,suppliedCue,type CueState,type PassageAnchor,type RecordingCue} from './listening';
import {ResearchOverview} from './overview';
import {ReadingCanvas,stageControls} from './reading-canvas';
import {PlaybackSync} from './playback-sync';
import {watchPreviewUpdates} from './preview-updates';
import {windowBar,activityRail,drawerClose,bindActivityRail,workspaceSettings,initialLayout} from './studio-shell';
import {referenceInspector} from './references';
import {retokenizationInspector} from './retokenization';
import {teitokReaderInspector} from './teitok-reader';
import {reconciliationInspector} from './reconciliation';
import {corpusSearch,type SearchPanel} from './search';
import {documentNavigation,sourceNavigation,inspectorNavigation,inspectorViews,isInspectorView,reading,visibleToken,type InspectorView,type ReadingPreferences} from './workspace';
import {sourceInspector} from './source';
import {Transcript} from './transcript';
import {RecordingPanel,resizeWorkbenchSides} from './panes';
import './style.css';
import './editor.css';
import './controls.css';
import './review.css';
import './workbench-shell.css';
import './drawers.css';
import {readingToolbar} from './reading-toolbar';
import {projectDrawerBody} from './project-drawer';
import {icon} from './icons';
import {buttonGroup,scrollIndicators} from './controls';
import {desktop,desktopNavigation,initializeDesktop,type Departure} from './desktop';
let view:View;let docPath='';let selected:string[]=[];let tab:InspectorView|'source'='token';let sourcePath='';let navigationMode:'documents'|'sources'='documents';let navigationQuery='';const readingPreferences:ReadingPreferences={query:'',layer:'corrected',filter:'all'};let saving=false;let loop=false;let redoRevision:number|null=null;let conflict:{operations:Operation[];label:string;latest:View;source?:HTMLFormElement;sourceValues:string|null}|null=null;
const tokenDrafts=new Map<string,HTMLElement>();const annotationDrafts=new Map<string,HTMLElement>();const structuralDrafts=new Map<string,HTMLElement>();
const returnDrafts=new Map<number,HTMLElement>();
let coanalysisDraft: {key: string; revision: number; document: string; panel: HTMLElement} | null = null;
let training:TrainingPanel;
let cueMedia: {document:string;snapshot:string;scope:string}|null = null;
let pinnedPlayback: {anchor:PassageAnchor;cue:RecordingCue}|null = null;
let pinTimer:ReturnType<typeof setTimeout>|undefined;
let pendingWrite:{command:Command;source?:HTMLFormElement;unlock:()=>void;before:number;restore:boolean}|null=null;let searchPanel:SearchPanel|null=null;let transcript:Transcript;let recording:RecordingPanel;let openDocuments:string[]=[];const documentStates=new Map<string,{selected:string[];time:number;scroll:number}>();
const draftPanels=()=>[...tokenDrafts.values(),...annotationDrafts.values(),...structuralDrafts.values(),...returnDrafts.values(),...(coanalysisDraft ? [coanalysisDraft.panel] : []),...(training ? [training.node] : [])];let annotationRevision=0;let inspectorEpoch=0;
const app=el('app');
const remotePreview=import.meta.env.VITE_WB_REMOTE_PREVIEW === '1' && !desktop;
if(desktop)document.documentElement.classList.add('desktop-app');
try{document.documentElement.dataset.theme=localStorage.getItem('wb-theme')??'dark'}catch{document.documentElement.dataset.theme='dark'}
let shellEvents:AbortController|undefined;
const singleSidePane = matchMedia('(min-width:701px) and (max-width:1020px)');
let overview:ResearchOverview|null=null;
let readingCanvas:ReadingCanvas|null=null;
let playbackSync:PlaybackSync|null=null;
function departure():Departure {
  const inline=transcript?.departureState()??{dirty:false,recoverable:true,saving:false};
  const memory=draftPanels().some(e=>e.querySelector('form[data-dirty="true"]')!==null)||app.querySelector('form[data-desktop-dirty="true"]:not([data-dirty])')!==null;
  return {dirty:memory||inline.dirty||!!pendingWrite,recoverable:!memory&&!pendingWrite&&inline.recoverable,saving:saving||!!pendingWrite||inline.saving};
}
window.addEventListener('beforeunload',event=>{const state=departure();desktop?.reportDraft(state);if(state.dirty||state.saving){event.preventDefault();event.returnValue=''}});
if(desktop){
  document.addEventListener('input',event=>{const form=(event.target as HTMLElement).closest('form');if(form&&form.dataset.dirty===undefined)form.dataset.desktopDirty='true'});
  document.addEventListener('reset',event=>{const form=event.target as HTMLFormElement;delete form.dataset.desktopDirty});
}
function lockAuthoring(keepPlayback=false){const controls=[...document.querySelectorAll<HTMLInputElement>('button,input,select,textarea')].filter(e=>!keepPlayback||(!e.closest('#recording-pane,#research-overview,#canvas-listening')&&e.id!=='open-overview')).map(e=>[e,e.disabled] as const);controls.forEach(([e])=>e.disabled=true);return ()=>controls.forEach(([e,disabled])=>e.disabled=disabled);}
async function performResearch(action:()=>Promise<unknown>){
  const state=departure();if(state.dirty||state.saving||transcript.busy())throw new Error('Save or discard all authoring drafts and resolve pending saves before a research handoff.');
  saving=true;const unlock=lockAuthoring(true);
  try{await action();const latest=await loadView();const changed=latest.revision.id!==view.revision.id||latest.revision.snapshot_hash!==view.revision.snapshot_hash||latest.approved!==view.approved;view=latest;if(changed)render();}
  finally{saving=false;unlock();overview?.update();if(el('message').textContent==='Wait for the current save or local handoff to finish. Recording controls remain available.')message('');}
}
function message(text:string,isError=false){el('message').textContent=text;el('message').className=isError?'notice error':'notice';}
function currentDoc():Document{return view.documents.find(d=>d.path===docPath)??view.documents[0]}
async function start(){
  const code=new URLSearchParams(location.hash.slice(1)).get('session');
  let expiredLink=false;
  if(code){
    const fragment=new URLSearchParams(location.hash.slice(1));fragment.delete('session');
    history.replaceState({},'',location.pathname+location.search+(fragment.size?'#'+fragment.toString():''));
    try{await login(code)}catch(error){if(!(error instanceof ApiError)||error.status!==403)throw error;expiredLink=true}
  }
  try{await resumeSession();view=await loadView();
    if(!docPath && desktop && view.snapshot.project==='synthetic' && view.documents.some(doc=>doc.path==='xmlfiles/SYNTHETIC-WORKBENCH.xml'))
      docPath=view.documents.find(doc=>doc.path==='xmlfiles/noticeboard.xml')?.path??'';
    shell();render();void followCitation();}catch(e){if(e instanceof ApiError&&e.status===403){loginScreen(expiredLink);return}throw e}
}
function loginScreen(expiredLink=false){
  const form=`<form id="login-form"><label for="login-code">Session code</label><input id="login-code" name="code" type="password" required autocomplete="off" spellcheck="false"><p id="login-error" role="alert"></p><button type="submit">Open workbench</button></form>`;
  const access=remotePreview
    ? `<a class="cloudflare-sign-in" href="/open">Sign in with Cloudflare${icon('arrow_forward')}</a><details class="login-fallback"><summary>Use a session code</summary>${form}</details>`
    : form;
  const help=remotePreview?'Sign in with the account authorized for this workspace.':'Open the protected launcher on this machine or enter its session code.';
  const expired=expiredLink?`<p class="login-expired" role="alert">${remotePreview?'This link has expired. Sign in again to continue.':'This link has expired. Open the current launcher or enter its new code.'}</p>`:'';
  app.innerHTML=`${windowBar(false)}<main class="login"><h1>Open your workbench</h1><p class="login-help">${help}</p>${expired}${access}</main>`;
  const loginForm=el<HTMLFormElement>('login-form'), input=el<HTMLInputElement>('login-code'), error=el('login-error');
  const submit=loginForm.querySelector('button')!;
  input.oninput=()=>{input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');error.textContent=''};
  loginForm.onsubmit=async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    submit.disabled=true;submit.textContent='Opening…';
    try {await login(input.value.trim());await start()}
    catch(failure){
      if(failure instanceof ApiError && failure.status===403){
        error.textContent='This session code was not accepted. Use the code from the current launcher.';
        input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby','login-error');input.focus();input.select();
      }else{error.textContent='Could not open the workbench. Check your connection and try again.'}
    }finally{submit.disabled=false;submit.textContent='Open workbench'}
  };
}
function shell(){shellEvents?.abort();shellEvents=new AbortController();overview?.dispose();playbackSync?.destroy();readingCanvas?.dispose();app.innerHTML=`<a class="skip-link" href="#tokens">Skip to transcript</a>
  ${windowBar(true)}${activityRail()}
  <div id="message" role="alert"></div><div id="conflict"></div><div id="save-recovery" aria-live="polite"></div><div class="workspace navigation-folded properties-folded"><aside class="documents" aria-label="Corpus navigation"><div class="drawer-bar"><div class="drawer-trail"><span>Workspace</span><span aria-hidden="true">/</span><strong>Projects</strong></div>${drawerClose('navigation')}</div>${projectDrawerBody()}</aside>
  <main class="transcript">
    <div id="document-tabs" role="tablist" aria-label="Open documents"></div>
    ${readingToolbar()}
    <div class="transcript-title"><h2 id="document-title"></h2></div>
    <p class="canvas-help">Drag across words to select a passage. Drag the margin to move through the transcript.</p>
    <div id="tokens" tabindex="-1"></div>
  </main>
  <section id="training-comparison" aria-label="Compare with selected transcript"></section>
  ${stageControls()}
  <aside class="inspector" aria-label="Inspector"><div class="drawer-bar">
    <details class="inspector-tools" open>
      <summary class="drawer-trail" title="Choose inspector tool"><span>Tools</span><span aria-hidden="true">/</span><strong id="current-inspector"></strong>${icon('expand_more')}</summary>
      <nav aria-label="Inspector">${inspectorNavigation()}</nav>
    </details>${drawerClose('properties')}</div>
    <div id="inspector-content" role="region" tabindex="-1"></div></aside></div>
  <section id="recording-pane" class="audio" aria-label="Recording">
    <audio id="audio" preload="metadata"></audio><p id="audio-availability" class="muted" hidden>No playable media is included for this document.</p>
    <div class="actions" role="group" aria-label="Selection playback" hidden>
      <button type="button" id="listen-selected" class="secondary" aria-label="Play from selection">${icon('play_arrow')}<span>Play from selection</span></button>
      <label class="selection-loop" title="Loop selection"><input id="loop-selection" type="checkbox" role="switch" aria-label="Loop selection">${icon('repeat')}</label>
    </div>
  </section>
  <footer class="studio-status"><span id="stage-file"></span><span id="stage-metadata"></span><span id="token-count" role="status"></span></footer>
  <div id="passage-tools-layer" role="region" aria-label="Passage actions"></div>
  ${workspaceSettings()}`;
  bindActivityRail(app,shellEvents.signal);
  if (remotePreview) {
    watchPreviewUpdates(app.querySelector<HTMLElement>('.studio-status')!, shellEvents.signal);
  }
  if(initialLayout()==='editing')document.querySelector('.workspace')!.classList.remove('navigation-folded','properties-folded');
  desktopNavigation(el('local-project-actions'));
  readingCanvas=new ReadingCanvas(app);
  training=new TrainingPanel({dirty:draftStatus,read:()=>el('rail-reading').click(),save,reset:async stale=>{
    if(saving||pendingWrite)return;
    if(stale){
      if(transcript.dirty()||draftPanels().some(panel=>panel!==training.node&&panel.querySelector('form[data-dirty="true"]'))){
        message('Finish your other drafts before reloading the saved revision.',true);return;
      }
      try{view=await loadView();}catch(error){message(String(error),true);return;}
    }
    training.clear();render();draftStatus();
  }},el('training-comparison'));
  const audioPane=el('recording-pane');
  // A text-only document can use the compact recording header on its first paint.
  if (!recordingCandidate(currentDoc())) {
    audioPane.dataset.recordingSource='absent';
    el('audio-availability').hidden=false;
  }
  const settings=document.querySelector<HTMLDetailsElement>('.reading-settings')!;
  document.querySelector('.documents')!.insertAdjacentHTML('beforeend','<div id="navigation-resizer" class="side-resizer" aria-label="Resize projects pane"></div>');
  document.querySelector('.inspector')!.insertAdjacentHTML('afterbegin','<div id="properties-resizer" class="side-resizer" aria-label="Resize properties pane"></div>');
  resizeWorkbenchSides(document.querySelector<HTMLElement>('.workspace')!,el('navigation-resizer'),el('properties-resizer'));
  document.querySelector('.documents')!.id='projects-pane';document.querySelector('.inspector')!.id='properties-pane';
  document.querySelector<HTMLElement>('.workspace')!.dataset.focus='transcript';
  const fold=(side:'navigation'|'properties')=>{
    const workspace=document.querySelector<HTMLElement>('.workspace')!;
    if(matchMedia('(max-width:700px)').matches){
      workspace.dataset.focus=workspace.dataset.focus===side?'transcript':side;
      if(workspace.dataset.focus===side) workspace.classList.remove(side+'-folded');
    } else if(workspace.dataset.parked===side) {
      workspace.dataset.focus=side;
    } else {
      const folded=workspace.classList.toggle(side+'-folded');
      workspace.dataset.focus=folded?'transcript':side;
    }
    updatePaneAccessibility();
  };
  el('toggle-navigation').onclick=()=>{readingCanvas?.close(false);fold('navigation')};
  el('window-library').onclick=()=>el('toggle-navigation').click();
  el('toggle-properties').onclick=()=>{
    readingCanvas?.close(false);
    const opens=el('toggle-properties').getAttribute('aria-expanded')!=='true';
    if(opens && initialLayout()==='stage' && tab==='token'){
      app.querySelector<HTMLDetailsElement>('.inspector-tools')!.open=selected.length===0;
    }
    fold('properties');
  };
  el('rail-reading').onclick=()=>{const workspace=document.querySelector<HTMLElement>('.workspace')!;workspace.classList.add('properties-folded','navigation-folded');workspace.dataset.focus='transcript';updatePaneAccessibility();el('tokens').focus({preventScroll:true})};
  for(const button of app.querySelectorAll<HTMLButtonElement>('.studio-rail [data-inspect]')){
    button.onclick=()=>{const target=button.dataset.inspect;if(target && isInspectorView(target))openInspectorActivity(target)}
  }
  for(const button of app.querySelectorAll<HTMLButtonElement>('[data-close-drawer]')){
    button.onclick=()=>{
      if(matchMedia('(max-width:700px)').matches){showTranscript();return}
      const side=button.dataset.closeDrawer!;
      fold(side==='navigation'?'navigation':'properties');
      el('toggle-'+side).focus({preventScroll:true});
    };
  }
  const settingsDialog=el<HTMLDialogElement>('workspace-settings');
  el('workspace-options').onclick=()=>{const layout=settingsDialog.querySelector<HTMLInputElement>(`[value="${initialLayout()}"]`)!;layout.checked=true;settingsDialog.showModal()};
  settingsDialog.addEventListener('change',event=>{
    const choice=(event.target as HTMLInputElement).value;
    if(choice!=='stage' && choice!=='editing')return;
    try{localStorage.setItem('wb-studio-layout',choice)}catch{}
    readingCanvas?.close(false);
    const workspace=document.querySelector<HTMLElement>('.workspace')!;
    for(const side of ['navigation','properties'])workspace.classList.toggle(side+'-folded',choice==='stage');
    workspace.dataset.focus='transcript';settings.open=false;updatePaneAccessibility();
  });
  document.querySelector<HTMLAnchorElement>('.skip-link')!.onclick=()=>{showTranscript()};
  matchMedia('(max-width:700px)').addEventListener('change',updatePaneAccessibility,{signal:shellEvents.signal});
  singleSidePane.addEventListener('change',updatePaneAccessibility,{signal:shellEvents.signal});
  updatePaneAccessibility();
  const setTheme=(theme:string)=>{document.documentElement.dataset.theme=theme;desktop?.reportAppearance(theme==='dark'?'dark':'light');el('toggle-theme').querySelector('.material-symbol')!.textContent=theme==='dark'?'light_mode':'dark_mode';el('toggle-theme').setAttribute('aria-pressed',String(theme==='dark'));try{localStorage.setItem('wb-theme',theme)}catch{}};
  try{setTheme(localStorage.getItem('wb-theme')??'dark')}catch{setTheme('dark')}
  el('toggle-theme').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  transcript=new Transcript(el('tokens'),{training:(mode,ids,limit)=>{
    if(saving||pendingWrite||transcript.busy()||transcript.activeDraft())return;
    selected=[...ids];tab='training';app.querySelector<HTMLDetailsElement>('.inspector-tools')!.open=false;showProperties();training.update(view,currentDoc(),ids,{mode,limit});
    void renderInspector().then(()=>{const heading=training.node.querySelector<HTMLElement>('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}});
  },view:()=>view,doc:currentDoc,preferences:readingPreferences,selected:()=>selected,select:ids=>{selected=ids;if(findingTokens())refreshFindControls();void renderInspector()},openDocument:path=>{el<HTMLAudioElement>('audio').pause();docPath=path;selected=[];render()},tool:(name,anchor)=>{if(saving||pendingWrite||transcript.busy())return;if(isInspectorView(name)){tab=name;showProperties();const basis=view.revision.id,scope=docPath;void renderInspector().then(()=>{if(!anchor||name!=='annotations'||basis!==view.revision.id||scope!==docPath)return;const form=document.querySelector<HTMLFormElement>('#span-form');if(!form||form.dataset.dirty==='true'){message('Existing annotation draft preserved. Inspect the selected character anchor before changing it.',true);return}for(const key of ['start','end','quote'] as const)(form.elements.namedItem(key) as HTMLInputElement).value=String(anchor[key]);const details=form.querySelector('details');if(details)details.open=true;form.dispatchEvent(new Event('input',{bubbles:true}))})}},status:text=>el('save-state').textContent=text,message,accepted:latest=>{view=latest;render()},busy:()=>saving||pendingWrite!==null,otherDraft:()=>draftPanels().some(e=>e.querySelector('form[data-dirty="true"]')),listening:{check:checkCue,play:listen},projection:unsupported=>configureMedia(unsupported)});
  recording=new RecordingPanel(audioPane,el<HTMLAudioElement>('audio'));
  playbackSync=new PlaybackSync(el<HTMLAudioElement>('audio'),el('tokens'),turn=>readingCanvas?.setPlaybackTurn(turn));
  overview=new ResearchOverview({view:()=>view,doc:currentDoc,selected:()=>selected,audio:el<HTMLAudioElement>('audio'),analysis:()=>recording.overview(),busy:()=>saving||!!pendingWrite,go:openInspectorActivity});
  el('open-overview').onclick=()=>overview?.open();
  el('transcript-layout').onchange=e=>transcript.setLayout((e.target as HTMLInputElement).value as 'lines'|'paragraphs');
  buttonGroup(document.querySelector('.navigation-modes')!);buttonGroup(el('document-tabs'));
  buttonGroup(document.querySelector('.inspector nav')!,()=>initialLayout()==='editing');scrollIndicators(app);
  el<HTMLInputElement>('show-interlinear').onchange=e=>transcript.setInterlinear((e.target as HTMLInputElement).checked);
  el('native-problems').onclick=()=>openInspectorActivity('review');
  el('open-research').onclick=()=>openInspectorActivity('research');
  el<HTMLFormElement>('source-jump-form').onsubmit=event=>{
    event.preventDefault();
    if(!transcript.location(el<HTMLInputElement>('source-location').value.trim()))
      message('No such source ID in this document. Display wrapping does not create line IDs.',true);
  };
  el('copy-citation').onclick=async()=>{const citation=transcript.citation();const url=new URL(location.origin+location.pathname);url.hash=new URLSearchParams({loc:JSON.stringify(citation)}).toString();try{await navigator.clipboard.writeText(url.href);message(`Copied ${currentDoc().title} · ${citation.anchor??'document'} · R${citation.revision}. The link needs an authenticated local session.`)}catch{message('Clipboard access is unavailable. Select a source ID and use Go to inspect its location.',true)}};
  el('navigate-documents').onclick=()=>{navigationMode='documents';renderNavigation()};
  el('navigate-sources').onclick=()=>{navigationMode='sources';renderNavigation()};
  el('clear-navigation').onclick=()=>{
    const input=el<HTMLInputElement>('navigation-query');
    input.value='';navigationQuery='';renderNavigation();input.focus();
  };
  el<HTMLInputElement>('navigation-query').oninput=e=>{navigationQuery=(e.target as HTMLInputElement).value;renderNavigation()};
  const query=el<HTMLInputElement>('token-query'),filter=el<HTMLSelectElement>('token-filter');
  const readingPane=app.querySelector<HTMLElement>('.transcript')!;
  findOrigin=null;
  const findPanel=el('reader-find'), findButton=el('find-in-transcript');
  function showFindPanel(show:boolean){
    findPanel.hidden=!show;
    findButton.setAttribute('aria-expanded',String(show));
    if(show){
      const guide=el('reading-guide');
      if(guide.matches(':popover-open'))guide.hidePopover();
      settings.open=false;
    }
  }
  function rememberReadingPlace(){
    if(findOrigin?.document!==docPath)findOrigin={document:docPath,scroll:readingPane.scrollTop,controlsOpen:settings.open};
  }
  function openFind(){
    if(saving||pendingWrite||transcript.busy()||transcript.activeDraft())return;
    readingCanvas?.close(false);showTranscript();rememberReadingPlace();
    showFindPanel(true);query.focus();
  }
  function updateFilter(){
    if(saving||pendingWrite||transcript.busy()||transcript.dirty()){
      message('Finish or undo the correction draft before filtering.',true);
      query.value=readingPreferences.query;filter.value=readingPreferences.filter;return;
    }
    rememberReadingPlace();
    readingPreferences.query=query.value;readingPreferences.filter=filter.value as ReadingPreferences['filter'];
    renderTokens();
  }
  const sectionSwitch=el('reader-section-switch');
  buttonGroup(sectionSwitch);
  for(const button of sectionSwitch.querySelectorAll<HTMLButtonElement>('button')){
    button.onclick=()=>{
      const isDisplay=button.getAttribute('aria-controls')==='reader-display';
      settings.querySelector<HTMLElement>('.reader-sheet')!.dataset.readerSection=isDisplay?'display':'source';
      for(const other of sectionSwitch.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===button));
    };
  }
  settings.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&settings.open&&!el('reading-guide').matches(':popover-open')){
      event.preventDefault();
      settings.open=false;
      settings.querySelector('summary')!.focus();
    }
  });
  settings.addEventListener('toggle',()=>{
    if(settings.open){
      showFindPanel(false);
      if(!findingTokens())findOrigin=null;
    }
  });
  findButton.onclick=()=>{if(findPanel.hidden)openFind();else el('clear-token-search').click();};
  query.oninput=updateFilter;
  findPanel.onkeydown=event=>{
    if(event.isComposing)return;
    if(event.key==='Enter'&&event.target===query&&findingTokens()){event.preventDefault();void nextMatch();}
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();el('clear-token-search').click();}
  };
  el<HTMLSelectElement>('reading-layer').onchange=e=>{if(transcript.dirty()){(e.target as HTMLSelectElement).value=readingPreferences.layer;message('Finish or undo the correction draft before changing layers.',true);return}readingPreferences.layer=(e.target as HTMLSelectElement).value as ReadingPreferences['layer'];renderTokens()};
  filter.onchange=updateFilter;
  el('clear-token-search').onclick=async()=>{
    if(saving||pendingWrite||transcript.busy()||transcript.dirty()){
      message('Finish or undo the correction draft before filtering.',true);return;
    }
    const origin=findOrigin?.document===docPath?findOrigin:null;
    findOrigin=null;readingPreferences.query=query.value='';readingPreferences.filter='all';filter.value='all';
    showFindPanel(false);
    if(origin)settings.open=origin.controlsOpen;
    refreshFindControls();
    const scope=docPath;
    findButton.focus({preventScroll:true});
    await transcript.render();
    if(scope!==docPath||findingTokens()||findOrigin||document.activeElement!==findButton)return;
    el('tokens').focus({preventScroll:true});
    if(origin)readingPane.scrollTop=origin.scroll;
  };
  el('next-match').onclick=nextMatch;
  el('listen-selected').onclick=()=>void listen(currentAnchor());
  el('dock-listen-passage').onclick=()=>void listen(currentAnchor(),true);
  el('dock-analyze-passage').onclick=()=>{
    if(!selected.length||saving||pendingWrite||transcript.busy())return;
    if(transcript.activeDraft()){message('Finish the current correction before analyzing the passage.',true);return}
    openInspectorActivity('coanalysis');
  };
  el<HTMLInputElement>('loop-selection').onchange=e=>{loop=(e.target as HTMLInputElement).checked};
  const audio=el<HTMLAudioElement>('audio');
  for(const event of ['loadedmetadata','canplay','durationchange','emptied','error'])audio.addEventListener(event,refreshListenControls);
  audio.addEventListener('pause',()=>{if(audio.paused)clearPinnedPlayback()});
  for(const event of ['playing','ratechange','seeked'])audio.addEventListener(event,checkPinnedEnd);
  audio.ontimeupdate=()=>{
    if(audio.paused)return;
    if(pinnedPlayback)checkPinnedEnd();
    else if(loop){
      const anchor=currentAnchor(),cue=checkCue(anchor);
      if(!('reason' in cue)&&audio.currentTime>=cue.end)void listen(anchor);
    }
  };
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button=>button.onclick=()=>{
    const target=button.dataset.tab;
    if(!target||!isInspectorView(target))return;
    if(initialLayout()==='stage')openInspectorActivity(target);
    else {tab=target;showProperties();void renderInspector()}
  });
  el('export-package').onclick=async()=>{try{if(desktop){message('Preparing exact revision export…');const result=await desktop.exportRevision(view.revision.id);message(result.cancelled?'Export cancelled.':`Complete package saved for R${view.revision.id}.`);return}message('Preparing exact revision export…');const r=await api<{revision:number;download:string;job_id:string}>('/api/export',{revision:view.revision.id});message(`Complete export ready for R${r.revision}.`);const a=document.createElement('a');a.href=r.download;a.textContent='Download complete package';a.setAttribute('download','');el('message').append(' ',a)}catch(e){message(String(e),true)}};
  document.addEventListener('keydown',event=>{
    if(saving||pendingWrite||transcript.busy()||event.isComposing||document.querySelector('dialog[open]'))return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!transcript.activeDraft()){event.preventDefault();openFind();return}
    if(event.key==='F3' && !(event.target as HTMLElement).closest('[contenteditable],#inline-replacement')){event.preventDefault();nextMatch();return}
    if((event.target as HTMLElement).closest('#tokens,[contenteditable]'))return;
    if(event.altKey&&/^[1-9]$/.test(event.key)){event.preventDefault();openInspectorActivity(inspectorViews[Number(event.key)-1].id);return}
    if((event.target as HTMLElement).closest('input,textarea,select,button,a,summary'))return;
    if(event.code==='Space'&&audio.hasAttribute('src')&&!audio.error){
      event.preventDefault();
      if(audio.paused)void audio.play().catch(()=>message('The recording could not be played.',true));
      else audio.pause();
    }
  });
}
function render(){searchPanel?.update(view);const doc=currentDoc();docPath=doc.path;selected=selected.filter(id=>doc.tokens.some(t=>t.id===id));
  if(cueMedia?.document!==docPath || cueMedia.snapshot!==view.revision.snapshot_hash)playbackSync?.bind(null,'');
  el('save-state').textContent=`Saved R${view.revision.id} · ${view.approved?'Approved exact revision':'Unreviewed'}`;
  el('document-title').textContent=doc.title;
  const blocking=view.issues.filter(issue=>issue.blocking).length;
  const checks=el('native-problems');
  const checksLabel='Package checks'+(view.issues.length?` (${view.issues.length})`:'');
  checks.innerHTML=icon('fact_check')+checksLabel;
  checks.title=`Package validation · ${blocking} blocking / ${view.issues.length-blocking} advisory`;
  checks.setAttribute('aria-label',checksLabel+'. '+checks.title);
  el('project-title').textContent=view.snapshot.project;
  el('drawer-project-title').textContent=view.snapshot.project;
  el('stage-file').textContent=doc.path;
  el('stage-metadata').textContent=`${doc.spans.length} ${doc.spans.length===1?'annotation':'annotations'}`;
  el('package-count').textContent=`${view.documents.length} document${view.documents.length===1?'':'s'}`;
  renderNavigation();
  el('package-report').innerHTML=`<p>${Object.keys(view.snapshot.files).length} preserved files</p><p>${esc(view.snapshot.index_status)}</p><p>${esc(view.snapshot.config.rights)}</p><p>Unknown structures: ${esc(doc.opaque_elements.join(', ')||'none')}</p>`;
  renderDocumentTabs();renderTokens();void renderInspector(true);
}
function renderNavigation(){const doc=currentDoc();
  el('clear-navigation').hidden=!navigationQuery;
  el('navigate-documents').setAttribute('aria-pressed',String(navigationMode==='documents'));el('navigate-sources').setAttribute('aria-pressed',String(navigationMode==='sources'));
  el('document-list').hidden=navigationMode!=='documents';el('source-list').hidden=navigationMode!=='sources';
  el('document-list').innerHTML=documentNavigation(view,doc,navigationQuery);el('source-list').innerHTML=sourceNavigation(view,navigationQuery,sourcePath);
  document.querySelectorAll<HTMLButtonElement>('[data-document]').forEach(button=>button.onclick=()=>{switchDocument(button.dataset.document!)});
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(button=>button.onclick=()=>{sourcePath=button.dataset.source!;
    for(const source of app.querySelectorAll<HTMLButtonElement>('[data-source]'))source.setAttribute('aria-current',String(source===button));
    if(matchMedia('(max-width:700px)').matches){openInspectorActivity('source');return}
    tab='source';showProperties();void renderInspector()});
}
function findingTokens(){return !!readingPreferences.query.trim()||readingPreferences.filter!=='all';}
let findOrigin:{document:string;scroll:number;controlsOpen:boolean}|null=null;
function refreshFindControls(){
  const active=findingTokens();
  el('tokens').toggleAttribute('data-filtered',active);
  el('find-in-transcript').toggleAttribute('data-filtered',active);
  const next=el<HTMLButtonElement>('next-match');
  next.hidden=!active;
  const status=el('reading-match-count');
  if(!active){status.textContent='';return;}
  const matches=currentDoc().tokens.filter(token=>visibleToken(token,readingPreferences));
  const index=selected.length===1?matches.findIndex(token=>token.id===selected[0]):-1;
  next.disabled=matches.length===0;
  status.textContent=index>=0?`Match ${index+1} of ${matches.length}`
    :matches.length?`${matches.length} ${matches.length===1?'match':'matches'}`:'No matches';
}
async function nextMatch(){
  if(saving||pendingWrite||transcript.busy()||transcript.dirty()){message('Finish or undo the correction draft before moving to another match.',true);return}
  const matches=currentDoc().tokens.filter(token=>visibleToken(token,readingPreferences));if(!matches.length)return;
  const next=matches[(matches.findIndex(token=>token.id===selected[0])+1)%matches.length];
  const basis=view.revision.snapshot_hash,scope=docPath,epoch=inspectorEpoch,{query,filter}=readingPreferences;
  selected=[next.id];tab='token';refreshFindControls();await transcript.render();
  if(saving||pendingWrite||transcript.dirty()||basis!==view.revision.snapshot_hash||scope!==docPath||epoch!==inspectorEpoch||selected[0]!==next.id||query!==readingPreferences.query||filter!==readingPreferences.filter)return;
  void renderInspector();
  const word=document.querySelector<HTMLElement>(`[data-token="${CSS.escape(next.id)}"]`);
  word?.focus({preventScroll:true});word?.scrollIntoView({block:'nearest'});
}
function draftStatus(){const dirty=draftPanels().some(panel=>panel.querySelector('form[data-dirty="true"]'));el('save-state').textContent=dirty?'Unsaved draft - saved head R'+view.revision.id:`Saved R${view.revision.id} - ${view.approved?'Approved exact revision':'Unreviewed'}`;}
function renderTokens(){refreshFindControls();refreshListenControls();void transcript.render()}
function currentAnchor(){return passageAnchor(view,docPath,selected)}
function currentBasis(anchor:PassageAnchor){
  return anchor.document===docPath && anchor.project===view.snapshot.project && anchor.revision===view.revision.id && anchor.snapshot_hash===view.revision.snapshot_hash;
}
function checkCue(anchor:PassageAnchor):CueState {
  if(!currentBasis(anchor))return {reason:'Open the pinned document at its original revision to listen.'};
  const audio=el<HTMLAudioElement>('audio');
  if(!cueMedia || cueMedia.document!==docPath || cueMedia.snapshot!==anchor.snapshot_hash || audio.hidden || !audio.getAttribute('src') || cueMedia.scope!==audio.dataset.mediaScope)
    return {reason:'No associated recording is available for this passage.'};
  if(audio.error || audio.readyState<1 || !Number.isFinite(audio.duration) || audio.duration<=0)
    return {reason:'The recording is unavailable or still loading.'};
  return suppliedCue(currentDoc(),anchor.token_ids,audio.duration);
}
function refreshListenControls(){
  if(!view||saving||pendingWrite||transcript?.busy())return;
  const state=checkCue(currentAnchor()),button=el<HTMLButtonElement>('listen-selected');
  button.closest<HTMLElement>('.actions')!.hidden=!selected.length;
  button.disabled='reason' in state;
  button.title='reason' in state?state.reason:`Start playback at the supplied ${state.basis} time (${state.start} s).`;
  const context=el('canvas-passage-context');
  context.hidden=!selected.length;
  if(selected.length){
    const remaining=new Set(selected);
    const excerpt:string[]=[];
    let previous=-1;
    for(const [index,token] of currentDoc().tokens.entries()){
      if(!remaining.delete(token.id))continue;
      if(excerpt.length>=12){excerpt.push('…');break}
      if(previous>=0 && index!==previous+1)excerpt.push('…');
      excerpt.push(reading(token,readingPreferences.layer));
      if(!remaining.size)break;
      previous=index;
    }
    const label=context.querySelector<HTMLElement>('.canvas-passage-excerpt')!;
    label.textContent=excerpt.join(' ');
    label.title=label.textContent;
    const play=el<HTMLButtonElement>('dock-listen-passage');
    play.disabled='reason' in state;
    play.title='reason' in state?state.reason:`Play the selected passage using its supplied ${state.basis} timing.`;
  }
  transcript?.refreshListen();
  coanalysisDraft?.panel.dispatchEvent(new Event('wb-cue-change'));
}
async function listen(anchor:PassageAnchor,bounded=false){
  const cue=checkCue(anchor);
  if('reason' in cue){message(cue.reason);refreshListenControls();return}
  const audio=el<HTMLAudioElement>('audio');
  const playback=bounded?{anchor,cue}:null;
  clearPinnedPlayback();
  pinnedPlayback=playback;
  try{audio.currentTime=cue.start;await audio.play();if(playback===pinnedPlayback)checkPinnedEnd()}
  catch(error){
    if(pinnedPlayback===playback)clearPinnedPlayback();
    if(currentBasis(anchor)&&!(error instanceof DOMException&&error.name==='AbortError'))message('Recording playback could not start. '+String(error),true);
  }
}
function clearPinnedPlayback(){
  clearTimeout(pinTimer);pinTimer=undefined;pinnedPlayback=null;
}
function checkPinnedEnd(){
  if(!pinnedPlayback)return;
  clearTimeout(pinTimer);
  const audio=el<HTMLAudioElement>('audio'),{anchor,cue}=pinnedPlayback;
  if(!currentBasis(anchor)){clearPinnedPlayback();audio.pause();return}
  if(audio.paused)return;
  if(audio.currentTime>=cue.end){clearPinnedPlayback();audio.pause();audio.currentTime=cue.end;return}
  // timeupdate alone can arrive a quarter second after a short word ends.
  if(audio.playbackRate>0)pinTimer=setTimeout(checkPinnedEnd,Math.max(10,(cue.end-audio.currentTime)*1000/audio.playbackRate));
}
function offerSaveRetry() {
  const retry = document.createElement('button');
  retry.id = 'resolve-pending-save';
  retry.textContent = 'Resolve original save';
  retry.onclick = () => void resolvePendingWrite();
  el('save-recovery').replaceChildren(retry);
}
function markSourceStale(source: HTMLFormElement) {
  conflict = null;
  el('conflict').replaceChildren();
  if(source.id==='training-review'){el('save-state').textContent='Unsaved training review';training.markStale();return;}
  el('save-state').textContent = 'Unsaved co-analysis draft';
  source.dispatchEvent(new Event('wb-stale'));
}
async function save(operations: Operation[], label: string, source?: HTMLFormElement, basis = view) {
  if (saving) return;
  if (pendingWrite) { message('Resolve the original pending save before another revision operation.', true); return; }
  if (transcript.dirty()) { message('Finish or undo the in-place correction draft before another revision operation.', true); return; }
  const drafts = draftPanels().flatMap(panel => [...panel.querySelectorAll<HTMLFormElement>('form[data-dirty="true"]')]);
  if (drafts.some(form => form !== source)) {
    const pinned = drafts.some(form => form !== source && form.id === 'coanalysis-form');
    message(pinned ? 'Save or discard your pinned Co-analysis draft before committing this change.' : 'Save or discard other annotation drafts, structural drafts or token drafts before committing this change.', true);
    return;
  }
  const sourceValues = source ? JSON.stringify(formValues(source)) : null;
  const bound = makeCommand(basis, operations, label);
  const restore = operations.some(op => op.kind === 'restore');
  const unlock = lockAuthoring();
  let confirmed: number | null = null;
  let retainLock = false, staleProposal = false;
  saving = true;
  ++inspectorEpoch;
  el('save-state').textContent = 'Saving…';
  try {
    confirmed = (await commit(bound)).id;
    redoRevision = restore ? basis.revision.id : null;
    view = await loadView();
    conflict = null;
    el('conflict').replaceChildren();
    message(`Saved R${view.revision.id}: ${label}`);
    render();
  } catch (error) {
    if (confirmed !== null || !(error instanceof ApiError && error.status >= 400 && error.status < 500)) {
      retainLock = true;
      pendingWrite = {command: bound, source, unlock, before: basis.revision.id, restore};
      el('save-state').textContent = confirmed === null ? 'Save outcome unknown' : `Committed R${confirmed}; refresh pending`;
      message('Resolve the same bound command before editing or reviewing. ' + String(error), true);
      offerSaveRetry();
      return;
    }
    el('save-state').textContent = 'Unsaved · save failed';
    message(String(error), true);
    if (error.status !== 409) return;
    if (source?.id === 'coanalysis-form' || source?.id === 'training-review') {
      // The original model saw the earlier reading. Reapplying to a new head would misstate its evidence.
      staleProposal = true;
      return;
    }
    if (operations.some(op => op.kind === 'retokenize' || op.kind === 'reconcile_package')) {
      message('Saved head changed. Your package or structural draft remains here. Discard and reload saved state, then obtain a new preview.', true);
      return;
    }
    const latest = await loadView();
    conflict = {operations, label, latest, source, sourceValues};
    el('conflict').innerHTML = `<p>Your draft used R${view.revision.id}. Current saved state is R${latest.revision.id}: ${esc(latest.revision.label)}. Your intended changes remain in this tab.</p><button id="show-conflict-diff" class="secondary">Compare saved revisions</button><button id="reapply-conflict">Reapply my change to R${latest.revision.id}</button><pre id="conflict-diff"></pre>`;
    el('show-conflict-diff').onclick = async () => {
      el('conflict-diff').textContent = JSON.stringify(await api(`/api/diff?from=${view.revision.id}&to=${latest.revision.id}`), null, 2);
    };
    el('reapply-conflict').onclick = () => {
      const intended = conflict!;
      if (intended.source && JSON.stringify(formValues(intended.source)) !== intended.sourceValues) {
        message('Conflict action is out of date. Save the current draft to compare against the latest revision.', true);
        el<HTMLButtonElement>('reapply-conflict').disabled = true;
        return;
      }
      void save(intended.operations, `Reapply: ${intended.label}`, intended.source, intended.latest);
    };
  } finally {
    saving = false;
    if (!retainLock) unlock();
    if (staleProposal && source) markSourceStale(source);
  }
}
async function renderInspector(committedRender=false){updatePaneAccessibility();refreshListenControls();overview?.update();if((saving&&!committedRender)||pendingWrite||transcript.busy())return;const epoch=++inspectorEpoch;if(annotationRevision!==view.revision.id){tokenDrafts.clear();annotationDrafts.clear();structuralDrafts.clear();returnDrafts.clear();annotationRevision=view.revision.id;}document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-pressed',String(b.dataset.tab===tab))});const content=el('inspector-content');const doc=currentDoc();
  const toolLabel=inspectorViews.find(v=>v.id===tab)?.label??'Source file';
  el('current-inspector').textContent=toolLabel;
  content.setAttribute('aria-label',toolLabel);
  content.replaceChildren();
  if(tab==='token'){const token=doc.tokens.find(t=>t.id===selected[0]);if(token){const key=JSON.stringify([doc.path,token.id]);let panel=tokenDrafts.get(key);if(!panel){panel=tokenInspector(view,doc,token,save,draftStatus);tokenDrafts.set(key,panel)}content.append(panel)}else content.append(emptyTokenInspector());}
  training.stopAudio();
  if(tab==='training'||training.dirty)training.update(view,doc,selected);
  if(tab==='training')content.append(training.node);
  if(tab==='source'){try{const panel=await sourceInspector(view,sourcePath);if(epoch!==inspectorEpoch)return;content.append(panel)}catch(error){if(epoch!==inspectorEpoch)return;message(String(error),true)}}
  if (coanalysisDraft && coanalysisDraft.revision !== view.revision.id) {
    const prior = coanalysisDraft;
    const committed = view.documents.find(document => document.path === prior.document)?.spans.some(span => span.id === prior.panel.dataset.spanId);
    if (committed) coanalysisDraft = null;
  }
  if (tab === 'coanalysis') {
    const key = JSON.stringify([view.snapshot.project, view.revision.id, view.revision.snapshot_hash, doc.path, selected]);
    if (!coanalysisDraft || (coanalysisDraft.key !== key && !coanalysisDraft.panel.querySelector('form[data-dirty="true"]'))) {
      coanalysisDraft = {key, revision: view.revision.id, document: doc.path, panel: coanalysisInspector(view, doc, selected, {
        read: () => el('rail-reading').click(),
        reveal: async ids => {
          const navigationEpoch = inspectorEpoch;
          if (saving || pendingWrite || transcript.dirty() || transcript.busy()) return 'Finish the current edit before opening the passage.';
          if (doc !== currentDoc()) return 'Reopen co-analysis on the current document to see this passage.';
          const tokens = doc.tokens.filter(token => ids.includes(token.id));
          const switchLayer = tokens.some(token => reading(token,readingPreferences.layer) !== (token.corrected ?? token.original));
          const clearFilter = tokens.some(token => !visibleToken(token,readingPreferences));
          if (switchLayer || clearFilter) {
            if (switchLayer) {
              readingPreferences.layer = 'corrected';
              el<HTMLSelectElement>('reading-layer').value = 'corrected';
            }
            if (clearFilter) {
              findOrigin = null;
              readingPreferences.query = ''; readingPreferences.filter = 'all';
              el<HTMLInputElement>('token-query').value = ''; el<HTMLSelectElement>('token-filter').value = 'all';
            }
            refreshFindControls();
            await transcript.render();
            if (doc !== currentDoc() || navigationEpoch !== inspectorEpoch) return 'The open passage changed.';
          }
          showTranscript();
          if (!transcript.revealPassage(ids)) message('The passage is unavailable in this view.',true);
          return '';
        },
        dirty: draftStatus, save, listening:{check:checkCue,play:listen}, discard: async stale => {
          if (saving || pendingWrite) return;
          if (stale) {
            const expected = coanalysisDraft;
            const latest = await loadView();
            if (expected !== coanalysisDraft || saving || pendingWrite) return;
            const otherDraft = transcript.dirty() || draftPanels().some(panel => panel !== expected?.panel && panel.querySelector('form[data-dirty="true"]'));
            if (otherDraft) {
              coanalysisDraft = null;
              await renderInspector();
              draftStatus();
              message('Co-analysis draft discarded. Finish your other authoring drafts before reloading the changed revision.');
              return;
            }
            view = latest;
          }
          coanalysisDraft = null;
          render();
        },
      })};
    }
    content.append(coanalysisDraft.panel);
  }
  if(tab!=='search')searchPanel?.pause();
  if(tab==='search'){
    searchPanel?.pause();
    if(!searchPanel)searchPanel=corpusSearch(view,(binding,hit,reading)=>{
      if(binding.revision!==view.revision.id||binding.snapshot_hash!==view.revision.snapshot_hash){message('Search result is stale against this authoring view. Search again.',true);return;}
      if(transcript.dirty()){message('Finish or undo the in-place correction draft before opening a search result.',true);return;}docPath=hit.document;selected=hit.token_ids;readingPreferences.query='';readingPreferences.filter='all';readingPreferences.layer=reading;el<HTMLInputElement>('token-query').value='';el<HTMLSelectElement>('token-filter').value='all';el<HTMLSelectElement>('reading-layer').value=reading;tab='token';render();
      document.querySelector<HTMLButtonElement>(`[data-token="${CSS.escape(selected[0])}"]`)?.scrollIntoView({block:'nearest'});
    },async()=>{
      const expectedEpoch=inspectorEpoch;
      const dirty=()=>draftPanels().some(panel=>panel.querySelector('form[data-dirty="true"]'));
      if(saving||pendingWrite||transcript.dirty()||dirty())throw new Error('Save or discard authoring drafts before reloading saved search evidence.');
      const latest=await loadView();
      if(saving||pendingWrite||transcript.dirty()||dirty()||expectedEpoch!==inspectorEpoch||tab!=='search')throw new Error('Reload is out of date; authoring state was preserved.');
      view=latest;render();return view;
    });
    searchPanel.update(view);content.append(searchPanel.element);
  }
  if(tab==='annotations'){
    const key=JSON.stringify([doc.path,selected]);let draft=annotationDrafts.get(key);
    if(!draft){draft=annotationInspector(view,doc,selected,save,()=>{el<HTMLButtonElement>('discard-annotation-drafts').disabled=false;el('save-state').textContent='Unsaved annotation draft - saved head R'+view.revision.id});annotationDrafts.set(key,draft)}
    const discard=document.createElement('button');discard.id='discard-annotation-drafts';discard.className='secondary';discard.textContent='Discard annotation drafts';discard.disabled=![...annotationDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]')!==null);
    discard.onclick=()=>{annotationDrafts.clear();el('save-state').textContent=`Saved R${view.revision.id} - ${view.approved?'Approved exact revision':'Unreviewed'}`;void renderInspector()};content.append(discard,draft);
  }
  if([...tokenDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]')))el('save-state').textContent='Unsaved token draft - saved head R'+view.revision.id;
  if([...annotationDrafts.values(),...structuralDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]')!==null))el('save-state').textContent=( [...structuralDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]'))?'Unsaved structural draft - saved head R':'Unsaved annotation draft - saved head R')+view.revision.id;
  if(tab==='history'){try{const panel=await historyInspector(view,save);if(epoch!==inspectorEpoch)return;content.append(panel);if(redoRevision!==null){const button=document.createElement('button');button.textContent=`Redo state R${redoRevision}`;button.onclick=()=>void save([{kind:'restore',revision:redoRevision!}],`Redo R${redoRevision}`);content.prepend(button)}}catch(error){if(epoch!==inspectorEpoch)return;message(String(error),true)}}
  if(tab==='definitions'){content.innerHTML=`<h2>Language definitions</h2><p class="muted">Project labels need no external code. These definitions are versioned with the evidence.</p><form id="definition-form">${field('value','Value')}${field('description','Description')}<button>Save definition</button></form><ul>${Object.entries(view.snapshot.config.language_values).map(([v,d])=>`<li><strong>${esc(v)}</strong> — ${esc(d)}</li>`).join('')}</ul><label>Inherited project default<select id="language-default"><option value="">Unknown / no default</option>${Object.entries(view.snapshot.config.language_values).map(([v,d])=>`<option value="${esc(v)}" ${v===view.snapshot.config.language_default?'selected':''}>${esc(d||v)}</option>`).join('')}</select></label><button id="save-default" class="secondary">Save default</button><details><summary>Layer constraints and schema</summary><pre>${esc(JSON.stringify(view.snapshot.config.layers,null,2))}</pre></details>`;el<HTMLFormElement>('definition-form').onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await save([{kind:'define_language',value:v.value,description:v.description}],`Define language: ${v.value}`)};el('save-default').onclick=()=>void save([{kind:'set_language_default',value:el<HTMLSelectElement>('language-default').value||null}],'Set project language default');try{const panel=await teitokReaderInspector(view,save);if(epoch!==inspectorEpoch)return;content.append(panel)}catch(error){if(epoch!==inspectorEpoch)return;message(String(error),true)}}
  if(tab==='review'){content.append(reviewInspector(view));el<HTMLFormElement>('review-form').onsubmit=async e=>{e.preventDefault();if(saving||pendingWrite)return;if(transcript.dirty()||draftPanels().some(panel=>panel.querySelector('form[data-dirty="true"]'))){message('Save or discard annotation drafts and structural drafts before recording review. Token drafts must also be saved or reset.',true);return;}const basis=view;const v=formValues(e.currentTarget as HTMLFormElement);saving=true;++inspectorEpoch;const unlock=lockAuthoring();try{await api('/api/review',{revision:basis.revision.id,snapshot_hash:basis.revision.snapshot_hash,decision:v.decision,note:v.note});view=await loadView();message(`Review recorded for R${basis.revision.id}.`);render()}catch(e){message(String(e),true)}finally{saving=false;unlock()}};el('compiler-contract').onclick=async()=>{try{el('contract-preview').textContent=JSON.stringify(await api('/api/contract'),null,2)}catch(e){message(String(e),true)}};}
  if(tab==='research')content.append(researchInspector(view,{dirty:()=>{const state=departure();return state.dirty||state.saving||transcript.busy()},perform:performResearch,go:(next,source)=>{tab=next;if(next==='source')sourcePath=source??doc.path;showProperties();void renderInspector()}}));
  if(tab==='structure'){
    const key=JSON.stringify([doc.path,selected]);let draft=structuralDrafts.get(key);
    if(!draft){try{const basis=view;draft=await retokenizationInspector(basis,doc,selected,save,()=>{el('save-state').textContent='Unsaved structural draft - saved head R'+view.revision.id});if(epoch!==inspectorEpoch)return;structuralDrafts.set(key,draft);}catch(e){if(epoch===inspectorEpoch)message(String(e),true);return;}}
    const discard=document.createElement('button');discard.id='discard-structural-drafts';discard.className='secondary';discard.textContent='Discard structural drafts';discard.onclick=async()=>{if([...tokenDrafts.values(),...annotationDrafts.values(),...returnDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]'))){message('Save or discard annotation drafts before reloading.',true);return;}if(transcript.dirty()){message('Finish or undo the in-place correction draft before reloading.',true);return;}structuralDrafts.clear();view=await loadView();render();};content.append(draft,discard);
  }
  if(tab==='return'){
    let panel=returnDrafts.get(view.revision.id);if(!panel){panel=reconciliationInspector(view,save,()=>{el('save-state').textContent='Unsaved returned package proposal - saved head R'+view.revision.id});returnDrafts.set(view.revision.id,panel)}
    const discard=document.createElement('button');discard.id='discard-return';discard.className='secondary';discard.textContent='Discard proposal and reload saved state';discard.onclick=async()=>{if([...tokenDrafts.values(),...annotationDrafts.values(),...structuralDrafts.values()].some(e=>e.querySelector('form[data-dirty="true"]'))){message('Save or discard other drafts before reloading.',true);return;}if(transcript.dirty()){message('Finish or undo the in-place correction draft before reloading.',true);return;}returnDrafts.forEach(panel=>panel.dispatchEvent(new Event('wb-discard')));returnDrafts.clear();view=await loadView();render();};content.append(discard,panel);
  }
  if(tab==='references'){try{const basis=view;const panel=await referenceInspector(basis,doc.path,selected);if(epoch!==inspectorEpoch)return;if(epoch===inspectorEpoch&&tab==='references'&&view.revision.id===basis.revision.id&&docPath===doc.path)content.append(panel)}catch(e){if(epoch!==inspectorEpoch)return;message(String(e),true)}}
  if(tab==='xml'){content.innerHTML='<h2>Preserved XML · read-only</h2><pre id="xml-preview">Loading…</pre>';try{const r=await api<{xml:string}>(`/api/xml?path=${encodeURIComponent(doc.path)}&revision=${view.revision.id}`);if(epoch===inspectorEpoch)el('xml-preview').textContent=r.xml}catch(e){if(epoch===inspectorEpoch)message(String(e),true)}}
}
async function resolvePendingWrite() {
  const pending = pendingWrite;
  if (!pending || saving) return;
  saving = true;
  el<HTMLButtonElement>('resolve-pending-save').disabled = true;
  try {
    const committed = await commit(pending.command);
    const latest = await loadView();
    if (latest.revision.id < committed.id) throw new Error('Saved view has not reconciled the committed revision');
    pendingWrite = null;
    pending.unlock();
    el('save-recovery').replaceChildren();
    view = latest;
    redoRevision = pending.restore ? pending.before : null;
    conflict = null;
    el('conflict').replaceChildren();
    render();
    message(`Original command saved in R${committed.id}; current head R${latest.revision.id}.`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && (pending.source?.id === 'coanalysis-form' || pending.source?.id === 'training-review')) {
      pendingWrite = null;
      pending.unlock();
      el('save-recovery').replaceChildren();
      markSourceStale(pending.source);
      message('The original command was rejected against a changed revision.', true);
      return;
    }
    message('Save reconciliation is still pending. ' + String(error), true);
    offerSaveRetry();
  } finally { saving = false; }
}
function recordingCandidate(doc:Document):string|undefined {
  const candidates=[...new Set(doc.media.flatMap(reference=>[reference,`Audio/${reference}`,`Video/${reference}`])
    .filter(path=>view.snapshot.files[path]?.role==='source-media'))];
  return candidates.length===1 ? candidates[0] : undefined;
}
function configureMedia(unsupportedBase:boolean){
  const doc=currentDoc(),audio=el<HTMLAudioElement>('audio');
  const media=unsupportedBase ? undefined : recordingCandidate(doc);
  const scope=media ? doc.path+':'+view.snapshot.files[media].sha256 : '';
  cueMedia=media ? {document:doc.path,snapshot:view.revision.snapshot_hash,scope} : null;
  audio.hidden=!media;
  el('audio-availability').hidden=!!media;
  el<HTMLInputElement>('loop-selection').disabled=!media;
  if(media && (!audio.hasAttribute('src') || audio.dataset.mediaScope!==scope)){
    const src=`/api/media?path=${encodeURIComponent(media)}&revision=${view.revision.id}`;
    const time=documentStates.get(doc.path)?.time??0;
    audio.dataset.mediaScope=scope;
    audio.src=src;
    audio.addEventListener('loadedmetadata',()=>{
      if(audio.dataset.mediaScope===scope && audio.getAttribute('src')===src && time>0)
        audio.currentTime=Math.min(time,Number.isFinite(audio.duration)?audio.duration:time);
    },{once:true});
    audio.load();
  }else if(!media && audio.hasAttribute('src')){
    audio.removeAttribute('src');delete audio.dataset.mediaScope;audio.load();
  }
  playbackSync?.bind(media?doc:null,scope);
  refreshListenControls();
  void recording.update(view,doc,media);
}
function updatePaneAccessibility(){
  const workspace=document.querySelector<HTMLElement>('.workspace')!;
  recording?.fitToWorkspace();
  const narrow=matchMedia('(max-width:700px)').matches;
  const bothOpen=!workspace.classList.contains('navigation-folded') && !workspace.classList.contains('properties-folded');
  if(singleSidePane.matches && bothOpen){
    const parked=workspace.dataset.focus==='properties'?'navigation':'properties';
    const pane=el(parked==='navigation'?'projects-pane':'properties-pane');
    if(pane.contains(document.activeElement)) el('toggle-'+parked).focus({preventScroll:true});
    workspace.dataset.parked=parked;
  } else if(workspace.dataset.parked) delete workspace.dataset.parked;
  workspace.querySelector<HTMLElement>('.transcript')!.inert=narrow&&workspace.dataset.focus!=='transcript';
  for(const side of ['navigation','properties'])el('toggle-'+side).setAttribute('aria-expanded',String(narrow?workspace.dataset.focus===side:!workspace.classList.contains(side+'-folded') && workspace.dataset.parked!==side));
  const inspecting=el('toggle-properties').getAttribute('aria-expanded')==='true';
  const browsing=el('toggle-navigation').getAttribute('aria-expanded')==='true';
  el('window-library').setAttribute('aria-expanded',String(browsing));
  el('rail-reading').setAttribute('aria-pressed',String(!inspecting && !browsing));
  app.querySelectorAll<HTMLButtonElement>('.studio-rail [data-inspect]').forEach(button=>button.setAttribute('aria-pressed',String(inspecting && button.dataset.inspect===tab)));
  el('open-research').setAttribute('aria-pressed',String(inspecting && tab==='research'));

}
function showTranscript(){
  const workspace=document.querySelector<HTMLElement>('.workspace')!;
  if(!matchMedia('(max-width:700px)').matches||workspace.dataset.focus==='transcript')return;
  workspace.dataset.focus='transcript';
  updatePaneAccessibility();
  const heading=el('document-title');heading.tabIndex=-1;heading.focus({preventScroll:true});
}
function openInspectorActivity(target:InspectorView|'source'){
  tab=target;
  app.querySelector<HTMLDetailsElement>('.inspector-tools')!.open=false;
  showProperties();
  el('properties-pane').scrollTop=0;
  void renderInspector();
  el('inspector-content').focus({preventScroll:true});
}
function showProperties(){
  const fromCanvas=readingCanvas?.active;
  readingCanvas?.close(false);
  const workspace=document.querySelector<HTMLElement>('.workspace')!;
  workspace.classList.remove('properties-folded');workspace.dataset.focus='properties';updatePaneAccessibility();
  if(fromCanvas){const inspector=el('properties-pane');inspector.scrollTop=0;inspector.tabIndex=-1;inspector.focus({preventScroll:true})}
}
function switchDocument(path:string){if(saving||pendingWrite||transcript.activeDraft()||transcript.busy()){message('Finish or undo the correction draft before switching documents. Your selection and recording remain here.',true);return}const audio=el<HTMLAudioElement>('audio');documentStates.set(docPath,{selected:[...selected],time:audio.currentTime,scroll:document.querySelector('.transcript')!.scrollTop});audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;for(const id of ['listen-selected','loop-selection'])el<HTMLInputElement>(id).disabled=true;docPath=path;void recording.update(view,currentDoc(),undefined);const state=documentStates.get(path);selected=state?.selected??[];render();showTranscript();if(state)document.querySelector('.transcript')!.scrollTop=state.scroll}
function renderDocumentTabs(){if(!openDocuments.includes(docPath))openDocuments.push(docPath);const focused=(document.activeElement as HTMLElement)?.dataset.openDocument;el('document-tabs').innerHTML=openDocuments.map(path=>`<button role="tab" aria-selected="${path===docPath}" data-open-document="${esc(path)}">${esc(view.documents.find(d=>d.path===path)?.title??path)}</button>`).join('');el('document-tabs').querySelectorAll<HTMLButtonElement>('[data-open-document]').forEach(b=>{b.onclick=()=>switchDocument(b.dataset.openDocument!);if(b.dataset.openDocument===focused)b.focus()})}
async function followCitation(){const value=new URLSearchParams(location.hash.slice(1)).get('loc');if(!value)return;try{const citation=JSON.parse(value);if(citation.project!==view.snapshot.project||citation.revision!==view.revision.id){message(`Citation refers to ${citation.project} R${citation.revision}. Current saved head is R${view.revision.id}; inspect that exact revision in History before resolving it.`,true);return}if(!view.documents.some(d=>d.path===citation.document))throw new Error('Citation document is unavailable');switchDocument(citation.document);await transcript.render();if(citation.anchor&&!transcript.location(citation.anchor))message('Citation anchor is unavailable; no replacement location was guessed.',true)}catch(e){message('Could not resolve citation: '+String(e),true)}}
function desktopMenu(command:string){
  if(command==='backend-reconnected'){void resumeSession().catch(error=>message('Session reconnection failed: '+String(error),true));return}
  if(document.querySelector('dialog[open]'))return;
  if(!view||!document.querySelector('.workspace'))return;
  if(saving&&command!=='toggle-recording'){message('Wait for the current save or local handoff to finish. Recording controls remain available.');return}
  if(command==='save'){
    const correction=document.querySelector<HTMLButtonElement>('#retry-draft:not([hidden]),#accept-draft');
    if(correction&&!correction.disabled){correction.click();return}
    if(pendingWrite){void resolvePendingWrite();return}
    const focused=(document.activeElement as HTMLElement)?.closest('form');
    const form=focused??document.querySelector<HTMLFormElement>('#inspector-content form[data-dirty="true"],#inspector-content form[data-desktop-dirty="true"]');
    const submit=form?.querySelector<HTMLButtonElement>('button:not([type="button"]):not(:disabled),input[type="submit"]:not(:disabled)');
    if(form&&submit)form.requestSubmit(submit);else message('Choose a correction or a properties form to save. Every accepted edit creates a named revision.');
  }
  if(command==='search'||command==='history'||command==='research')openInspectorActivity(command);
  if(command==='export')el('export-package').click();
  if(command==='toggle-inspector'){if(readingCanvas?.active)showProperties();else el('toggle-properties').click()}
  if(command==='toggle-recording'){readingCanvas?.close(false);el('timeline-toggle').click()}
}
void initializeDesktop(app,start,departure,desktopMenu).catch(error=>{app.textContent='Could not load workbench: '+String(error)});
