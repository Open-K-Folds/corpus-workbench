import {h, renderInto} from './effect-view';
import {api,UnreadableUploadFile,uploadFile} from './api';
import type {Operation,ReturnPreview,ReturnRequest,View} from './contracts';
import {field,formValues} from './dom';

export function reconciliationInspector(view:View,onSave:(ops:Operation[],label:string,source?:HTMLFormElement,basis?:View)=>Promise<void>,onDirty:()=>void):HTMLElement {
  const panel=document.createElement('section');panel.className='return-panel';
  renderInto(panel,
    h.h2('Return an edited copy'),
    h.p(
      'Choose the folder you edited in TEITOK to compare it with the exported and currently saved versions.',
    ),
    h.form
    .id('return-form')
    .children(
      h.label(
        'Edited package folder',
        h.input.id('return-directory').attrs({type: 'file', webkitdirectory: '', multiple: ''}),
      ),
      h.details.class('package-requirements').children(
        h.summary('Folder requirements'),
        h.p('Choose the complete exported folder. The limit is 256 MiB per folder and 64 MiB per file.'),
        h.p('Keep the original text, timing, IDs, media and unsupported structures intact. The Workbench retains new TEITOK backups. Included CWB indexes require an adapter rebuild before compatibility export.'),
      ),
      field('revision_label', 'Revision name', 'Reconcile TEITOK copy'),
      h.button.id('preview-return').attrs({type: 'submit', disabled: ''}).children('Upload and preview'),
    ),
    h.p
    .id('return-status')
    .attrs({role: 'status'})
    .children('Saved basis R', String(view.revision.id), '. No files selected.'),
    h.div.id('return-result'),
    h.div.class('return-review-actions').children(
      h.button.id('refresh-return').class('secondary').attrs({type:'button', hidden:''}).children('Preview selected choices'),
      h.button.id('commit-return').attrs({type:'button', disabled:'', hidden:''}).children('Save reviewed changes'),
      h.button.id('discard-return').class('secondary').attrs({type:'button', hidden:''}).children('Discard proposal'),
    ),
    h.details.id('return-proof-details').attrs({hidden:''}).children(h.summary('Complete reconciliation proof'), h.pre.id('return-proof')),
  );
  const find=<T extends HTMLElement>(id:string)=>panel.querySelector<T>('#'+id)!;
  const form=find<HTMLFormElement>('return-form');const chooser=find<HTMLInputElement>('return-directory');const previewButton=find<HTMLButtonElement>('preview-return');const commitButton=find<HTMLButtonElement>('commit-return');const refresh=find<HTMLButtonElement>('refresh-return');const status=find('return-status');
  let epoch=0;let pending:ReturnPreview|null=null;let request:ReturnRequest|null=null;let busy=false;
  panel.addEventListener('wb-discard',()=>{++epoch;pending=null;request=null;});
  const proofDetails=find<HTMLDetailsElement>('return-proof-details');
  const dirty=()=>{form.dataset.dirty='true';find('discard-return').hidden=false;onDirty()};
  const invalidate=()=>{++epoch;pending=null;commitButton.disabled=true;dirty()};
  function clearPreview() {
    pending=null; request=null; commitButton.hidden=true; refresh.hidden=true;
    proofDetails.hidden=true; proofDetails.open=false;
    find('return-result').replaceChildren(); find('return-proof').textContent='';
  }
  chooser.onchange=()=>{
    invalidate(); clearPreview();
    const count=chooser.files?.length??0;
    previewButton.disabled=count===0;
    status.textContent=count ? `${count} ${count===1?'file':'files'} selected. Upload the folder to preview its changes.` : 'No folder selected.';
  };
  // Naming a revision does not change the proved candidate.
  form.querySelector<HTMLInputElement>('[name="revision_label"]')!.oninput=dirty;
  const render=(result:ReturnPreview)=>{
    const p=result.preview;find('return-proof').textContent=JSON.stringify(result,null,2);
    commitButton.hidden=false;proofDetails.hidden=false;
    renderInto(find('return-result'),
      h.div
      .class('revision-basis')
      .children(
        h.strong('Exported R', String(p.exported_base.id), ' → saved R', String(view.revision.id)),
        h.span(String(p.package_files), ' files · ', String(p.changes.length), ' changed fields'),
      ),
      p.blockers.length ? h.ul.class('return-blockers').children(p.blockers.map((b) => h.li(b))) : '',
      p.changes.map((c) =>
        h.article
          .class('return-change')
          .children(
            h.strong(c.token, ' · ', c.field),
            h.small(c.document),
            h.dl(
              h.dt('Exported'),
              h.dd(c.base ?? '(absent)'),
              h.dt('Saved'),
              h.dd(c.current ?? '(absent)'),
              h.dt('External'),
              h.dd(c.external ?? '(absent)'),
            ),
            c.state === 'conflict'
              ? h.label(
                  'Resolve this field',
                  h.select
                    .attrs({'data-return-choice': c.key})
                    .children(
                      h.option.attrs({value: ''}).children('Choose a value'),
                      h.option
                        .attrs({value: 'current', selected: c.choice === 'current' ? '' : undefined})
                        .children('Keep saved value'),
                      h.option
                        .attrs({value: 'external', selected: c.choice === 'external' ? '' : undefined})
                        .children('Use external value'),
                    ),
                )
              : h.p
                  .class('muted')
                  .children(c.state === 'already_current' ? 'Already saved' : 'Use external value'),
          ),
      ),
      h.p
      .class('muted')
      .children(
        String(p.retained_backups.length),
        ' TEITOK backups retained. ',
        String(p.issues.filter((i) => i.blocking).length),
        ' approval blockers after reconciliation.',
      ),
      p.issues.length
      ? h.details(
          h.summary('Validation after changes'),
          h.ul(p.issues.map((i) => h.li(i.target, ': ', i.message))),
        )
      : '',
    );
    panel.querySelectorAll<HTMLSelectElement>('[data-return-choice]').forEach(select=>select.onchange=()=>{invalidate();const key=select.dataset.returnChoice!;if(select.value)request!.resolutions[key]=select.value as 'current'|'external';else delete request!.resolutions[key];refresh.hidden=false;status.textContent='Choices changed; preview again before saving.';});
    refresh.hidden=!p.changes.some(c=>c.state==='conflict');commitButton.disabled=!p.ready;
    status.textContent=p.ready?'Reviewed candidate is ready to save as one new, unreviewed revision.':'Return is blocked. Resolve conflicts or correct the separate copy and select it again.';
  };
  const prove=async(turn:number)=>{const result=await api<ReturnPreview>('/api/return/preview',request);if(turn!==epoch)return;pending=result;render(result)};
  const lock=(value:boolean)=>{busy=value;chooser.disabled=value;previewButton.disabled=value||!chooser.files?.length;refresh.disabled=value;commitButton.disabled=value||!pending?.preview.ready;};
  form.onsubmit=async e=>{e.preventDefault();if(busy||!chooser.files?.length)return;const turn=++epoch;clearPreview();lock(true);dirty();let upload:string|null=null;
    try{const files=[...chooser.files].map(file=>{const relative=file.webkitRelativePath;const slash=relative.indexOf('/');if(slash<0)throw new Error('Choose one complete package folder.');return {file,path:relative.slice(slash+1)}});const started=await api<{upload:string}>('/api/return/start',{project:view.snapshot.project,revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,files:files.map(({file,path})=>({path,bytes:file.size}))});upload=started.upload;
      for(let i=0;i<files.length;i++){if(turn!==epoch)throw new Error('Proposal discarded.');status.textContent=`Uploading ${i+1}/${files.length}: ${files[i].path}`;await uploadFile(upload,files[i].path,files[i].file)}
      status.textContent='Checking the frozen package and exact revision.';const staged=await api<{stage:string}>('/api/return/finish',{upload});upload=null;if(turn!==epoch)return;request={schema:1,project:view.snapshot.project,revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,stage:staged.stage,resolutions:{}};await prove(turn);
    } catch(error) {
      if(turn===epoch) {
        if(error instanceof UnreadableUploadFile) chooser.value='';
        status.textContent=error instanceof Error ? error.message : String(error);
      }
    } finally {if(upload)await api('/api/return/cancel',{upload}).catch(()=>{});lock(false)}
  };
  refresh.onclick=async()=>{if(busy||!request)return;const turn=++epoch;pending=null;lock(true);try{await prove(turn)}catch(error){if(turn===epoch)status.textContent=String(error)}finally{lock(false)}};
  commitButton.onclick=async()=>{if(busy||!pending?.preview.ready||!request)return;const proof=pending;pending=null;commitButton.disabled=true;await onSave([{kind:'reconcile_package',request:proof.preview.request,preview_hash:proof.preview_hash}],formValues(form).revision_label||'Reconcile TEITOK copy',form,view);};
  return panel;
}
