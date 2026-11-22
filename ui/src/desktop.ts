import {esc} from './dom';
import {icon} from './icons';
import {windowBar} from './studio-shell';
import {initializeNativeDrafts,nativeDraftsReady} from './draft-storage';
import './desktop.css';
import {openPreparation,type PreparationBridge} from './preparation';
import type {PassageRequest} from '../../desktop/coanalysis-prompt.mjs';

export interface DesktopState {
  status:'idle'|'loading'|'ready'|'error';
  project:null|{id:string;project:string;title:string};
  recent:{id:string;project:string;title:string;opened:number}[];
  error:string|null;version:string;
}
export interface Departure {dirty:boolean;recoverable:boolean;saving:boolean}
export interface SemanticaGeneration {
  generation_id:string;revision:number;snapshot_hash:string;recipe_hash?:string;
  node_count:number;edge_count:number;native_reopen?:boolean;
  mapping_version?:string;
}
export interface SemanticaState {
  status:string;configured:boolean;
  runtime?:{semantica_version?:string;compiler_commit?:string}|null;
  current?:SemanticaGeneration|null;
  lastAttempt?:{status:string;message?:string;revision?:number;reused?:boolean}|null;
  export?:{validated:boolean;filename?:string}|null;
}
interface DesktopBridge extends PreparationBridge {
  state():Promise<DesktopState>;
  chooseOpen():Promise<unknown>;
  importPackage():Promise<unknown>;
  createDemo():Promise<unknown>;
  openRecent(id:string):Promise<unknown>;
  exportRevision(revision:number):Promise<{cancelled?:boolean}>;
  backup():Promise<{cancelled?:boolean}>;
  retry():Promise<unknown>;
  askLocalModel(request:PassageRequest):Promise<{model:string;reply:string}>;
  semanticaState():Promise<SemanticaState>;
  configureSemantica():Promise<SemanticaState&{cancelled?:boolean}>;
  runSemantica(basis:{revision:number;snapshot_hash:string}):Promise<SemanticaState>;
  exportSemantica(basis:{generation_id:string}):Promise<SemanticaState&{cancelled?:boolean}>;
  revealSemantica():Promise<void>;
  reportDraft(state:Departure):void;
  reportAppearance(theme:'light'|'dark'|'system'):void;
  readDraftJournal():Promise<string|null>;
  persistDraftJournal(raw:string):Promise<void>;
  onState(listener:(state:DesktopState)=>void):()=>void;
  onMenu(listener:(command:string)=>void):()=>void;
}
declare global {interface Window {workbenchDesktop?:DesktopBridge}}
export const desktop=window.workbenchDesktop;
let latest:DesktopState|null=null;
export const desktopProjectKey=()=>latest?.project?.id;

