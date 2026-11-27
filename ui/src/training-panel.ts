import {BrowserHost} from '@effect/ui/html';
import {runComponent} from './app-runtime';
import {TrainingWorkflow, TrainingMessage as Msg} from './training-workflow';
import {group, h, renderInto, viewFragment} from './effect-view';
import {preparePassage} from '../../desktop/coanalysis-prompt.mjs';
import {draftContext} from './api';
import type {Document,Operation,View} from './contracts';
import {desktop} from './desktop';
import {icon} from './icons';
import {findCandidates,lensDescriptions,makePassage,type Passage,type TrainingLens} from './training-candidates';
import {exportTraining,trainingCollections,trainingCounts,trainingOperation,type TrainingRecord} from './training-store';
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
  private collections = new Map<string,TrainingRecord[]>();
  private candidates: Passage[] = [];
  private readonly heading = document.createElement('div');
  private readonly workflow;
  private get state() { return this.workflow.model()!; }
  constructor(private actions: Actions, private comparison: HTMLElement, signal: AbortSignal) {
    this.workflow = runComponent(BrowserHost.mountEffect(TrainingWorkflow, {}, this.heading, {head: false, onEmit: event => {
      if (event._tag === 'Pinned') {
        this.status('Save or discard this review before opening saved collections.');
        return;
      }
      this.draw();
      this.heading.querySelector<HTMLButtonElement>('[data-page="' + (this.state.library ? 'saved' : 'collect') + '"]')?.focus();
    }}), signal);
    this.node.id='training-panel';
    this.node.className='training-panel';
  }
  get dirty() {return this.state.dirty;}
  stopAudio() {this.node.querySelectorAll('.training-source').forEach(card=>card.dispatchEvent(new Event('training-stop')));}
  update(view:View,doc:Document,ids:string[],entry?:{mode:Mode;limit:number}) {
    const key=JSON.stringify([view.revision.snapshot_hash,doc.path,ids]);
    const changed=this.view!==view;
    if (changed) this.collections=trainingCollections(view);
    if (this.state.pendingId && [...this.collections.values()].some(rows=>rows.some(record=>record.id===this.state.pendingId))) {
      this.workflow.send(Msg.Committed({id: this.state.pendingId}));
      const form=this.node.querySelector<HTMLFormElement>('#training-review');if(form)form.dataset.dirty='false';
    }
    if (this.dirty) {
      if(changed && this.view.revision.snapshot_hash!==view.revision.snapshot_hash)this.markStale();
      if(entry)this.status('Your current review is pinned. Save or discard it to collect another passage.');
      return;
    }
    if (!changed && key===this.state.selection && !entry)return;
    this.view=view;
    this.workflow.send(Msg.Passage({key, ...(entry && {entry})}));
    this.seed=makePassage(view,doc,ids);
    this.rerank();this.draw();
  }
  markStale() {
    this.workflow.send(Msg.Stale());
    const save=this.node.querySelector<HTMLButtonElement>('[data-training-save]');
    if(save)save.disabled=true;
    this.status('The saved revision changed. Discard this review and reopen the passage on the current revision.');
  }
  clear() {
    this.stopAudio();this.workflow.send(Msg.Reset());
    this.node.replaceChildren();
  }
  private status(text:string) {const out=this.node.querySelector('[data-status]');if(out)out.textContent=text;}
  private rerank() {
    this.candidates=this.seed && this.state.mode!=='label'?findCandidates(this.view,this.seed,this.state.mode,{limit:this.state.limit,query:this.state.query,matchedWordsOnly:this.state.matchedWordsOnly}):[];
  }
  private draw() {
    this.stopAudio();
    this.node.dataset.mode=this.state.mode;this.node.dataset.limit=String(this.state.mode==='label'?1:this.state.limit);
    const body=document.createElement('div');
    body.dataset.body='';
    this.node.replaceChildren(this.heading, body, viewFragment(h.p.attrs({'data-status': '', role: 'status'})));
    this.comparison.replaceChildren();
    if(this.state.library){this.drawLibrary(body);return;}
    if(!this.seed){
      renderInto(body,
        h.p
        .class('training-empty')
        .children(
          'Select words within one transcript passage to label them or compare them with another passage.',
        ),
        h.button.class('secondary').attrs({type: 'button'}).children('Choose words in transcript'),
      );
      body.querySelector('button')!.onclick=this.actions.read;
      return;
    }
    const seed=sourceCard(this.seed,'Selected passage',this.view);seed.dataset.trainingSeed='';body.append(seed);
    const controls=document.createElement('fieldset');controls.className='training-modes';
    renderInto(controls,
      h.legend('Collect an example'),
      Object.entries(modes).map(([id, label]) =>
        h.label(
          h.input.attrs({
            type: 'radio',
            name: 'training-mode',
            value: id,
            checked: this.state.mode === id ? '' : undefined,
          }),
          label,
        ),
      ),
    );
    body.append(controls);
    controls.onchange=e=>{
      this.workflow.send(Msg.Mode({mode:(e.target as HTMLInputElement).value as Mode}));this.rerank();this.draw();
      this.node.querySelector<HTMLInputElement>('[name="training-mode"]:checked')?.focus();
    };
    const candidate=this.candidates[this.state.candidateIndex]??null;
    if(this.state.mode!=='label'){
      this.drawDiscovery(body,candidate);
      if(!candidate)return;
      this.drawComparison(candidate);
    }
    this.drawReview(body,candidate);
  }
  private drawComparison(candidate:Passage) {
    renderInto(this.comparison,
      h.div
      .class('training-comparison-inner')
      .children(
        h.div
          .class('training-strip-meta')
          .children(
            h.strong(
              icon('link'),
              ' Comparison ',
              String(this.state.candidateIndex + 1),
              ' of ',
              String(this.candidates.length),
            ),
            h.span(candidate.title, ' · ', candidate.utterance ?? 'Unsegmented passage'),
          ),
        h.blockquote(candidate.quote),
        h.div
          .class('training-strip-actions')
          .children(
            h.button
              .class('secondary')
              .attrs({type: 'button', 'aria-label': 'Previous comparison', 'data-move': '-1'})
              .children(icon('arrow_back')),
            h.button
              .class('secondary')
              .attrs({type: 'button', 'aria-label': 'Next comparison', 'data-move': '1'})
              .children(icon('arrow_forward')),
            h.button.attrs({type: 'button', 'data-review': ''}).children('Review example'),
          ),
      ),
    );
    this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button=>{
      const next=this.state.candidateIndex+Number(button.dataset.move);
      button.disabled=next<0||next>=this.candidates.length;
      button.onclick=()=>{if(this.dirty)return;this.workflow.send(Msg.Candidate({index:next}));this.draw();
        const buttons=[...this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]:not(:disabled)')];
        (buttons.find(b=>b.dataset.move===button.dataset.move)??buttons[0])?.focus({preventScroll:true});};
    });
    this.comparison.querySelector<HTMLButtonElement>('[data-review]')!.onclick=()=>this.focusReview();
  }
  private focusReview() {
    const field=this.node.querySelector<HTMLInputElement>('[name="label"]');
    field?.focus();
    field?.scrollIntoView({block:'nearest'});
  }
  private drawDiscovery(body:HTMLElement,candidate:Passage|null) {
    const section=document.createElement('section');section.className='training-discovery';
    renderInto(section,
      h.details
      .class('training-search')
      .attrs({open: !candidate || this.state.query ? '' : undefined})
      .children(
        h.summary('Refine search'),
        h.p.class('muted').children(lensDescriptions[this.state.mode as TrainingLens]),
        h.search(
          h.form
            .attrs({'aria-label': 'Find a comparison', 'data-dirty': 'false'})
            .children(
              h.label(
                'Find words in the corpus',
                h.input.attrs({type: 'search', name: 'query', value: this.state.query, autocomplete: 'off'}),
              ),
              h.label(
                'Search result span',
                h.select
                  .attrs({name: 'manual-scope'})
                  .children(
                    h.option.attrs({value: 'passage'}).children('Surrounding passage'),
                    h.option
                      .attrs({value: 'matched', selected: this.state.matchedWordsOnly ? '' : undefined})
                      .children('Matched words only'),
                  ),
              ),
              h.label(
                'Candidate limit',
                h.select
                  .attrs({name: 'limit'})
                  .children(
                    [3, 6, 12].map((n) =>
                      h.option.attrs({selected: n === this.state.limit ? '' : undefined}).children(String(n)),
                    ),
                  ),
              ),
              h.button.class('secondary').attrs({type: 'submit'}).children(icon('search'), 'Find passages'),
            ),
        ),
      ),
    );
    body.append(section);
    section.querySelector('form')!.onsubmit=e=>{
      e.preventDefault();const data=new FormData(e.currentTarget as HTMLFormElement);
      this.workflow.send(Msg.Find({query:String(data.get('query')??'').trim(),limit:Number(data.get('limit')),
        matchedWordsOnly:data.get('manual-scope')==='matched'}));this.rerank();this.draw();
      (this.node.querySelector<HTMLSelectElement>('[name="candidate"]') ?? this.node.querySelector<HTMLInputElement>('[name="query"]'))?.focus();
    };
    if(!candidate){section.prepend(
      viewFragment(
        h.p
          .class('training-empty')
          .attrs({role: 'status'})
          .children('No other passage matched. Change the search words or clear the search.'),
      ),
    );return;}
    const label=document.createElement('label');label.textContent='Comparison passage';
    const select=document.createElement('select');select.name='candidate';
    for(const [index,p] of this.candidates.entries()){
      const ids = p.tokenIds;
      const location = this.state.query && this.state.matchedWordsOnly ? ' · ' + (ids.length===1 ? ids[0] : ids[0]+'–'+ids.at(-1)) : '';
      const option=new Option(`${index+1}. ${p.quote} · ${p.title}${location}`,String(index));select.add(option);
    }
    select.value=String(this.state.candidateIndex);
    select.onchange=()=>{this.workflow.send(Msg.Candidate({index:Number(select.value)}));this.draw();this.node.querySelector<HTMLSelectElement>('[name="candidate"]')?.focus();};
    label.append(select);
    const card=sourceCard(candidate,`Comparison ${this.state.candidateIndex+1} of ${this.candidates.length}`,this.view);
    const review=document.createElement('button');
    review.type='button';review.className='secondary training-card-review';review.textContent='Review example';
    review.onclick=()=>this.focusReview();
    card.querySelector('.training-byline')!.append(review);
    section.prepend(card,label);
  }
  private drawReview(body:HTMLElement,candidate:Passage|null) {
    const form=document.createElement('form');form.id='training-review';form.dataset.dirty='false';
    form.setAttribute('aria-labelledby','training-review-heading');
    const pair=this.state.mode!=='label';
    const savedLabels=[...this.collections.values()].flat().filter(record=>record.kind===(pair?'pair':'classification')).map(record=>record.label);
    const labels=new Set([...(pair?decisions:['Question','Request','Reported experience','Code-switch','Transcription uncertain']),...savedLabels]);
    renderInto(form,
      h.h3.id('training-review-heading').children('Your review'),
      h.label(
        'Collection name',
        h.input.attrs({
          name: 'collection',
          required: '',
          maxlength: '120',
          list: 'training-names',
          value: this.state.collection,
          placeholder: 'e.g. Community notices',
        }),
      ),
      h.datalist
      .id('training-names')
      .children([...this.collections.keys()].map((n) => h.option.attrs({value: n}))),
      h.label(
        pair ? 'Relationship' : 'Passage label',
        h.input.attrs({
          name: 'label',
          required: '',
          maxlength: '160',
          list: 'training-labels',
          placeholder: pair ? 'Choose or enter a relationship' : 'e.g. Request for clarification',
        }),
      ),
      h.datalist.id('training-labels').children([...labels].map((n) => h.option.attrs({value: n}))),
      h.label('Review note (optional)', h.textarea.attrs({name: 'note', rows: '2'})),
      h.div.attrs({'data-assistant': ''}),
      h.div
      .class('training-actions')
      .children(
        h.button
          .attrs({type: 'submit', 'data-training-save': ''})
          .children(icon('check'), 'Save reviewed example'),
        h.button
          .class('secondary')
          .attrs({type: 'button', 'data-discard': '', hidden: ''})
          .children('Discard review'),
      ),
    );
    body.append(form);
    const mark=()=>{
      this.workflow.send(Msg.Dirty());
      form.dataset.dirty='true';form.querySelector<HTMLElement>('[data-discard]')!.hidden=false;
      this.node.querySelector<HTMLFieldSetElement>('.training-modes')!.disabled=true;
      this.node.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('.training-discovery search :is(button,input,select),[name="candidate"]').forEach(el=>el.disabled=true);
      this.comparison.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(el=>el.disabled=true);
      this.actions.dirty();
    };
    form.oninput=mark;
    form.querySelector<HTMLButtonElement>('[data-discard]')!.onclick=()=>void this.actions.reset(this.state.stale);
    this.drawModel(form.querySelector('[data-assistant]')!,candidate,mark);
    form.onsubmit=async event=>{
      event.preventDefault();
      if(this.state.stale)return;
      const fields=new FormData(form);
      try {
        if(!this.state.assistance && (fields.get('assistant-model') || fields.get('assistant-reply'))) {
          this.status('Attach the model reading or clear its fields before saving the review.');return;
        }
        const collection=String(fields.get('collection')).trim();
        const searchMethod=this.state.matchedWordsOnly?'manual text search · matched words only':'manual text search';
        const op=trainingOperation(this.view,{collection,lens:this.state.mode,seed:this.seed!,candidate,
          label:String(fields.get('label')).trim(),note:String(fields.get('note')??'').trim(),
          discovery:pair?(this.state.query?searchMethod:'local '+this.state.mode+' ranking'):'manual selection',assistance:this.state.assistance ?? undefined},draftContext()?.actor??'');
        this.workflow.send(Msg.Saving({collection,id:op.id}));
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
    renderInto(host,
      h.details
      .class('training-assistant')
      .children(
        h.summary(icon('auto_awesome'), 'Model second reading'),
        h.details(h.summary('Inspect the model prompt'), h.pre(prompt)),
        desktop?.askLocalModel
          ? group(
              h.button.class('secondary').attrs({type: 'button', 'data-ask': ''}).children('Ask local model'),
              h.small('Uses the model at 127.0.0.1:8080.'),
            )
          : h.small('You can copy the prompt into your local model.'),
        h.label('Model name', h.input.attrs({name: 'assistant-model', autocomplete: 'off'})),
        h.label('Model proposal', h.textarea.attrs({name: 'assistant-reply', rows: '3'})),
        h.button
          .class('secondary')
          .attrs({type: 'button', 'data-attach': ''})
          .children('Attach model reading'),
        h.p.attrs({role: 'status', 'data-model-status': ''}),
      ),
    );
    const model=host.querySelector<HTMLInputElement>('[name="assistant-model"]')!,reply=host.querySelector<HTMLTextAreaElement>('[name="assistant-reply"]')!;
    const feedback=host.querySelector('[data-model-status]')!;
    const attach=host.querySelector<HTMLButtonElement>('[data-attach]')!,ask=host.querySelector<HTMLButtonElement>('[data-ask]');
    const capture=()=>{if(!model.value.trim()||!reply.value.trim()){feedback.textContent='Enter the model name and its proposal.';return;}
      mark();this.workflow.send(Msg.Attach({reading:{model:model.value.trim(),reply:reply.value,prompt}}));model.readOnly=true;reply.readOnly=true;attach.disabled=true;if(ask)ask.disabled=true;
      feedback.textContent='Model reading attached. Enter your own label above.';};
    attach.onclick=capture;
    if(ask)ask.onclick=async()=>{
      mark();ask.disabled=true;attach.disabled=true;model.readOnly=true;reply.readOnly=true;feedback.textContent='Waiting for the local model…';
      const save=host.closest('form')!.querySelector<HTMLButtonElement>('[data-training-save]')!;save.disabled=true;
      try {const result=await desktop!.askLocalModel(request);if(!this.node.contains(host))return;model.value=result.model;reply.value=result.reply;capture();}
      catch(error){if(!this.node.contains(host))return;feedback.textContent=String(error);ask.disabled=false;attach.disabled=false;model.readOnly=false;reply.readOnly=false;}
      finally{if(this.node.contains(host))save.disabled=this.state.stale;}
    };
  }
  private drawLibrary(body:HTMLElement) {
    if(!this.collections.size){
      renderInto(body,
        h.div.class('training-library-empty').children(
          h.h3('No reviewed examples yet'),
          h.p(
            this.seed
              ? 'Label your selected passage or compare it with another passage to start a collection.'
              : 'Choose a passage, give it a label or compare it with another passage, then save it to a collection.',
          ),
          h.button
            .class('secondary')
            .attrs({type: 'button'})
            .children(icon('menu_book'), this.seed ? 'Use selected passage' : 'Choose a passage'),
        ),
      );
      body.querySelector('button')!.onclick=()=>{
        this.workflow.send(Msg.Page({library:false}));
        if(this.seed)this.node.querySelector<HTMLInputElement>('[name="training-mode"]:checked')?.focus();
        else this.actions.read();
      };
      return;
    }
    if(!this.collections.has(this.state.libraryName))this.workflow.send(Msg.Collection({name:this.collections.keys().next().value!}));
    const rows=this.collections.get(this.state.libraryName)!;
    const counts=trainingCounts(rows);
    const labels=new Map<string,number>();
    for(const record of rows)labels.set(record.label,(labels.get(record.label)??0)+1);
    if(!labels.has(this.state.libraryLabel))this.workflow.send(Msg.Label({label:''}));
    renderInto(body,
      h.div.class('training-library-filters').children(
        h.label(
          'Saved collection',
          h.select
            .attrs({name: 'saved-collection'})
            .children(
              [...this.collections.keys()].map((n) =>
                h.option.attrs({selected: n === this.state.libraryName ? '' : undefined}).children(n),
              ),
            ),
        ),
        h.label(
          'Filter by label',
          h.select.attrs({name: 'saved-label'}).children(
            h.option.attrs({value: ''}).children('All labels (', String(counts.examples), ')'),
            [...labels.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, n]) => h.option.attrs({value: name}).children(name, ' (', String(n), ')')),
          ),
        ),
      ),
      h.details
      .class('training-collection-info')
      .children(
        h.summary('Collection details'),
        h.p
          .class('training-counts')
          .children(
            String(counts.examples),
            ' reviewed · ',
            String(counts.utterances),
            ' identified utterance',
            counts.utterances === 1 ? '' : 's',
            ' · ',
            String(counts.speakers),
            ' document-scoped speaker ID',
            counts.speakers === 1 ? '' : 's',
          ),
        counts.unknownSpeakers || counts.unknownUtterances
          ? h.small(
              String(counts.unknownSpeakers),
              ' without speaker attribution · ',
              String(counts.unknownUtterances),
              ' unsegmented passage',
              counts.unknownUtterances === 1 ? '' : 's',
            )
          : '',
        this.view.snapshot.config.rights
          ? h.p.class('muted').children(h.strong('Corpus use'), h.br, this.view.snapshot.config.rights)
          : '',
      ),
      h.div
      .class('training-export')
      .children(
        h.button
          .class('secondary')
          .attrs({type: 'button', 'data-export': '', 'aria-describedby': 'training-export-scope'})
          .children(icon('download'), 'Export reviewed JSONL'),
        h.small
          .id('training-export-scope')
          .children(
            'Full collection · ',
            String(counts.examples),
            ' example',
            counts.examples === 1 ? '' : 's',
          ),
      ),
      h.section
      .class('training-records')
      .attrs({'aria-labelledby': 'training-records-heading'})
      .children(
        h.h3.id('training-records-heading').children('Reviewed examples'),
        h.p.attrs({'data-result-count': '', role: 'status'}),
        h.div.attrs({'data-records': ''}),
      ),
    );
    const select=body.querySelector('select')!;
    select.onchange=()=>{this.workflow.send(Msg.Collection({name:select.value}));this.draw();this.node.querySelector<HTMLSelectElement>('[name="saved-collection"]')?.focus();};
    body.querySelector<HTMLButtonElement>('[data-export]')!.onclick=()=>{
      try{exportTraining(this.view,this.state.libraryName);}catch(error){this.status(String(error));}
    };
    const filter=body.querySelector<HTMLSelectElement>('[name="saved-label"]')!;
    filter.value=this.state.libraryLabel;
    const list=body.querySelector<HTMLElement>('[data-records]')!;
    const drawRecords=()=>{
      const matching=this.state.libraryLabel?rows.filter(record=>record.label===this.state.libraryLabel):rows;
      body.querySelector('[data-result-count]')!.textContent=this.state.libraryLabel?`${matching.length} of ${rows.length} · ${this.state.libraryLabel}`:`${rows.length} total`;
      this.stopAudio();
      list.replaceChildren();
      for(const record of matching)this.appendRecord(list,record);
    };
    filter.onchange=()=>{this.workflow.send(Msg.Label({label:filter.value}));drawRecords();};
    drawRecords();
  }
  private appendRecord(body:HTMLElement,record:TrainingRecord) {
    const row=document.createElement('details');row.className='training-record';
    const preview=(passage:Passage)=>h.span
      .class('training-record-excerpt')
      .children(
        h.small(passage.title || passage.document, passage.utterance ? ' · ' + passage.utterance : ''),
        h.span.class('training-record-quote').children(passage.quote),
      );
    renderInto(row,
      h.summary(
        h.span
          .class('training-record-label')
          .children(
            h.strong(record.label),
            h.small(record.candidate ? 'Pair' : 'Passage'),
            icon('expand_more'),
          ),
        h.span
          .class('training-record-excerpts')
          .children(preview(record.seed), record.candidate ? preview(record.candidate) : ''),
      ),
    );
    body.append(row);
    row.ontoggle=()=>{
      if(!row.open){row.querySelectorAll('.training-source').forEach(n=>n.dispatchEvent(new Event('training-stop')));return;}
      if(row.childElementCount>1)return;
      row.append(sourceCard(record.seed,'Selected passage',this.view));
      if(record.candidate)row.append(sourceCard(record.candidate,'Comparison passage',this.view));
      const note=document.createElement('p');note.textContent=record.note;row.append(note);
      const provenance=document.createElement('small');provenance.textContent=`${record.reviewer} · ${record.discovery} · R${record.seed.revision}`;row.append(provenance);
      if(record.assistance){const model=document.createElement('details');renderInto(model,
        h.summary('Model second reading'),
        h.p,
        h.pre,
      );
        model.querySelector('p')!.textContent=record.assistance.model+' · '+record.assistance.reply;
        model.querySelector('pre')!.textContent=record.assistance.prompt;row.append(model);}
    };
  }
}
