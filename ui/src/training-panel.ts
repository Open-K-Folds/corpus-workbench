import {group, h, renderInto, viewFragment} from './effect-view';
import {preparePassage} from '../../desktop/coanalysis-prompt.mjs';
import {draftContext} from './api';
import type {Document,Operation,View} from './contracts';
import {desktop} from './desktop';
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
  private libraryLabel = '';
  private collections = new Map<string,TrainingRecord[]>();
  private selection = '';
  private pendingId = '';
  private stale = false;
  private query = '';
  private matchedWordsOnly = false;
  private candidates:Passage[] = [];
  private candidateIndex = 0;
  private assistance: TrainingAssistance | undefined;
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
    renderInto(this.node,
      h.div
      .class('training-heading')
      .children(
        h.h2(icon('library_books'), 'Training collections'),
        h.nav
          .attrs({'aria-label': 'Training workspace'})
          .children(
            h.button
              .attrs({type: 'button', 'data-page': 'collect', 'aria-pressed': String(!this.library)})
              .children('Collect'),
            h.button
              .attrs({type: 'button', 'data-page': 'saved', 'aria-pressed': String(this.library)})
              .children('Saved collections'),
          ),
      ),
      h.div.attrs({'data-body': ''}),
      h.p.attrs({'data-status': '', role: 'status'}),
    );
    this.comparison.replaceChildren();
    this.node.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>{
      if(this.dirty){this.status('Save or discard this review before opening saved collections.');return;}
      this.library=b.dataset.page==='saved';this.draw();
      this.node.querySelector<HTMLButtonElement>('[data-page][aria-pressed="true"]')?.focus();
    });
    const body=this.node.querySelector<HTMLElement>('[data-body]')!;
    if(this.library){this.drawLibrary(body);return;}
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
            checked: this.mode === id ? '' : undefined,
          }),
          label,
        ),
      ),
    );
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
              String(this.candidateIndex + 1),
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
      const next=this.candidateIndex+Number(button.dataset.move);
      button.disabled=next<0||next>=this.candidates.length;
      button.onclick=()=>{if(this.dirty)return;this.candidateIndex=next;this.assistance=undefined;this.draw();
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
      .attrs({open: !candidate || this.query ? '' : undefined})
      .children(
        h.summary('Refine search'),
        h.p.class('muted').children(lensDescriptions[this.mode as TrainingLens]),
        h.search(
          h.form
            .attrs({'aria-label': 'Find a comparison', 'data-dirty': 'false'})
            .children(
              h.label(
                'Find words in the corpus',
                h.input.attrs({type: 'search', name: 'query', value: this.query, autocomplete: 'off'}),
              ),
              h.label(
                'Search result span',
                h.select
                  .attrs({name: 'manual-scope'})
                  .children(
                    h.option.attrs({value: 'passage'}).children('Surrounding passage'),
                    h.option
                      .attrs({value: 'matched', selected: this.matchedWordsOnly ? '' : undefined})
                      .children('Matched words only'),
                  ),
              ),
              h.label(
                'Candidate limit',
                h.select
                  .attrs({name: 'limit'})
                  .children(
                    [3, 6, 12].map((n) =>
                      h.option.attrs({selected: n === this.limit ? '' : undefined}).children(String(n)),
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
      this.query=String(data.get('query')??'').trim();this.limit=Number(data.get('limit'));
      this.matchedWordsOnly=data.get('manual-scope')==='matched';this.assistance=undefined;this.rerank();this.draw();
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
      const location = this.query && this.matchedWordsOnly ? ' · ' + (ids.length===1 ? ids[0] : ids[0]+'–'+ids.at(-1)) : '';
      const option=new Option(`${index+1}. ${p.quote} · ${p.title}${location}`,String(index));select.add(option);
    }
    select.value=String(this.candidateIndex);
    select.onchange=()=>{this.candidateIndex=Number(select.value);this.assistance=undefined;this.draw();this.node.querySelector<HTMLSelectElement>('[name="candidate"]')?.focus();};
    label.append(select);
    const card=sourceCard(candidate,`Comparison ${this.candidateIndex+1} of ${this.candidates.length}`,this.view);
    const review=document.createElement('button');
    review.type='button';review.className='secondary training-card-review';review.textContent='Review example';
    review.onclick=()=>this.focusReview();
    card.querySelector('.training-byline')!.append(review);
    section.prepend(card,label);
  }
  private drawReview(body:HTMLElement,candidate:Passage|null) {
    const form=document.createElement('form');form.id='training-review';form.dataset.dirty='false';
    form.setAttribute('aria-labelledby','training-review-heading');
    const pair=this.mode!=='label';
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
          value: this.collection,
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
        this.collection=collection;this.libraryName=collection;this.libraryLabel='';this.pendingId=op.id;
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
        this.library=false;this.draw();
        if(this.seed)this.node.querySelector<HTMLInputElement>('[name="training-mode"]:checked')?.focus();
        else this.actions.read();
      };
      return;
    }
    if(!this.collections.has(this.libraryName))this.libraryName=this.collections.keys().next().value!;
    const rows=this.collections.get(this.libraryName)!;
    const counts=trainingCounts(rows);
    const labels=new Map<string,number>();
    for(const record of rows)labels.set(record.label,(labels.get(record.label)??0)+1);
    if(!labels.has(this.libraryLabel))this.libraryLabel='';
    renderInto(body,
      h.div.class('training-library-filters').children(
        h.label(
          'Saved collection',
          h.select
            .attrs({name: 'saved-collection'})
            .children(
              [...this.collections.keys()].map((n) =>
                h.option.attrs({selected: n === this.libraryName ? '' : undefined}).children(n),
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
    select.onchange=()=>{this.libraryName=select.value;this.libraryLabel='';this.draw();this.node.querySelector<HTMLSelectElement>('[name="saved-collection"]')?.focus();};
    body.querySelector<HTMLButtonElement>('[data-export]')!.onclick=()=>{
      try{exportTraining(this.view,this.libraryName);}catch(error){this.status(String(error));}
    };
    const filter=body.querySelector<HTMLSelectElement>('[name="saved-label"]')!;
    filter.value=this.libraryLabel;
    const list=body.querySelector<HTMLElement>('[data-records]')!;
    const drawRecords=()=>{
      const matching=this.libraryLabel?rows.filter(record=>record.label===this.libraryLabel):rows;
      body.querySelector('[data-result-count]')!.textContent=this.libraryLabel?`${matching.length} of ${rows.length} · ${this.libraryLabel}`:`${rows.length} total`;
      this.stopAudio();
      list.replaceChildren();
      for(const record of matching)this.appendRecord(list,record);
    };
    filter.onchange=()=>{this.libraryLabel=filter.value;drawRecords();};
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
