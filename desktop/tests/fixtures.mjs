import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Deliberately synthetic: never points at a research corpus or a user profile.
export function createPackage(root,name='Field interview — desktop preview') {
  for(const directory of ['Resources','xmlfiles','Audio','Other'])mkdirSync(join(root,directory),{recursive:true});
  writeFileSync(join(root,'Resources/settings.xml'),'<ttsettings/>');
  const lines=[
    ['We','walked','along','the','river','before','sunrise'],
    ['The','old','bridge','was','still','quiet'],
    ['Amina','remembered','the','first','market','here'],
    ['People','brought','bread','and','fresh','vegetables'],
    ['Today','the','same','street','feels','different'],
    ['I','said','café','and','she','answered','e\u0301🙂'],
    ['Then','we','sat','under','the','trees'],
    ['The','recording','keeps','the','original','voices'],
  ];
  let sequence=1;
  const utterances=lines.map((words,index)=>`<u id="u${index+1}" start="${index}" end="${index+1}">${words.map((word,position)=>`<tok id="w${sequence++}" start="${(index+position/words.length).toFixed(3)}" end="${(index+(position+1)/words.length).toFixed(3)}">${word}</tok>`).join(' ')}.</u>`).join('\n');
  writeFileSync(join(root,'xmlfiles/interview.xml'),`<TEI><teiHeader><title>${name}</title><note>Synthetic desktop acceptance fixture. No research corpus content.</note><media url="preview.wav"/></teiHeader><text><body><div id="conversation" n="1"><p>${utterances}</p></div></body></text></TEI>`);
  writeFileSync(join(root,'xmlfiles/notes.xml'),'<TEI><teiHeader><title>Field notes — synthetic preview</title></teiHeader><text><body><u id="note1"><tok id="note-token">Remember</tok> <tok id="note-two">context</tok>.</u></body></text></TEI>');
  writeFileSync(join(root,'Other/preserved.bin'),Buffer.from([0,255,12,128,64]));
  const sampleRate=16000,samples=sampleRate*8,bytes=Buffer.alloc(44+samples*2);
  bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(sampleRate,24);bytes.writeUInt32LE(sampleRate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++){const envelope=.25+.2*Math.sin(i/sampleRate*3);bytes.writeInt16LE(Math.round(4500*envelope*Math.sin(2*Math.PI*220*i/sampleRate)),44+i*2)}
  writeFileSync(join(root,'Audio/preview.wav'),bytes);
  return root;
}
