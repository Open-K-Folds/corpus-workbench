import {h, renderInto} from './effect-view';
import {api} from './api';
import type {Operation,ReaderPreview,View} from './contracts';
export async function teitokReaderInspector(view:View,onSave:(operations:Operation[],label:string)=>Promise<void>):Promise<HTMLElement>{
  const result=await api<ReaderPreview>(`/api/teitok-reader?revision=${view.revision.id}`);
  if(result.revision!==view.revision.id||result.snapshot_hash!==view.revision.snapshot_hash)throw new Error('Reader configuration revision mismatch');
  const panel=document.createElement('section');
  renderInto(panel,
    h.h2('TEITOK reader package'),
    h.p(
      'Package the original, corrected and optional normalized reading controls and research span definitions. Installation is a named revision and requires new review. Custom settings and definitions are preserved and block installation.',
    ),
    h.p
    .id('reader-state')
    .children(
      result.installed
        ? 'Reader profile is packaged.'
        : result.enabled
          ? 'Ready to install on R' + view.revision.id + '.'
          : 'Installation blocked.',
    ),
    result.blockers.length ? h.ul.class('error').children(result.blockers.map((value) => h.li(value))) : '',
    Object.entries(result.candidate_xml).map(([path, text]) =>
      h.details(
        h.summary(path, ' - ', result.before_hashes[path] ? 'existing file' : 'new file'),
        h.pre(text),
      ),
    ),
    h.button
    .id('install-teitok-reader')
    .attrs({disabled: result.enabled ? undefined : ''})
    .children('Install packaged TEITOK reader'),
    h.p
    .class('muted')
    .children(
      'This fixed profile covers review_* spans in the bounded text dialect. Other schemas and opaque carriers still require converters. Native TEITOK remains a separately installed reader.',
    ),
  );
  panel.querySelector<HTMLButtonElement>('#install-teitok-reader')!.onclick=()=>void onSave([{kind:'install_teitok_reader',profile_hash:result.profile_hash}],'Install packaged TEITOK reader');
  return panel;
}
