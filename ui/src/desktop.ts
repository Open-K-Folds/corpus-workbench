import {h, renderInto} from './effect-view';
import {icon} from './icons';
import {mountLauncher, type LauncherAction} from './desktop-launcher';
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

let launcher: ReturnType<typeof mountLauncher> | undefined;
let retryRecovery: (() => Promise<void>) | undefined;

async function launcherAction(action: LauncherAction) {
  switch (action._tag) {
    case 'Prepare': return openPreparation(desktop!);
    case 'Import': return desktop!.importPackage();
    case 'Open': return desktop!.chooseOpen();
    case 'Demo': return desktop!.createDemo();
    case 'OpenRecent': return desktop!.openRecent(action.id);
    case 'Retry': return retryRecovery ? retryRecovery() : desktop!.retry();
  }
}

function desktopScreen(host: HTMLElement, state: DesktopState, recovery?: () => Promise<void>) {
  latest = state;
  retryRecovery = recovery;
  const data = {...state, recovery: !!recovery};
  if (launcher && !launcher.signal.aborted) {
    launcher.update(data);
    return;
  }
  document.documentElement.classList.add('desktop-app');
  let theme: 'dark'|'light' = 'dark';
  try { if (localStorage.getItem('wb-theme') === 'light') theme = 'light'; } catch { /* Storage is optional. */ }
  document.documentElement.dataset.theme = theme;
  desktop?.reportAppearance(theme);
  launcher = mountLauncher(host, data, launcherAction);
}
function recentButtons(state:DesktopState,entries=state.recent){return entries.map((p) =>
  h.button
    .class('desktop-recent secondary')
    .attrs({'data-desktop-project': p.id, disabled: state.status === 'loading' ? '' : undefined})
    .children(h.strong(p.title), h.span(p.project), icon('chevron_right')),
)}
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
  renderInto(region,
    h.details(
      h.summary(icon('folder_open'), h.span(latest.project?.title ?? 'Local projects'), icon('expand_more')),
      h.div
        .class('desktop-project-actions')
        .children(
          h.button.id('desktop-import').class('secondary').children('Import package'),
          h.button.id('desktop-open').class('secondary').children('Open workbench'),
          h.button.id('desktop-backup').class('secondary').children('Save authority backup'),
        ),
      recentButtons(latest),
    ),
  );
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
      desktopScreen(host,{...state,status:'error',error:recoveryWarning}, () => render(state));
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