export function desktopScreen(host:HTMLElement,state:DesktopState){
  latest=state;
  document.documentElement.classList.add('desktop-app');
  let theme = 'dark';
  try { if (localStorage.getItem('wb-theme') === 'light') theme = 'light'; } catch { /* Storage is optional. */ }
  document.documentElement.dataset.theme = theme;
  desktop?.reportAppearance(document.documentElement.dataset.theme==='dark'?'dark':'light');
  const busy=state.status==='loading';
  const disabled = busy ? 'disabled' : '';
  host.innerHTML = `${windowBar(false)}<main class="desktop-welcome">
    <div class="welcome-brand">${icon('description')}<span>Open K-Folds</span></div>
    <h1 class="welcome-heading">Open a project</h1>
    <p class="welcome-intro">Start from source materials or resume a saved workbench.</p>
    <div class="welcome-actions">
      <button id="desktop-prepare" ${disabled}>${icon('graphic_eq')}<span>Recording + transcript</span><small>Pair audio with UTF-8 text or Omnilingual JSON.</small></button>
      <button id="desktop-import" class="secondary" ${disabled}>${icon('folder_open')}<span>Import TEITOK package</span><small>Create a working copy of a complete corpus folder.</small></button>
      <button id="desktop-open" class="secondary" ${disabled}>${icon('history')}<span>Open existing workbench</span><small>Resume from a local authority folder.</small></button>
      <button id="desktop-demo" class="secondary" ${disabled}>${icon('notes')}<span>Start a new practice copy</span><small>Try the workflow with generated text and a tone.</small></button>
    </div>
    <div id="desktop-status" role="status" class="${state.status==='error'?'notice error':'desktop-status'}">${busy?'Opening your corpus…':esc(state.error??'')}</div>
    ${state.status==='error'?'<button id="desktop-retry" class="secondary">Try again</button>':''}
    ${state.recent.length?`<section class="welcome-recent"><h2>Recent projects</h2>${recentButtons(state)}</section>`:''}
    <footer><span>Version ${esc(state.version)}</span></footer>
  </main>`;
  bindActions(host);
}
function recentButtons(state:DesktopState){return state.recent.map(p=>`<button class="desktop-recent secondary" data-desktop-project="${esc(p.id)}" ${state.status==='loading'?'disabled':''}><strong>${esc(p.title)}</strong><span>${esc(p.project)}</span>${icon('skip_next')}</button>`).join('')}
function bindActions(host:HTMLElement){
  const action=(selector:string,run:()=>Promise<unknown>)=>{const button=host.querySelector<HTMLButtonElement>(selector);if(button)button.onclick=()=>void run().catch(error=>{const status=document.getElementById('desktop-status')??document.getElementById('message');if(status){status.textContent=String(error);status.className='notice error'}})};
  action('#desktop-open',()=>desktop!.chooseOpen());action('#desktop-import',()=>desktop!.importPackage());action('#desktop-demo',()=>desktop!.createDemo());action('#desktop-retry',()=>desktop!.retry());
  host.querySelector<HTMLButtonElement>('#desktop-prepare')?.addEventListener('click',()=>openPreparation(desktop!));
  host.querySelectorAll<HTMLButtonElement>('[data-desktop-project]').forEach(b=>b.onclick=()=>void desktop!.openRecent(b.dataset.desktopProject!).catch(error=>{const status=document.getElementById('message')??document.getElementById('desktop-status');if(status)status.textContent=String(error)}));
}
export function desktopNavigation(host:HTMLElement){
  if(!desktop||!latest)return;
  document.documentElement.classList.add('desktop-app');
  const region=document.createElement('section');region.className='desktop-project-switcher';region.setAttribute('aria-label','Local projects');
  region.innerHTML=`<details><summary>${icon('folder_open')}<span>${esc(latest.project?.title??'Local projects')}</span>${icon('expand_more')}</summary><div class="desktop-project-actions"><button id="desktop-import" class="secondary">Import package</button><button id="desktop-open" class="secondary">Open workbench</button><button id="desktop-backup" class="secondary">Save authority backup</button></div>${recentButtons(latest)}</details>`;
  host.prepend(region);bindActions(region);
  const prepare=document.createElement('button');prepare.id='desktop-prepare';prepare.className='secondary';prepare.textContent='Recording + transcript';prepare.onclick=()=>openPreparation(desktop!);region.querySelector('.desktop-project-actions')!.prepend(prepare);
  region.querySelector<HTMLButtonElement>('#desktop-backup')!.onclick=async()=>{const status=document.getElementById('message')!;try{status.className='notice';status.textContent='Preparing a verified authority backup…';const result=await desktop.backup();status.textContent=result?.cancelled?'Backup cancelled.':'Verified authority backup saved.'}catch(error){status.className='notice error';status.textContent=String(error)}};
}
export async function initializeDesktop(host:HTMLElement,start:()=>Promise<void>,departure:()=>Departure,menu:(command:string)=>void){
  if(!desktop){await start();return}
  let recoveryWarning=await initializeNativeDrafts();
  let booting=false;
  const render=async(state:DesktopState)=>{latest=state;if(state.status==='ready'){if(booting)return;booting=true;try{
    if(!nativeDraftsReady())recoveryWarning=await initializeNativeDrafts();
    if(!nativeDraftsReady()){
      desktopScreen(host,{...state,status:'error',error:recoveryWarning});
      const retry=host.querySelector<HTMLButtonElement>('#desktop-retry');if(retry){retry.textContent='Retry draft recovery';retry.onclick=()=>void render(state)}
      return;
    }
    await start();if(recoveryWarning){const notice=host.querySelector<HTMLElement>('#message');if(notice){notice.textContent=recoveryWarning;notice.className='notice error'}}
  }catch(error){desktopScreen(host,{...state,status:'error',error:String(error)})}finally{booting=false}}else{desktopScreen(host,state)}};
  desktop.onState(state=>{
    latest=state;
    if(host.querySelector('.workspace')){
      for(const region of host.querySelectorAll<HTMLElement>('header,.studio-rail,.workspace,#recording-pane'))region.inert=state.status==='loading';
      let status=host.querySelector<HTMLElement>('#desktop-backend-status');
      if(state.status==='ready'){
        status?.remove();
        if(state.error){const notice=document.createElement('div');notice.id='desktop-backend-status';notice.className='notice error';notice.setAttribute('role','alert');notice.textContent=state.error;host.querySelector('header')?.after(notice)}
        return;
      }
      if(!status){status=document.createElement('div');status.id='desktop-backend-status';status.setAttribute('role','alert');host.querySelector('header')?.after(status)}
      status.className=state.status==='error'?'notice error':'notice';
      status.textContent=state.status==='loading'?'Reconnecting to the local corpus. Your current work stays open.':state.error??'The local corpus process stopped. Your current work stays open.';
      if(state.status==='error'){const retry=document.createElement('button');retry.className='secondary';retry.textContent='Reconnect';retry.onclick=()=>void desktop.retry();status.append(' ',retry)}
    }else void render(state);
  });
  desktop.onMenu(command=>{if(command==='draft-status')desktop.reportDraft(departure());else if(command==='backend-reconnected')menu(command);else if(document.querySelector('dialog[open]'))return;else if(command==='prepare-recording'){if(!departure().saving)openPreparation(desktop)}else menu(command)});
  const report=()=>desktop.reportDraft(departure());
  document.addEventListener('input',report);document.addEventListener('change',report);document.addEventListener('click',()=>queueMicrotask(report));
  setInterval(report,250);
  await render(await desktop.state());
}
