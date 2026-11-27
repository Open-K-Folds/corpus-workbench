import {h, renderInto} from './effect-view';
import {api} from './api';
import {seconds} from './dom';
import {AudioPlayer} from './player';
import {icon} from './icons';
import type {Revision,View} from './contracts';
interface SpanConstraint {field:'label'|'variety';value:string}
export interface SearchQuery {schema:1;project:string;revision:number;snapshot_hash:string;mode:'current'|'historical';reading:'original'|'corrected'|'normalized';terms:{text:string;language:string|null}[];span?:SpanConstraint;documents:string[];context:number;offset:number;limit:number}
interface Word {id:string;internal_id:string;original:string;corrected:string|null;normalized:string|null;normalized_status:string|null;language:string|null;language_source:string}
interface Audio {path:string;artifact_hash:string;start_us:number;end_us:number;basis:string}
interface SpanEvidence {id:string;sidecar:string;artifact_hash:string;token_ids:string[];fields:Record<string,string>}
export interface SearchHit {id:string;document:string;title:string;utterance:string|null;speaker:string|null;token_ids:string[];corpus_start:number;corpus_end:number;left:Word[];matched:Word[];right:Word[];readings:string[];audio:Audio|null;spans?:SpanEvidence[]}
interface Envelope {result_hash:string;result:{schema:number;binding:{engine:string;project:string;revision:number;snapshot_hash:string;projection_hash:string};query:SearchQuery;total:number;hits:SearchHit[];next_offset:number|null;rights:string}}
interface Resolved {binding:Envelope['result']['binding'];hit:SearchHit;historical:boolean}
export interface SearchPanel {element:HTMLElement;update:(view:View)=>void;pause:()=>void}
export function corpusSearch(initial:View,open:(binding:Envelope['result']['binding'],hit:SearchHit,reading:SearchQuery['reading'])=>void,refresh:()=>Promise<View>, signal: AbortSignal):SearchPanel {
  const panel=document.createElement('section');panel.className='search-panel';
  renderInto(panel,
    h.h2('Corpus search'),
    h.form.id('corpus-search-form').children(
      h.label(
        'Exact token sequence',
        h.textarea.attrs({
          name: 'tokens',
          rows: '2',
          required: '',
          placeholder: 'One token per line',
          'aria-describedby': 'search-query-help',
        }),
      ),
      h.small
        .id('search-query-help')
        .class('muted')
        .children(
          'Enter 1 to 8 tokens, one per line. Spelling and spaces match exactly within a single utterance or unsegmented run.',
        ),
      h.div
        .class('search-query-actions')
        .children(
          h.button.attrs({type: 'submit'}).children(icon('search'), ' Search corpus'),
          h.button
            .class('secondary')
            .id('reload-search-evidence')
            .attrs({type: 'button'})
            .children('Reload saved evidence'),
        ),
      h.details.class('search-options').children(
        h.summary('Search options'),
        h.fieldset
          .class('search-group')
          .children(
            h.legend('Reading and language'),
            h.label(
              'Search reading',
              h.select
                .attrs({name: 'reading'})
                .children(
                  h.option.attrs({value: 'corrected'}).children('Corrected, then original'),
                  h.option.attrs({value: 'original'}).children('Original source'),
                  h.option
                    .attrs({value: 'normalized'})
                    .children('Current normalized, then corrected / original'),
                ),
            ),
            h.label(
              'Language / variety filter',
              h.input.attrs({
                name: 'language',
                autocomplete: 'off',
                placeholder: 'Any language',
                'aria-describedby': 'search-language-default-help',
              }),
            ),
            h.small
              .id('search-language-default-help')
              .class('muted')
              .children('Default for terms set to Use default. Leave empty for any language.'),
            h.details
              .class('search-term-languages')
              .children(
                h.summary(icon('tune'), ' Per-term language filters'),
                h.p
                  .id('search-term-language-help')
                  .class('muted')
                  .children(
                    'Choose a language for each term to find language transitions. Blank lines are ignored. Custom values match spaces and Unicode spelling exactly.',
                  ),
                h.div.id('search-term-languages'),
                h.small
                  .id('search-term-language-empty')
                  .class('muted')
                  .children('Enter tokens above to set their language filters.'),
              ),
          ),
        h.details
          .class('search-span')
          .children(
            h.summary(icon('tune'), ' Span annotation constraint'),
            h.fieldset
              .class('search-group')
              .children(
                h.legend('Whole-token span'),
                h.div
                  .class('search-controls')
                  .children(
                    h.label(
                      'Span field',
                      h.select
                        .attrs({name: 'span-field'})
                        .children(
                          h.option.attrs({value: ''}).children('Any span / no constraint'),
                          h.option.attrs({value: 'label'}).children('Label'),
                          h.option.attrs({value: 'variety'}).children('Language / variety'),
                        ),
                    ),
                    h.label(
                      'Exact span value',
                      h.input.attrs({
                        name: 'span-value',
                        autocomplete: 'off',
                        disabled: '',
                        'aria-describedby': 'span-search-help',
                      }),
                    ),
                  ),
                h.small
                  .id('span-search-help')
                  .class('muted')
                  .children(
                    'All matched tokens must be explicit anchors of one whole-token span. Discontinuous anchors are respected. An empty value matches an authored empty field.',
                  ),
              ),
          ),
        h.fieldset.class('search-group').children(
          h.legend('Evidence and results'),
          h.label(
            'Search evidence revision',
            h.select
              .attrs({name: 'revision'})
              .children(
                h.option.attrs({value: 'current'}).children('Current saved R', String(initial.revision.id)),
              ),
          ),
          h.label(
            'Search documents',
            h.select.attrs({name: 'document'}).children(
              h.option.attrs({value: ''}).children('All documents'),
              initial.documents.map((d) => h.option.attrs({value: d.path}).children(d.path)),
            ),
          ),
          h.div
            .class('search-controls')
            .children(
              h.label(
                'Context tokens',
                h.input.attrs({name: 'context', type: 'number', min: '0', max: '12', value: '4'}),
              ),
              h.label(
                'Page size',
                h.select
                  .attrs({name: 'limit'})
                  .children(
                    h.option('25'),
                    h.option.attrs({selected: ''}).children('50'),
                    h.option('100'),
                    h.option('200'),
                  ),
              ),
            ),
        ),
      ),
    ),
    h.p.id('corpus-search-status').attrs({role: 'status'}),
    h.div.id('corpus-search-results'),
    h.audio.id('search-audio').attrs({preload: 'metadata', hidden: ''}),
    h.p.id('search-audio-basis').class('muted'),
  );
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>panel.querySelector<T>('#'+id)!;
  const form=find<HTMLFormElement>('corpus-search-form');const status=find('corpus-search-status');const results=find('corpus-search-results');const audio=find<HTMLAudioElement>('search-audio');
  const player=new AudioPlayer(audio, signal, 'Search result playback');
  let view=initial;let rows:Revision[]=[initial.revision];let envelope:Envelope|null=null;let epoch=0;let action=0;let changed=false;let stopAt=0;
  const revision=form.elements.namedItem('revision') as HTMLSelectElement;
  const tokenInput=form.elements.namedItem('tokens') as HTMLTextAreaElement;
  const termLanguages=find('search-term-languages');
  const tokens=()=>tokenInput.value.replace(/\r\n/g,'\n').split('\n').filter(s=>s.length>0);
  function syncTermLanguages() {
    const words=tokens().slice(0,8);
    while(termLanguages.children.length>words.length)termLanguages.lastElementChild!.remove();
    words.forEach((text,index)=>{
      const position=index+1;
      let row=termLanguages.children[index] as HTMLElement|undefined;
      if(!row){
        row=document.createElement('div');row.className='search-term-language';
        renderInto(row,
          h.div
          .class('search-term-heading')
          .children(h.span('Term ', String(position)), h.code.class('search-term-text')),
          h.label(
            h.span.class('sr-only').children('Term ', String(position), ' language'),
            h.select
              .attrs({
                name: 'term-language-mode-' + String(position),
                'aria-describedby': 'search-term-language-help',
              })
              .children(
                h.option.attrs({value: 'default'}).children('Use default'),
                h.option.attrs({value: 'any'}).children('Any language'),
                h.option.attrs({value: 'exact'}).children('Exact custom value'),
              ),
          ),
          h.label
          .class('search-term-custom')
          .attrs({hidden: ''})
          .children(
            h.span.class('sr-only').children('Term ', String(position), ' exact language'),
            h.input.attrs({
              name: 'term-language-' + String(position),
              autocomplete: 'off',
              placeholder: 'Exact language / variety',
              'aria-describedby': 'search-term-language-help',
              disabled: '',
            }),
          ),
        );
        termLanguages.append(row);
      }
      row.querySelector('.search-term-text')!.textContent=text;
      const exact=row.querySelector('select')!.value==='exact';
      const custom=row.querySelector<HTMLLabelElement>('.search-term-custom')!;
      const input=custom.querySelector('input')!;
      custom.hidden=!exact;input.disabled=!exact;input.required=exact;
    });
    find('search-term-language-empty').hidden=words.length>0;
  }
  syncTermLanguages();
  form.addEventListener('invalid',event=>{
    if(!(event.target instanceof HTMLElement)) return;
    let disclosure=event.target.closest('details');
    while(disclosure){
      disclosure.open=true;
      disclosure=disclosure.parentElement?.closest('details')??null;
    }
  },true);
  const stale=()=>envelope?.result.query.mode==='current'&&(envelope.result.binding.revision!==view.revision.id||envelope.result.binding.snapshot_hash!==view.revision.snapshot_hash);
  const enabled=()=>{const obsolete=changed||!!stale();player.setEnabled(!obsolete);results.querySelectorAll<HTMLButtonElement>('button[data-hit],button[data-listen],button[data-page]').forEach(b=>b.disabled=obsolete)};
  const pause=()=>{audio.pause();++action};
  const clearAudio=()=>{audio.pause();audio.hidden=true;stopAt=0;if(audio.hasAttribute('src')){audio.removeAttribute('src');audio.load()}find('search-audio-basis').textContent=''};
  const options=()=>{const selected=revision.value;renderInto(revision,
    h.option.attrs({value: 'current'}).children('Current saved R', String(view.revision.id)),
    rows.map((r) =>
      h.option.attrs({value: String(r.id)}).children('Historical R', String(r.id), ': ', r.label),
    ),
  );revision.value=selected||'current'};
  const reload=find<HTMLButtonElement>('reload-search-evidence');
  reload.onclick=async()=>{pause();try{const next=await refresh();if(panel.isConnected)status.textContent=`Loaded saved R${next.revision.id}. Search again to update results.`}catch(error){if(panel.isConnected)status.textContent=String(error)}};
  void api<Revision[]>('/api/history').then(history=>{rows=[...new Map([...history,...rows,view.revision].map(r=>[r.id,r])).values()].sort((a,b)=>b.id-a.id);options()}).catch(error=>{if(!envelope)status.textContent='Historical revision list unavailable: '+String(error)});
  function makeQuery():SearchQuery {
    const values=new FormData(form);const row=revision.value==='current'?view.revision:rows.find(r=>r.id===Number(revision.value));if(!row)throw new Error('Historical revision unavailable');
    const language=String(values.get('language')??'')||null;const words=tokens();
    if(words.length<1||words.length>8)throw new Error('Enter 1–8 tokens, one per line.');
    const field=values.get('span-field') as SpanConstraint['field']|'';
    return {schema:1,project:view.snapshot.project,revision:row.id,snapshot_hash:row.snapshot_hash,mode:revision.value==='current'?'current':'historical',reading:values.get('reading') as SearchQuery['reading'],terms:words.map((text,index)=>{const mode=values.get(`term-language-mode-${index+1}`);return {text,language:mode==='any'?null:mode==='exact'?String(values.get(`term-language-${index+1}`)??''):language}}),...(field?{span:{field,value:String(values.get('span-value')??'')}}:{}),documents:values.get('document')?[String(values.get('document'))]:[],context:Number(values.get('context')),offset:0,limit:Number(values.get('limit'))};
  }
  function draw(value:Envelope) {
    const r=value.result;const historical=r.query.mode==='historical';
    status.textContent=`${r.total} hits · ${historical?'Historical':'Saved'} R${r.binding.revision} · ${r.query.reading} reading${r.query.span?` · span ${r.query.span.field} = ${JSON.stringify(r.query.span.value)}`:''}${stale()?' · stale against saved head; search again':''}`;
    renderInto(results,
      h.div
      .class('search-result-actions')
      .children(
        h.button
          .id('export-search')
          .class('secondary')
          .attrs({type: 'button'})
          .children(icon('download'), ' Export shown results (JSON)'),
      ),
      r.total === 0
      ? h.p.class('muted').children('Try a different spelling or adjust the search options.')
      : r.hits.length < r.total
        ? h.p
            .class('muted')
            .children(
              'Showing ',
              String(r.query.offset + 1),
              '–',
              String(r.query.offset + r.hits.length),
              ' of ',
              String(r.total),
              '.',
            )
        : '',
      r.hits.map((hit, index) => {
        const left = hit.readings.slice(0, hit.left.length).join(' ');
        const matched = hit.readings.slice(hit.left.length, hit.left.length + hit.matched.length).join(' ');
        const right = hit.readings.slice(hit.left.length + hit.matched.length).join(' ');
        const spans = hit.spans ?? [];
        return h.article.class('search-hit').children(
          h.small(hit.document, ' · ', hit.utterance ?? 'unsegmented', ' ', hit.speaker ?? ''),
          h.p.class('kwic').children(h.span(left), ' ', h.mark(matched), ' ', h.span(right)),
          h.small(hit.token_ids.join(', ')),
          spans.length
            ? h.details
                .class('search-span-evidence')
                .children(
                  h.summary(
                    String(spans.length),
                    ' matching span',
                    spans.length === 1 ? '' : 's',
                    ' · ',
                    spans.map((s) => `${s.sidecar} #${s.id}`).join('; '),
                  ),
                  h.pre(JSON.stringify(spans, null, 2)),
                )
            : '',
          h.div.class('search-hit-actions').children(
            h.button
              .class('secondary')
              .attrs({type: 'button', 'data-hit': String(index)})
              .children(
                icon(historical ? 'history' : 'link'),
                historical ? 'Inspect historical hit' : 'Open matched tokens',
              ),
            hit.audio
              ? h.button
                  .class('secondary')
                  .attrs({type: 'button', 'data-listen': String(index)})
                  .children(
                    icon('play_arrow'),
                    ' Play ',
                    hit.audio.basis === 'word_intervals' ? 'word intervals' : 'utterance',
                  )
              : h.span.class('muted').children('No observed audio interval'),
          ),
        );
      }),
      !r.hits.length ? h.p.class('empty-state').children('No matches on this page.') : '',
      h.div
      .class('search-result-actions')
      .children(
        r.query.offset
          ? h.button
              .class('secondary')
              .attrs({type: 'button', 'data-page': 'previous'})
              .children('Previous page')
          : '',
        r.next_offset !== null
          ? h.button.class('secondary').attrs({type: 'button', 'data-page': 'next'}).children('Next page')
          : '',
      ),
      h.details(
        h.summary('Result provenance and scope'),
        h.p.class('muted').children(r.rights),
        h.code
          .class('hash')
          .children(
            'Snapshot ',
            r.binding.snapshot_hash,
            h.br,
            'Projection ',
            r.binding.projection_hash,
            h.br,
            'Result ',
            value.result_hash,
          ),
      ),
      h.div.id('historical-search-inspection'),
    );
    find<HTMLButtonElement>('export-search').onclick=()=>{const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`corpus-search-r${r.binding.revision}-${r.query.offset}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    results.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>void run({...r.query,offset:b.dataset.page==='next'?r.next_offset!:Math.max(0,r.query.offset-r.query.limit)}));
    results.querySelectorAll<HTMLButtonElement>('[data-hit],[data-listen]').forEach(button=>button.onclick=async()=>{
      const intent=++action;try {
        const hit=r.hits[Number(button.dataset.hit??button.dataset.listen)];const resolved=await api<Resolved>('/api/search/resolve',{query:r.query,result_hash:value.result_hash,hit_id:hit.id});
        if(intent!==action||!panel.isConnected)return;
        if(stale())throw new Error('Search result is stale. Search the saved revision again.');
        if(button.dataset.listen!==undefined){
          const observed=resolved.hit.audio;if(!observed)throw new Error('No observed interval');
          const url=`/api/media?path=${encodeURIComponent(observed.path)}&revision=${resolved.binding.revision}`;
          if(audio.getAttribute('src')!==url){audio.src=url;audio.load();}
          audio.hidden=false;stopAt=observed.end_us/1e6;
          find('search-audio-basis').textContent=`${resolved.historical?'Historical':'Saved'} R${resolved.binding.revision}: ${observed.basis==='word_intervals'?'observed word intervals':'whole utterance; word timings are absent'} ${seconds(observed.start_us)}–${seconds(observed.end_us)}.`;
          if(audio.readyState<1)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Audio metadata unavailable'))},5000);const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(new Error('Audio media error'))};const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',done);audio.removeEventListener('error',fail)};audio.addEventListener('loadedmetadata',done,{once:true});audio.addEventListener('error',fail,{once:true})});
          if(intent!==action||!panel.isConnected)return;audio.currentTime=observed.start_us/1e6;await audio.play();
        } else if(resolved.historical){
          renderInto(find('historical-search-inspection'),
            h.h3('Historical R', String(resolved.binding.revision), ' · read only'),
            h.p(resolved.hit.document),
            h.pre(JSON.stringify({matched: resolved.hit.matched, spans: resolved.hit.spans ?? []}, null, 2)),
            h.p.class('muted').children('Current authoring remains on saved R', String(view.revision.id), '.'),
          );
        } else {open(resolved.binding,resolved.hit,r.query.reading)}
      }catch(error){if(intent===action&&panel.isConnected){status.textContent=String(error);audio.pause()}}
    });enabled();
  }
  async function run(query:SearchQuery){const intent=++epoch;++action;clearAudio();status.textContent=`Searching exact R${query.revision}…`;try{const value=await api<Envelope>('/api/search',query);if(intent!==epoch)return;envelope=value;changed=false;draw(value)}catch(error){if(intent===epoch){status.textContent=String(error);enabled()}}}
  form.onsubmit=e=>{e.preventDefault();try{void run(makeQuery())}catch(error){status.textContent=String(error)}};
  const invalidate=()=>{syncTermLanguages();(form.elements.namedItem('span-value') as HTMLInputElement).disabled=!(form.elements.namedItem('span-field') as HTMLSelectElement).value;++epoch;++action;changed=true;clearAudio();status.textContent='Query changed. Search again to update results.';enabled()};
  form.oninput=invalidate;form.onchange=invalidate;
  audio.ontimeupdate=()=>{if(stopAt&&audio.currentTime>=stopAt)audio.pause()};
  return {element:panel,pause,update:next=>{const prior=view.revision.id;view=next;if(!rows.some(r=>r.id===next.revision.id))rows.unshift(next.revision);options();if(prior!==next.revision.id){audio.pause();++epoch;++action;if(envelope&&stale()){status.textContent=`Results R${envelope.result.binding.revision} are stale against saved R${view.revision.id}. Search again.`;enabled()}}}};
}
