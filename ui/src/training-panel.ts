import {preparePassage} from '../../desktop/coanalysis-prompt.mjs';
import {draftContext} from './api';
import type {Document,Operation,View} from './contracts';
import {desktop} from './desktop';
import {esc} from './dom';
import {icon} from './icons';
import {findCandidates,lensDescriptions,makePassage,type Passage,type TrainingLens} from './training-candidates';
import {exportTraining,trainingCollections,trainingCounts,trainingOperation,type TrainingAssistance,type TrainingRecord} from './training-store';
import {sourceCard} from './training-source';
import './training.css';

type Mode = TrainingLens|'label';
const modes:Record<Mode,string> = {label:'Label a passage',meaning:'Same meaning',wording:'Similar wording',contrast:'Easy to confuse'};
const decisions = ['Same meaning','Partial overlap','Different','Needs context'];
interface Actions {
  dirty:()=>void;
  read:()=>void;
  save:(operations:Operation[],label:string,form:HTMLFormElement,view:View)=>Promise<void>;
  reset:(stale:boolean)=>Promise<void>;
}
export class TrainingPanel {
  readonly node = document.createElement('section');
  private view!:View;
  private seed:Passage|null = null;
  private mode:Mode = 'label';
  private limit = 3;
  private collection = '';
  private library = false;
  private libraryName = '';
  private collections = new Map<string,TrainingRecord[]>();
  private selection = '';
  private pendingId = '';
  private stale = false;
  private query = '';
  private matchedWordsOnly = false;
  private candidates:Passage[] = [];
  private candidateIndex = 0;
  private assistance?:TrainingAssistance;
  constructor(private actions:Actions,private comparison:HTMLElement) {
    this.node.id='training-panel';
    this.node.className='training-panel';
  }
  get dirty() {return !!this.node.querySelector('form[data-dirty="true"]');}
  stopAudio() {this.node.querySelectorAll('.training-source').forEach(card=>card.dispatchEvent(new Event('training-stop')));}
  update(view:View,doc:Document,ids:string[],entry?:{mode:Mode;limit:number}) {
    const key=JSON.stringify([view.revision.snapshot_hash,doc.path,ids]);
    const changed=this.view!==view;
    if (changed) this.collections=trainingCollections(view);
    if (this.pendingId && [...this.collections.values()].some(rows=>rows.some(record=>record.id===this.pendingId))) {
      this.pendingId='';this.selection='';this.stale=false;this.assistance=undefined;
      const form=this.node.querySelector<HTMLFormElement>('#training-review');if(form)form.dataset.dirty='false';
    }
    if (this.dirty) {
      if(changed && this.view.revision.snapshot_hash!==view.revision.snapshot_hash)this.markStale();
      if(entry)this.status('Your current review is pinned. Save or discard it to collect another passage.');
      return;
    }
    if (!changed && key===this.selection && !entry)return;
    this.view=view;this.selection=key;
    this.seed=makePassage(view,doc,ids);
    if(entry){this.mode=entry.mode;this.limit=entry.mode==='label'?3:entry.limit;this.library=false;}
    this.query='';this.assistance=undefined;this.rerank();this.draw();
  }
  markStale() {
    this.stale=true;
    const save=this.node.querySelector<HTMLButtonElement>('[data-training-save]');
    if(save)save.disabled=true;
    this.status('The saved revision changed. Discard this review and reopen the passage on the current revision.');
  }
  clear() {
    this.stopAudio();this.selection='';this.stale=false;this.pendingId='';this.assistance=undefined;
    this.node.replaceChildren();
  }
  private status(text:string) {const out=this.node.querySelector('[data-status]');if(out)out.textContent=text;}
  private rerank() {
    this.candidateIndex=0;
    this.candidates=this.seed && this.mode!=='label'?findCandidates(this.view,this.seed,this.mode,{limit:this.limit,query:this.query,matchedWordsOnly:this.matchedWordsOnly}):[];
  }
  private draw() {
    this.stopAudio();
    this.node.dataset.mode=this.mode;this.node.dataset.limit=String(this.mode==='label'?1:this.limit);
    this.node.innerHTML=`<div class="training-heading"><h2>${icon('library_books')}Training collections</h2>
      <nav aria-label="Training workspace"><button type="button" data-page="collect" aria-pressed="${!this.library}">Collect</button>
      <button type="button" data-page="saved" aria-pressed="${this.library}">Saved collections</button></nav></div><div data-body></div><p data-status role="status"></p>`;
    this.comparison.replaceChildren();
    this.node.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>{
      if(this.dirty){this.status('Save or discard this review before opening saved collections.');return;}
      this.library=b.dataset.page==='saved';this.draw();
      this.node.querySelector<HTMLButtonElement>('[data-page][aria-pressed="true"]')?.focus();
    });
    const body=this.node.querySelector<HTMLElement>('[data-body]')!;
    if(this.library){this.drawLibrary(body);return;}
    if(!this.seed){
      body.innerHTML='<p class="training-empty">Select words within one transcript passage to label them or compare them with another passage.</p><button type="button" class="secondary">Choose words in transcript</button>';
      body.querySelector('button')!.onclick=this.actions.read;
      return;
    }
    const seed=sourceCard(this.seed,'Selected passage',this.view);seed.dataset.trainingSeed='';body.append(seed);
    const controls=document.createElement('fieldset');controls.className='training-modes';
    controls.innerHTML='<legend>Collect an example</legend>'+Object.entries(modes).map(([id,label])=>
      `<label><input type="radio" name="training-mode" value="${id}" ${this.mode===id?'checked':''}>${label}</label>`).join('');
    body.append(controls);
    controls.onchange=e=>{
      this.mode=(e.target as HTMLInputElement).value as Mode;this.query='';this.assistance=undefined;this.rerank();this.draw();
      this.node.querySelector<HTMLInputElement>('[name="training-mode"]:checked')?.focus();
    };
    const candidate=this.candidates[this.candidateIndex]??null;
    if(this.mode!=='label'){
      this.drawDiscovery(body,candidate);
      if(!candidate)return;
      this.drawComparison(candidate);
    }
    this.drawReview(body,candidate);
  }
  private drawComparison(candidate:Passage) {
    this.comparison.innerHTML=`<div class="training-comparison-inner"><div class="training-strip-meta"><strong>${icon('link')} Comparison ${this.candidateIndex+1} of ${this.candidates.length}</strong>
      <span>${esc(candidate.title)} · ${esc(candidate.utterance??'Unsegmented passage')}</span></div>
      <blockquote>${esc(candidate.quote)}</blockquote>
      <div class="training-strip-actions"><button type="button" class="secondary" aria-label="Previous comparison" data-move="-1">${icon('arrow_back')}</button>
      <button type="button" class="secondary" aria-label="Next comparison" data-move="1">${icon('arrow_forward')}</button>
      <button type="button" data-review>Review example</button></div></div>`;
    this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button=>{
      const next=this.candidateIndex+Number(button.dataset.move);
      button.disabled=next<0||next>=this.candidates.length;
      button.onclick=()=>{if(this.dirty)return;this.candidateIndex=next;this.assistance=undefined;this.draw();
        const buttons=[...this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]:not(:disabled)')];
        (buttons.find(b=>b.dataset.move===button.dataset.move)??buttons[0])?.focus({preventScroll:true});};
    });
    this.comparison.querySelector<HTMLButtonElement>('[data-review]')!.onclick=()=>{
      const field=this.node.querySelector<HTMLInputElement>('[name="label"]');field?.focus();field?.scrollIntoView({block:'nearest'});
    };
  }
  private drawDiscovery(body:HTMLElement,candidate:Passage|null) {
    const section=document.createElement('section');section.className='training-discovery';
    section.innerHTML=`<h3>Find a comparison</h3><p class="muted">${esc(lensDescriptions[this.mode as TrainingLens])}</p>
      <search><form aria-label="Find a comparison" data-dirty="false"><label>Find words in the corpus<input type="search" name="query" value="${esc(this.query)}" autocomplete="off"></label>
      <label>Search result span<select name="manual-scope"><option value="passage">Surrounding passage</option><option value="matched" ${this.matchedWordsOnly?'selected':''}>Matched words only</option></select></label>
      <label>Candidate limit<select name="limit">${[3,6,12].map(n=>`<option ${n===this.limit?'selected':''}>${n}</option>`).join('')}</select></label><button type="submit" class="secondary">${icon('search')}Find passages</button></form></search>`;
    body.append(section);
    section.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const data=new FormData(e.currentTarget as HTMLFormElement);
      this.query=String(data.get('query')??'').trim();this.limit=Number(data.get('limit'));
      this.matchedWordsOnly=data.get('manual-scope')==='matched';this.assistance=undefined;this.rerank();this.draw();
      this.node.querySelector<HTMLSelectElement>('[name="candidate"]')?.focus();
    };
    if(!candidate){section.insertAdjacentHTML('beforeend','<p class="training-empty">No other passage matched. Change the search words or clear the search.</p>');return;}
    const label=document.createElement('label');label.textContent='Comparison passage';
    const select=document.createElement('select');select.name='candidate';
    for(const [index,p] of this.candidates.entries()){
      const ids = p.tokenIds;
      const location = this.query && this.matchedWordsOnly ? ' · ' + (ids.length===1 ? ids[0] : ids[0]+'–'+ids.at(-1)) : '';
      const option=new Option(`${index+1}. ${p.quote} · ${p.title}${location}`,String(index));select.add(option);
    }
    select.value=String(this.candidateIndex);
    select.onchange=()=>{this.candidateIndex=Number(select.value);this.assistance=undefined;this.draw();this.node.querySelector<HTMLSelectElement>('[name="candidate"]')?.focus();};
    label.append(select);section.append(label,sourceCard(candidate,'Comparison passage',this.view));
  }
  private drawReview(body:HTMLElement,candidate:Passage|null) {
    const form=document.createElement('form');form.id='training-review';form.dataset.dirty='false';
    form.setAttribute('aria-labelledby','training-review-heading');
    const pair=this.mode!=='label';
    const savedLabels=[...this.collections.values()].flat().filter(record=>record.kind===(pair?'pair':'classification')).map(record=>record.label);
    const labels=new Set([...(pair?decisions:['Question','Request','Reported experience','Code-switch','Transcription uncertain']),...savedLabels]);
    form.innerHTML=`<h3 id="training-review-heading">Your review</h3>
      <label>Collection name<input name="collection" required maxlength="120" list="training-names" value="${esc(this.collection)}" placeholder="e.g. Community notices"></label>
      <datalist id="training-names">${[...this.collections.keys()].map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label>${pair?'Relationship':'Passage label'}<input name="label" required maxlength="160" list="training-labels" placeholder="${pair?'Choose or enter a relationship':'e.g. Request for clarification'}"></label>
      <datalist id="training-labels">${[...labels].map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
      <label>Review note (optional)<textarea name="note" rows="2"></textarea></label>
      <div data-assistant></div><div class="training-actions"><button type="submit" data-training-save>${icon('check')}Save reviewed example</button>
      <button type="button" class="secondary" data-discard hidden>Discard review</button></div>`;
    body.append(form);
    const mark=()=>{
      form.dataset.dirty='true';form.querySelector<HTMLElement>('[data-discard]')!.hidden=false;
      this.node.querySelector<HTMLFieldSetElement>('.training-modes')!.disabled=true;
      this.node.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('.training-discovery search :is(button,input,select),[name="candidate"]').forEach(el=>el.disabled=true);
      this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(el=>el.disabled=true);
      this.actions.dirty();
    };
    form.oninput=mark;
    form.querySelector<HTMLButtonElement>('[data-discard]')!.onclick=()=>void this.actions.reset(this.stale);
    this.drawModel(form.querySelector('[data-assistant]')!,candidate,mark);
    form.onsubmit=async event=>{
      event.preventDefault();
      if(this.stale)return;
      const fields=new FormData(form);
      try {
        if(!this.assistance && (fields.get('assistant-model') || fields.get('assistant-reply'))) {
          this.status('Attach the model reading or clear its fields before saving the review.');return;
        }
        const collection=String(fields.get('collection')).trim();
        const searchMethod=this.matchedWordsOnly?'manual text search · matched words only':'manual text search';
        const op=trainingOperation(this.view,{collection,lens:this.mode,seed:this.seed!,candidate,
          label:String(fields.get('label')).trim(),note:String(fields.get('note')??'').trim(),
          discovery:pair?(this.query?searchMethod:'local '+this.mode+' ranking'):'manual selection',assistance:this.assistance},draftContext()?.actor??'');
        this.collection=collection;this.libraryName=collection;this.pendingId=op.id;
        await this.actions.save([op],`Collect example in ${collection}`,form,this.view);
      } catch(error) {this.status(error instanceof Error?error.message:String(error));}
    };
  }
  private drawModel(host:HTMLElement,candidate:Passage|null,mark:()=>void) {
    const seed=this.seed!;
    const question=candidate?'Compare what each speaker asserts. Suggest a relationship and explain any uncertainty.':'Suggest a short research label for the speech act or topic and explain your evidence.';
    const request={project:seed.project,revision:seed.revision,snapshot_hash:seed.snapshotHash,document:seed.document,token_ids:seed.tokenIds,question,
      ...(candidate && {comparison:{document:candidate.document,token_ids:candidate.tokenIds}})};
    let prompt:string;
    try {prompt=preparePassage(this.view,request).prompt;}catch{return;}
    host.innerHTML=`<details class="training-assistant"><summary>${icon('auto_awesome')}Model second reading</summary>
      <details><summary>Inspect the model prompt</summary><pre>${esc(prompt)}</pre></details>
      ${desktop?.askLocalModel?'<button class="secondary" type="button" data-ask>Ask local model</button><small>Uses the model at 127.0.0.1:8080.</small>':'<small>You can copy the prompt into your local model.</small>'}
      <label>Model name<input name="assistant-model" autocomplete="off"></label>
      <label>Model proposal<textarea name="assistant-reply" rows="3"></textarea></label>
      <button type="button" class="secondary" data-attach>Attach model reading</button><p role="status" data-model-status></p></details>`;
    const model=host.querySelector<HTMLInputElement>('[name="assistant-model"]')!,reply=host.querySelector<HTMLTextAreaElement>('[name="assistant-reply"]')!;
    const feedback=host.querySelector('[data-model-status]')!;
    const attach=host.querySelector<HTMLButtonElement>('[data-attach]')!,ask=host.querySelector<HTMLButtonElement>('[data-ask]');
    const capture=()=>{if(!model.value.trim()||!reply.value.trim()){feedback.textContent='Enter the model name and its proposal.';return;}
      mark();this.assistance={model:model.value.trim(),reply:reply.value,prompt};model.readOnly=true;reply.readOnly=true;attach.disabled=true;if(ask)ask.disabled=true;
      feedback.textContent='Model reading attached. Enter your own label above.';};
    attach.onclick=capture;
    if(ask)ask.onclick=async()=>{
      mark();ask.disabled=true;attach.disabled=true;model.readOnly=true;reply.readOnly=true;feedback.textContent='Waiting for the local model…';
      const save=host.closest('form')!.querySelector<HTMLButtonElement>('[data-training-save]')!;save.disabled=true;
      try {const result=await desktop!.askLocalModel(request);if(!this.node.contains(host))return;model.value=result.model;reply.value=result.reply;capture();}
      catch(error){if(!this.node.contains(host))return;feedback.textContent=String(error);ask.disabled=false;attach.disabled=false;model.readOnly=false;reply.readOnly=false;}
      finally{if(this.node.contains(host))save.disabled=this.stale;}
    };
  }
  private drawLibrary(body:HTMLElement) {
    if(!this.collections.size){body.innerHTML='<p class="training-empty">Saved collections appear here after your first reviewed example.</p>';return;}
    if(!this.collections.has(this.libraryName))this.libraryName=this.collections.keys().next().value!;
    const rows=this.collections.get(this.libraryName)!;
    const counts=trainingCounts(rows);
    body.innerHTML=`<label>Saved collection<select name="saved-collection">${[...this.collections.keys()].map(n=>`<option ${n===this.libraryName?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
      <p class="training-counts">${counts.examples} reviewed · ${counts.utterances} identified utterance${counts.utterances===1?'':'s'} · ${counts.speakers} document-scoped speaker ID${counts.speakers===1?'':'s'}</p>
      ${counts.unknownSpeakers||counts.unknownUtterances?`<small>${counts.unknownSpeakers} without speaker attribution · ${counts.unknownUtterances} unsegmented passage${counts.unknownUtterances===1?'':'s'}</small>`:''}
      <button type="button" class="secondary" data-export>${icon('download')}Export reviewed JSONL</button>`;
    const select=body.querySelector('select')!;
    select.onchange=()=>{this.libraryName=select.value;this.draw();this.node.querySelector<HTMLSelectElement>('[name="saved-collection"]')?.focus();};
    body.querySelector<HTMLButtonElement>('[data-export]')!.onclick=()=>{
      try{exportTraining(this.view,this.libraryName);}catch(error){this.status(String(error));}
    };
    for(const record of rows)this.appendRecord(body,record);
  }
  private appendRecord(body:HTMLElement,record:TrainingRecord) {
    const row=document.createElement('details');row.className='training-record';
    row.innerHTML=`<summary><strong>${esc(record.label)}</strong><span>${esc(record.seed.quote)}</span></summary>`;
    body.append(row);
    row.ontoggle=()=>{
      if(!row.open){row.querySelectorAll('.training-source').forEach(n=>n.dispatchEvent(new Event('training-stop')));return;}
      if(row.childElementCount>1)return;
      row.append(sourceCard(record.seed,'Selected passage',this.view));
      if(record.candidate)row.append(sourceCard(record.candidate,'Comparison passage',this.view));
      const note=document.createElement('p');note.textContent=record.note;row.append(note);
      const provenance=document.createElement('small');provenance.textContent=`${record.reviewer} · ${record.discovery} · R${record.seed.revision}`;row.append(provenance);
      if(record.assistance){const model=document.createElement('details');model.innerHTML='<summary>Model second reading</summary><p></p><pre></pre>';
        model.querySelector('p')!.textContent=record.assistance.model+' · '+record.assistance.reply;
        model.querySelector('pre')!.textContent=record.assistance.prompt;row.append(model);}
    };
  }
}
