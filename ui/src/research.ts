import {h, renderInto} from './effect-view';
import type {View} from './contracts';
import {desktop,desktopProjectKey,type SemanticaState} from './desktop';
import type {InspectorView} from './workspace';
import './research.css';

interface Actions {
  go:(tab:InspectorView|'source',source?:string)=>void;
  perform:(action:()=>Promise<unknown>)=>Promise<void>;
  dirty:()=>boolean;
}
export function researchInspector(view:View,actions:Actions):HTMLElement {
  const panel=document.createElement('section');panel.className='research-panel';
  const preference=`wb-research-guide:${desktopProjectKey()??view.snapshot.project}`;
  let guide=true;try{guide=localStorage.getItem(preference)!=='hidden'}catch{}
  const blockers=view.issues.filter(issue=>issue.blocking);
  renderInto(panel,
    h.div
    .class('research-heading')
    .children(h.h2('Research handoff'), h.span.class('research-local').children('Local only')),
    h.p('Turn the saved, reviewed corpus into traceable research evidence.'),
    h.div
    .class('research-basis')
    .children(
      h.strong('Exact saved basis · R', String(view.revision.id)),
      h.span(
        view.approved ? 'Approved full package' : 'Awaiting exact-revision approval',
        ' · ',
        String(blockers.length),
        ' blocking ',
        blockers.length === 1 ? 'issue' : 'issues',
      ),
      h.details(h.summary('Snapshot identity'), h.code(view.revision.snapshot_hash)),
    ),
    h.div
    .id('research-status')
    .attrs({role: 'status', 'data-state': 'loading'})
    .children('Checking local handoff state.'),
    h.div.id('research-runtime'),
    h.div.id('research-generation'),
    h.div
    .class('research-actions')
    .children(
      h.button.id('research-configure').class('secondary').children('Configure local runtime'),
      h.button.id('research-run').attrs({disabled: ''}).children('Run local Semantica'),
      h.button.id('research-refresh').class('secondary').children('Refresh handoff state'),
    ),
    h.div
    .class('research-export')
    .children(
      h.h3('Portable graph package'),
      h.p(
        'The versioned folder contains the graph, exact review contract, completion receipt and checksums. Export verifies that Semantica can reopen it. Preserve original media separately with ',
        h.strong('Export complete package'),
        '.',
      ),
      h.button
        .id('research-export')
        .class('secondary')
        .attrs({disabled: ''})
        .children('Export validated graph'),
      h.button
        .id('research-reveal')
        .class('secondary')
        .attrs({hidden: ''})
        .children('Show exported folder'),
      h.p.id('research-export-status').attrs({role: 'status'}),
    ),
    h.button
    .id('research-show-guide')
    .class('secondary')
    .attrs({hidden: guide ? '' : undefined})
    .children('Resume guide'),
    h.section
    .id('research-guide')
    .attrs({'aria-label': 'Corpus workflow', hidden: guide ? undefined : ''})
    .children(
      h.div
        .class('research-guide-heading')
        .children(
          h.h3('From source to research'),
          h.button.id('research-skip-guide').class('secondary').children('Skip guide'),
        ),
      h.ol
        .class('research-steps')
        .children(
          h.li(
            h.strong('Keep the source'),
            h.p(
              String(Object.keys(view.snapshot.files).length),
              ' preserved files. Recording + transcript import retains the raw output and media alongside its working projection. Complete TEITOK packages can also be imported.',
            ),
            h.button
              .class('secondary')
              .attrs({'data-research-go': 'source'})
              .children('Inspect preserved source'),
          ),
          h.li(
            h.strong('Listen and correct'),
            h.p(
              'Compare original and corrected readings. Record uncertain words, slang and code-switching in reviewer notes or span annotations; uncertainty is not a confidence score.',
            ),
            h.button
              .class('secondary')
              .attrs({'data-research-go': 'token'})
              .children('Correct selected token'),
            h.button
              .class('secondary')
              .attrs({'data-research-go': 'annotations'})
              .children('Annotate uncertainty'),
          ),
          h.li(
            h.strong('Review the saved revision'),
            h.p(
              'Save all drafts, inspect validation, then make an explicit full-package review decision. Notes do not automatically prevent approval.',
            ),
            h.button
              .class('secondary')
              .attrs({'data-research-go': 'review'})
              .children('Review R', String(view.revision.id)),
          ),
          h.li(
            h.strong('Run and verify locally'),
            h.p(
              'Semantica maps authored evidence with stable IDs and provenance. This path performs no ASR, model extraction or public transfer.',
            ),
          ),
        ),
    ),
  );
  const find=<T extends HTMLElement>(id:string)=>panel.querySelector<T>(`#${id}`)!;
  const status=find('research-status'),runtime=find('research-runtime'),generation=find('research-generation');
  const configure=find<HTMLButtonElement>('research-configure'),run=find<HTMLButtonElement>('research-run'),exportButton=find<HTMLButtonElement>('research-export'),refresh=find<HTMLButtonElement>('research-refresh');
  let currentId:string|null=null;let inFlight=false;let refreshEpoch=0;let operationError:string|null=null;let exportNotice:string|null=null;
  const persistGuide=(show:boolean)=>{guide=show;find('research-guide').hidden=!show;find('research-show-guide').hidden=show;try{localStorage.setItem(preference,show?'shown':'hidden')}catch{}};
  find('research-skip-guide').onclick=()=>persistGuide(false);find('research-show-guide').onclick=()=>persistGuide(true);
  panel.querySelectorAll<HTMLButtonElement>('[data-research-go]').forEach(button=>button.onclick=()=>actions.go(button.dataset.researchGo as InspectorView|'source',Object.keys(view.snapshot.files).find(path=>path.startsWith('Raw/'))??Object.keys(view.snapshot.files)[0]));
  const failed=(error:unknown)=>{operationError=String(error);status.dataset.state='failed';status.textContent=operationError;run.disabled=true;exportButton.disabled=true;};
  function show(state:SemanticaState){
    const current=state.current;const exact=!!current&&current.revision===view.revision.id&&current.snapshot_hash===view.revision.snapshot_hash&&view.approved&&blockers.length===0;
    const legacy=exact&&!!current!.mapping_version&&current!.mapping_version!=='corpus-evidence/2';
    currentId=exact?current!.generation_id:null;
    const busy=inFlight||['running','checking','verifying','exporting'].includes(state.status);
    status.dataset.state=operationError?'failed':state.status;
    status.textContent=busy?'Running locally and validating the exact evidence. Playback remains available.':state.lastAttempt?.status==='failed'?`Latest handoff failed. ${state.lastAttempt.message??'Check the local runtime and retry; saved evidence is intact.'}`:state.lastAttempt?.status==='interrupted'?'The previous attempt was interrupted. Retry safely; matching accepted evidence will be reused.':exact?`Validated graph for R${current!.revision}${state.lastAttempt?.reused?' · existing generation reused':''}.`:current?'This graph belongs to a different saved revision. Refresh and review the current evidence before running.':state.status==='stale'?'An earlier graph is out of date. Save, review and run the current revision; previous evidence remains in history.':!view.approved?'Review and approve this exact saved revision before running.':blockers.length?'Resolve blocking package validation before running.':!state.configured?'Choose the installed Python runtime and a compatible clean compiler checkout.':'Ready to run the approved evidence locally.';
    renderInto(runtime,
      state.runtime
      ? h.p
          .class('research-runtime')
          .children(
            'Semantica ',
            state.runtime.semantica_version ?? '0.6.8',
            ' · compiler ',
            h.code(state.runtime.compiler_commit?.slice(0, 12) ?? 'checked'),
          )
      : '',
    );
    if(operationError)status.textContent=operationError;
    else if(legacy&&!busy)status.textContent='This accepted graph uses the legacy mapping. Run local Semantica to create a V2 generation for portable export.';
    renderInto(generation,
      exact
      ? h.dl(
          h.dt('Generation'),
          h.dd(h.code(current!.generation_id)),
          h.dt('Graph'),
          h.dd(String(current!.node_count), ' nodes · ', String(current!.edge_count), ' edges'),
          h.dt('Runtime'),
          h.dd(
            current!.native_reopen
              ? 'Reopened by Semantica'
              : 'Accepted receipt · run locally to verify consumption',
          ),
          h.dt('Evidence'),
          h.dd('Authored mapping · no inferred linguistic certainty'),
        )
      : '',
    );
    if(exact)generation.dataset.generationId=current!.generation_id;else delete generation.dataset.generationId;
    configure.disabled=busy;run.disabled=busy||!state.configured||!view.approved||blockers.length>0;run.textContent=exact&&!legacy?'Run again / reuse generation':'Run local Semantica';exportButton.disabled=busy||!exact||legacy;
    find('research-export-status').textContent=exportNotice??(state.export?.validated?`Exported and reopened successfully${state.export.filename?`: ${state.export.filename}`:'.'}`:'');
    find('research-reveal').hidden=!state.export?.validated;
  }
  async function load(){const epoch=++refreshEpoch;if(!desktop){status.dataset.state='unavailable';status.textContent='Local Semantica execution requires the desktop workbench and a separately installed compatible runtime. Complete package export remains available.';configure.hidden=true;run.hidden=true;refresh.hidden=true;return;}try{const state=await desktop.semanticaState();if(epoch===refreshEpoch&&!inFlight)show(state)}catch(error){if(epoch===refreshEpoch)failed(error)}}
  async function perform(action:()=>Promise<unknown>){if(inFlight)return;if(actions.dirty()){status.dataset.state='blocked';status.textContent='Save or discard all authoring drafts before a research handoff. Your drafts and selection remain here.';return}operationError=null;exportNotice=null;inFlight=true;status.dataset.state='running';status.textContent='Running locally and verifying the result. Playback remains available.';run.disabled=true;configure.disabled=true;exportButton.disabled=true;refresh.disabled=true;try{await actions.perform(action)}catch(error){failed(error)}finally{inFlight=false;refresh.disabled=false;await load()}}
  configure.onclick=()=>void perform(async()=>{const result=await desktop!.configureSemantica();if(!result.cancelled)show(result)});
  run.onclick=()=>void perform(async()=>show(await desktop!.runSemantica({revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash})));
  exportButton.onclick=()=>void perform(async()=>{if(!currentId)throw new Error('Refresh a current validated generation before exporting.');const result=await desktop!.exportSemantica({generation_id:currentId});if(result.cancelled)exportNotice='Export cancelled. No new folder was created.';show(result)});
  refresh.onclick=()=>{operationError=null;void load()};find('research-reveal').onclick=()=>void desktop?.revealSemantica().catch(failed);
  void load();return panel;
}
