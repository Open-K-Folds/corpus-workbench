import {h, renderInto} from './effect-view';
import {api} from './api';
import type {View,InventoryEnvelope,Carrier} from './contracts';
export async function referenceInspector(view:View,documentPath:string,selected:string[]):Promise<HTMLElement>{
  const panel=document.createElement('section');renderInto(panel,
    h.h2('Package reference inventory'),
    h.p('Loading exact revision evidence.'),
  );
  const result=await api<InventoryEnvelope>(`/api/inventory?revision=${view.revision.id}`);const inv=result.inventory;
  if(inv.schema!==1||inv.revision!==view.revision.id||inv.snapshot_hash!==view.revision.snapshot_hash)throw new Error('Inventory revision mismatch');
  renderInto(panel,
    h.h2('Package reference inventory · R', String(inv.revision)),
    h.p(
      String(inv.artifacts.length),
      ' artifacts · ',
      String(inv.carriers.length),
      ' XML carriers · ',
      String(inv.ids.length),
      ' qualified IDs',
    ),
    h.p(
      'General converters and this discovery-only preflight stay blocked. The Split / merge tab offers a separate closed-dialect proof; syntactic ID resolution alone never authorizes a rewrite.',
    ),
    h.button.id('download-inventory').class('secondary').children('Download inventory evidence'),
    h.details(
      h.summary('Coverage and preserved opaque files'),
      h.ul(
        inv.artifacts.map((a) =>
          h.li(a.path, ': ', a.coverage, ' · ', String(a.carriers), ' carriers', h.br, h.small(a.reason)),
        ),
      ),
    ),
    h.label(
      'Artifact filter',
      h.select.id('reference-artifact').children(
        h.option.attrs({value: ''}).children('All artifacts'),
        inv.artifacts.map((a) => h.option.attrs({value: a.path}).children(a.path)),
      ),
    ),
    h.label(
      'Resolution filter',
      h.select.id('reference-resolution').children(
        h.option.attrs({value: ''}).children('All carriers'),
        [...new Set(inv.carriers.map((c) => c.resolution))].sort().map((v) => h.option(v)),
      ),
    ),
    h.p.id('reference-count'),
    h.div.id('reference-list'),
    h.h3('Inspect structural impact'),
    h.p(
      'No edit is made. Results include unknown carriers, immutable authority dependencies and remaining execution gates.',
    ),
    h.form
    .id('preflight-form')
    .children(
      h.label(
        'Qualified ID',
        h.select
          .attrs({name: 'target', required: ''})
          .children(
            inv.ids.map((id, i) =>
              h.option
                .attrs({
                  value: String(i),
                  selected: id.artifact === documentPath && selected.includes(id.id) ? '' : undefined,
                })
                .children(id.artifact, ' · ', id.id, ' · byte ', String(id.element_start)),
            ),
          ),
      ),
      h.label(
        'Proposed operation',
        h.select
          .attrs({name: 'operation'})
          .children(
            h.option.attrs({value: 'retokenize'}).children('Token split/merge'),
            h.option.attrs({value: 'converter'}).children('Converter'),
          ),
      ),
      h.button.attrs({disabled: inv.ids.length ? undefined : ''}).children('Check prerequisites'),
    ),
    h.p.id('preflight-status').attrs({role: 'status'}),
    h.details(h.summary('Preflight evidence'), h.pre.id('preflight-evidence')),
    h.details(h.summary('Coverage limits and execution gates'), h.ul(inv.limitations.map((s) => h.li(s)))),
  );
  const artifact=panel.querySelector<HTMLSelectElement>('#reference-artifact')!;const resolution=panel.querySelector<HTMLSelectElement>('#reference-resolution')!;
  const card=(c:Carrier)=>h.details(
    h.summary(c.artifact, ' · ', c.qname || c.kind, ' · ', c.resolution),
    h.p(
      'Bytes ',
      String(c.byte_start),
      '–',
      String(c.byte_end),
      ' · ',
      c.namespace ?? 'unqualified',
      ' · ',
      c.syntax,
    ),
    h.pre(c.value),
    h.ul(c.targets.map((t) => h.li(t.artifact, ' · ', t.id, ' · element byte ', String(t.element_start)))),
    h.small(c.note),
  );
  const render=()=>{const carriers=inv.carriers.filter(c=>(!artifact.value||c.artifact===artifact.value)&&(!resolution.value||c.resolution===resolution.value));panel.querySelector('#reference-count')!.textContent=`${carriers.length} matching carriers; showing ${Math.min(carriers.length,200)}. Download contains all evidence.`;renderInto(panel
    .querySelector('#reference-list')!, carriers.slice(0, 200).map(card));};artifact.onchange=render;resolution.onchange=render;render();
  panel.querySelector<HTMLButtonElement>('#download-inventory')!.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`reference-inventory-r${inv.revision}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  panel.querySelector<HTMLFormElement>('#preflight-form')!.onsubmit=async e=>{e.preventDefault();const values=new FormData(e.currentTarget as HTMLFormElement);const status=panel.querySelector('#preflight-status')!;try{const r=await api<{execution_enabled:boolean;decision:string;affected_carriers:Carrier[]}>('/api/preflight',{schema:1,project:inv.project,revision:inv.revision,snapshot_hash:inv.snapshot_hash,config_hash:inv.config_hash,inventory_hash:result.inventory_hash,operation:values.get('operation'),targets:[inv.ids[Number(values.get('target'))]]});status.textContent=`${r.decision}; ${r.affected_carriers.length} known affected carriers.`;panel.querySelector('#preflight-evidence')!.textContent=JSON.stringify(r,null,2);}catch(e){status.textContent=String(e);}};
  return panel;
}
