import {esc} from './dom';
import {icon} from './icons';
import {initializeNativeDrafts,nativeDraftsReady} from './draft-storage';
import './desktop.css';

export interface DesktopState {
  status:'idle'|'loading'|'ready'|'error';
  project:null|{id:string;project:string;title:string};
  recent:{id:string;project:string;title:string;opened:number}[];
  error:string|null;version:string;
}
export interface Departure {dirty:boolean;recoverable:boolean;saving:boolean}
interface DesktopBridge {
  state():Promise<DesktopState>;
  chooseOpen():Promise<unknown>;
  importPackage():Promise<unknown>;
  createDemo():Promise<unknown>;
  openRecent(id:string):Promise<unknown>;
  exportRevision(revision:number):Promise<{cancelled?:boolean}>;
  backup():Promise<{cancelled?:boolean}>;
  retry():Promise<unknown>;
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

export function desktopScreen(host:HTMLElement,state:DesktopState){
  latest=state;
  document.documentElement.classList.add('desktop-app');
  try{document.documentElement.dataset.theme=localStorage.getItem('wb-theme')??(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')}catch{}
  desktop?.reportAppearance(document.documentElement.dataset.theme==='dark'?'dark':'light');
  const busy=state.status==='loading';
  host.innerHTML=`<main class="desktop-welcome"><div class="welcome-brand">${icon('description')}<span>OPEN-K-FOLDS</span></div><h1>Corpus workbench</h1><p class="welcome-intro">Listen closely. Read in context.<br>Keep every correction connected to its source.</p><div class="welcome-actions"><button id="desktop-import" ${busy?'disabled':''}>${icon('folder_open')}Import TEITOK package</button><button id="desktop-open" class="secondary" ${busy?'disabled':''}>Open existing workbench</button><button id="desktop-demo" class="secondary" ${busy?'disabled':''}>Try a synthetic corpus</button></div><p class="welcome-note">Import creates a working copy. Your source folder stays intact.</p><div id="desktop-status" role="status" class="${state.status==='error'?'notice error':'desktop-status'}">${busy?'Opening your corpus…':esc(state.error??'')}</div>${state.status==='error'?'<button id="desktop-retry" class="secondary">Try again</button>':''}${state.recent.length?`<section class="welcome-recent"><h2>Recent projects</h2>${recentButtons(state)}</section>`:''}<footer>Local evidence · Revision history · Complete package exports<span>${esc(state.version)}</span></footer></main>`;
  bindActions(host);
}
function recentButtons(state:DesktopState){return state.recent.map(p=>`<button class="desktop-recent secondary" data-desktop-project="${esc(p.id)}" ${state.status==='loading'?'disabled':''}><strong>${esc(p.title)}</strong><span>${esc(p.project)}</span>${icon('skip_next')}</button>`).join('')}
function bindActions(host:HTMLElement){
  const action=(selector:string,run:()=>Promise<unknown>)=>{const button=host.querySelector<HTMLButtonElement>(selector);if(button)button.onclick=()=>void run().catch(error=>{const status=document.getElementById('desktop-status')??document.getElementById('message');if(status){status.textContent=String(error);status.className='notice error'}})};
  action('#desktop-open',()=>desktop!.chooseOpen());action('#desktop-import',()=>desktop!.importPackage());action('#desktop-demo',()=>desktop!.createDemo());action('#desktop-retry',()=>desktop!.retry());
  host.querySelectorAll<HTMLButtonElement>('[data-desktop-project]').forEach(b=>b.onclick=()=>void desktop!.openRecent(b.dataset.desktopProject!).catch(error=>{const status=document.getElementById('message')??document.getElementById('desktop-status');if(status)status.textContent=String(error)}));
}
export function desktopNavigation(host:HTMLElement){
  if(!desktop||!latest)return;
  document.documentElement.classList.add('desktop-app');
  const region=document.createElement('section');region.className='desktop-project-switcher';region.setAttribute('aria-label','Local projects');
  region.innerHTML=`<details><summary>${icon('folder_open')}<span>${esc(latest.project?.title??'Local projects')}</span>${icon('expand_more')}</summary><div class="desktop-project-actions"><button id="desktop-import" class="secondary">Import package</button><button id="desktop-open" class="secondary">Open workbench</button><button id="desktop-backup" class="secondary">Save authority backup</button></div>${recentButtons(latest)}</details>`;
  host.prepend(region);bindActions(region);
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
      for(const region of host.querySelectorAll<HTMLElement>('header,.workspace,#recording-pane'))region.inert=state.status==='loading';
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
  desktop.onMenu(command=>{if(command==='draft-status')desktop.reportDraft(departure());else menu(command)});
  const report=()=>desktop.reportDraft(departure());
  document.addEventListener('input',report);document.addEventListener('change',report);document.addEventListener('click',()=>queueMicrotask(report));
  setInterval(report,250);
  await render(await desktop.state());
}
