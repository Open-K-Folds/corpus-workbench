import {api} from './api';
import type {View} from './contracts';
import {esc} from './dom';
import {icon} from './icons';
import {suppliedCue} from './listening';
import type {Passage} from './training-candidates';

// Source inspection can follow a saved example back to an earlier revision.
export function sourceCard(p:Passage, caption:string, current:View) {
  const card = document.createElement('article');
  card.className = 'training-source';
  card.innerHTML = `<div class="training-byline"><strong>${esc(caption)}</strong><small>R${esc(p.revision)}</small></div>
    <blockquote>${esc(p.quote)}</blockquote>
    <p>${esc(p.title)} · ${esc(p.utterance ?? 'Unsegmented passage')} · ${p.speaker ? 'Speaker '+esc(p.speaker) : 'Speaker unknown'}</p>
    <details><summary>Source context</summary><div></div></details>`;
  const details = card.querySelector('details')!;
  const body = details.querySelector('div')!;
  let playback:HTMLAudioElement|null = null;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let generation = 0, playRequest = 0;
  const stop = () => {playRequest++;clearTimeout(timer); playback?.pause();};
  card.addEventListener('training-stop', stop);
  details.ontoggle = async () => {
    const ticket = ++generation;
    stop();
    playback = null;
    if (!details.open) return;
    body.textContent = 'Opening saved context…';
    try {
      const basis = current.revision.snapshot_hash === p.snapshotHash ? current : await api<View>('/api/view?revision='+p.revision);
      const doc = basis.documents.find(item => item.path === p.document);
      if (!doc || basis.snapshot.project !== p.project || basis.revision.id !== p.revision || basis.revision.snapshot_hash !== p.snapshotHash ||
          basis.snapshot.files[p.document]?.sha256 !== p.documentHash) throw new Error('The recorded source revision is unavailable in this project.');
      const first = doc.tokens.findIndex(token => token.id === p.tokenIds[0]);
      if (first < 0 || !p.tokenIds.every((id, i) => doc.tokens[first+i]?.id === id)) throw new Error('The saved source anchor is unavailable.');
      if (generation !== ticket || !details.open) return;
      const from = Math.max(0,first-14), end = first+p.tokenIds.length;
      const words = doc.tokens.slice(from,end+14).map((token,i) => {
        const text = esc(token.corrected ?? token.original);
        return from+i >= first && from+i < end ? '<mark>'+text+'</mark>' : text;
      });
      body.innerHTML = `<p class="training-context">${from?'… ':''}${words.join(' ')}${end+14<doc.tokens.length?' …':''}</p>
        <small>${esc(p.document)} · ${esc(p.tokenIds[0])}${p.tokenIds.length>1?' – '+esc(p.tokenIds.at(-1)):''}${p.language?' · '+esc(p.language):''}</small>`;
      const cue = suppliedCue(doc,p.tokenIds,Infinity);
      const media = [...new Set(doc.media.flatMap(name=>[name,'Audio/'+name,'Video/'+name]).filter(name=>basis.snapshot.files[name]?.role==='source-media'))];
      if ('reason' in cue || media.length !== 1) return;
      const projection = await api<{snapshot_hash:string;media_base_unsupported:boolean}>(`/api/reading?path=${encodeURIComponent(doc.path)}&revision=${p.revision}`);
      if (generation !== ticket || !details.open || projection.snapshot_hash !== p.snapshotHash || projection.media_base_unsupported) return;
      const player = new Audio();
      playback = player;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary';
      button.innerHTML = icon('headphones')+'Listen · '+cue.basis+' timing';
      const status = document.createElement('small'); status.setAttribute('role','status');
      body.append(button,status);
      button.onclick = async () => {
        if (!player.paused) {stop();return;}
        document.querySelectorAll('.training-source').forEach(node=>node.dispatchEvent(new Event('training-stop')));
        document.querySelector<HTMLAudioElement>('#audio')?.pause();
        const started=++playRequest;
        try {
          if (!player.src) player.src = `/api/media?path=${encodeURIComponent(media[0])}&revision=${p.revision}`;
          if (player.readyState < 1) await new Promise<void>((resolve,reject)=>{
            const finish=(ok:boolean)=>{player.onloadedmetadata=null;player.onerror=null;ok?resolve():reject(new Error('Recording unavailable.'))};
            player.onloadedmetadata=()=>finish(true);player.onerror=()=>finish(false);player.load();
          });
          if (!card.isConnected || !details.open || ticket !== generation || playback !== player || started !== playRequest) return;
          const playable = suppliedCue(doc, p.tokenIds, player.duration);
          if (!Number.isFinite(player.duration) || 'reason' in playable) throw new Error('The interval exceeds the recording.');
          player.currentTime=playable.start;
          await player.play();
          const checkEnd=()=>{
            if(started!==playRequest || player.paused)return;
            if(!card.isConnected || player.currentTime>=playable.end){stop();return;}
            timer=setTimeout(checkEnd,Math.max(15,(playable.end-player.currentTime)*1000));
          };
          checkEnd();
        } catch(error) {status.textContent=String(error);}
      };
      player.onplay=()=>{button.textContent='Stop excerpt';};
      player.onpause=()=>{button.innerHTML=icon('headphones')+'Listen · '+cue.basis+' timing';};
    } catch(error) {
      if (generation === ticket) body.textContent=String(error);
    }
  };
  return card;
}
