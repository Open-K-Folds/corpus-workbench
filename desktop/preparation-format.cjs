'use strict';

// A local, deliberately narrow projection. This module performs no filesystem,
// network, ASR, alignment, language detection or normalization operations.
const {createHash}=require('node:crypto');
const {TextDecoder}=require('node:util');

const VERSION='local-transcript/1';
const MAX_TRANSCRIPT_BYTES=2*1024*1024;
const MAX_SOURCE_BYTES=64*1024*1024;
const MAX_TOKENS=50000;
const MAX_TOKEN_BYTES=64*1024;
const MAX_SEGMENTS=10000;
const MAX_XML_BYTES=16*1024*1024;
const AUDIO_TYPES=Object.freeze({wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac',opus:'audio/ogg',webm:'audio/webm'});
const RIGHTS='restricted-local-research; redistribution and training not granted';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message)};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const unsupportedClaims=value=>Object.keys(value).some(key=>['schema','$schema','schemaversion','version','format','formatversion','segments','words','wordtimes','wordtimestamps'].includes(key.toLowerCase().replace(/[-_]/gu,'')));

function sourceName(name){
  if(typeof name!=='string'||!name||name.length>180||/[\\/:\x00-\x1f\x7f]/u.test(name)||name.startsWith('.')||/[. ]$/u.test(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name))fail('Source filenames must be safe basenames.');
  return name;
}

function recordingType(bytes){
  const signature=(value,offset=0)=>bytes.subarray(offset,offset+value.length).equals(Buffer.from(value,'latin1'));
  // Container checks establish a supported header, not decodability, duration or
  // the presence of speech. The original bytes are never transcoded or patched.
  if(bytes.length>=44&&signature('RIFF')&&signature('WAVE',8)){
    const end=bytes.readUInt32LE(4)+8;
    if(end>bytes.length||end<44)fail('WAV container length is invalid.');
    let cursor=12,fmt=false,data=false;
    for(let count=0;cursor+8<=end&&count<256;count++){
      const length=bytes.readUInt32LE(cursor+4),next=cursor+8+length;
      if(next>end)fail('WAV chunk exceeds its container.');
      if(signature('fmt ',cursor)){
        if(length<16)fail('WAV format header is truncated.');
        const encoding=bytes.readUInt16LE(cursor+8),channels=bytes.readUInt16LE(cursor+10),rate=bytes.readUInt32LE(cursor+12);
        if(![1,3,0xfffe].includes(encoding)||!channels||channels>32||!rate||rate>768000||!bytes.readUInt16LE(cursor+20)||!bytes.readUInt16LE(cursor+22))fail('WAV format is unsupported.');
        fmt=true;
      }
      if(signature('data',cursor)&&length>0)data=true;
      cursor=next+(length%2);
    }
    if(fmt&&data)return 'wav';
    fail('WAV requires complete format and nonempty data chunks.');
  }
  if(bytes.length>=42&&signature('fLaC')){
    if((bytes[4]&0x7f)!==0||bytes.readUIntBE(5,3)!==34||(bytes.readUIntBE(18,3)>>>4)===0)fail('FLAC STREAMINFO header is invalid.');
    return 'flac';
  }
  if(bytes.length>=27&&signature('OggS')){
    const segments=bytes[26],start=27+segments;
    if(bytes[4]!==0||!segments||start>bytes.length)fail('OGG page header is invalid.');
    let length=0;for(let index=27;index<start;index++)length+=bytes[index];
    if(!length||start+length>bytes.length)fail('OGG page payload is truncated.');
    if((length>=19&&signature('OpusHead',start))||(length>=30&&bytes[start]===1&&signature('vorbis',start+1)))return 'ogg';
    fail('OGG supports Opus or Vorbis identification headers.');
  }
  if(bytes.length>=24&&signature('ftyp',4)){
    const size=bytes.readUInt32BE(0);
    if(size<16||size>bytes.length||size>4096)fail('M4A file-type header is invalid.');
    const brands=[];for(let cursor=8;cursor+4<=size;cursor+=4){if(cursor!==12)brands.push(bytes.toString('latin1',cursor,cursor+4));}
    if(!brands.some(brand=>['M4A ','M4B ','isom','iso2','mp41','mp42'].includes(brand)))fail('Unsupported MP4 recording brand.');
    let cursor=size,media=false,movie=false;
    for(let count=0;cursor+8<=bytes.length&&count<256;count++){
      let length=bytes.readUInt32BE(cursor),header=8;
      if(length===1){if(cursor+16>bytes.length)fail('M4A box header is truncated.');const wide=bytes.readBigUInt64BE(cursor+8);if(wide>BigInt(bytes.length))fail('M4A box length is invalid.');length=Number(wide);header=16;}
      if(length===0)length=bytes.length-cursor;
      if(length<header||cursor+length>bytes.length)fail('M4A box length is invalid.');
      if(signature('mdat',cursor+4)&&length>header)media=true;
      if(signature('moov',cursor+4)&&length>header)movie=true;
      cursor+=length;
    }
    if(media&&movie)return 'm4a';
    fail('M4A requires movie metadata and nonempty media boxes.');
  }
  if(bytes.length>=7&&bytes[0]===0xff&&(bytes[1]&0xf6)===0xf0){
    const rate=(bytes[2]>>2)&15,channels=((bytes[2]&1)<<2)|(bytes[3]>>6),length=((bytes[3]&3)<<11)|(bytes[4]<<3)|(bytes[5]>>5);
    if(rate<13&&channels&&length>=7&&length<=bytes.length)return 'aac';
    fail('AAC ADTS header is invalid.');
  }
  let first=0;
  if(bytes.length>=10&&signature('ID3')){
    if(![2,3,4].includes(bytes[3])||bytes.subarray(6,10).some(value=>value>127))fail('MP3 ID3 header is invalid.');
    first=10+(bytes[6]<<21)+(bytes[7]<<14)+(bytes[8]<<7)+bytes[9]+((bytes[5]&0x10)?10:0);
    if(first>=bytes.length)fail('MP3 ID3 tag has no audio payload.');
  }
  for(let cursor=first;cursor+4<=bytes.length&&cursor<first+4096;cursor++){
    const a=bytes[cursor],b=bytes[cursor+1],c=bytes[cursor+2],version=(b>>3)&3,layer=(b>>1)&3,bitrate=c>>4,rate=(c>>2)&3;
    if(a===0xff&&(b&0xe0)===0xe0&&version!==1&&layer!==0&&bitrate>0&&bitrate<15&&rate<3){
      // Require enough bytes for a plausible complete first MPEG audio frame.
      const rates=[44100,48000,32000],sampleRate=rates[rate]/(version===3?1:version===2?2:4);
      const table=version===3?(layer===3?[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448]:layer===2?[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384]:[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]):layer===3?[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
      const padding=(c>>1)&1,frame=layer===3?(Math.floor(12*table[bitrate]*1000/sampleRate)+padding)*4:Math.floor((layer===1&&version!==3?72:144)*table[bitrate]*1000/sampleRate)+padding;
      if(frame>=4&&cursor+frame<=bytes.length)return 'mp3';
    }
  }
  if(bytes.length>=32&&bytes.readUInt32BE(0)===0x1a45dfa3){
    const header=bytes.subarray(0,4096);
    if(header.includes(Buffer.from([0x42,0x82,0x84,0x77,0x65,0x62,0x6d]))&&header.includes(Buffer.from([0x18,0x53,0x80,0x67])))return 'webm';
  }
  fail('Recording has no supported WAV, FLAC, OGG, MPEG/MP3, M4A, AAC or WEBM container header.');
}

function xml(value){
  if(typeof value!=='string')fail('Transcript text must be a string.');
  for(const character of value){
    const point=character.codePointAt(0);
    if(!(point===9||point===10||point===13||(point>=0x20&&point<=0xd7ff)||(point>=0xe000&&point<=0xfffd)||(point>=0x10000&&point<=0x10ffff)))fail('Transcript contains characters that XML 1.0 cannot preserve.');
  }
  // Character references prevent XML line-ending and attribute normalization.
  return value.replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/"/gu,'&quot;').replace(/'/gu,'&apos;').replace(/\r/gu,'&#13;').replace(/\n/gu,'&#10;').replace(/\t/gu,'&#9;');
}

function decode(bytes){
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{fail('Transcript must be valid UTF-8; no replacement decoding is performed.');}
}

// JSON.parse accepts duplicate keys. Reject them before using a supplied run's
// source hash, timing or text, and bound nesting before recursive projection.
function parseJson(input){
  const text=input.startsWith('\uFEFF')?input.slice(1):input;
  let cursor=0;
  const space=()=>{while(/[\x20\t\r\n]/u.test(text[cursor]||'\0'))cursor++};
  const string=()=>{
    const start=cursor++;
    while(cursor<text.length){const character=text[cursor++];if(character==='\\'){cursor++;continue}if(character==='"')return JSON.parse(text.slice(start,cursor));}
    fail('Transcript JSON is invalid.');
  };
  const value=depth=>{
    if(depth>64)fail('Transcript JSON nesting exceeds the supported limit.');
    space();
    if(text[cursor]==='{'){
      cursor++;space();const keys=new Set();if(text[cursor]==='}'){cursor++;return}
      while(cursor<text.length){
        space();if(text[cursor]!=='"')fail('Transcript JSON is invalid.');const key=string();
        if(keys.has(key))fail('Transcript JSON contains duplicate object keys.');keys.add(key);
        space();if(text[cursor++]!==':')fail('Transcript JSON is invalid.');value(depth+1);space();
        const next=text[cursor++];if(next==='}')return;if(next!==',')fail('Transcript JSON is invalid.');
      }
    }else if(text[cursor]==='['){
      cursor++;space();if(text[cursor]===']'){cursor++;return}
      while(cursor<text.length){value(depth+1);space();const next=text[cursor++];if(next===']')return;if(next!==',')fail('Transcript JSON is invalid.');}
    }else if(text[cursor]==='"'){string();return}
    else{const start=cursor;while(cursor<text.length&&!/[\x20\t\r\n,\]}]/u.test(text[cursor]))cursor++;if(cursor>start)return}
    fail('Transcript JSON is invalid.');
  };
  try{value(0);space();if(cursor!==text.length)fail('Transcript JSON is invalid.');return JSON.parse(text)}catch(error){
    if(error instanceof Error&&/^Transcript JSON /u.test(error.message))throw error;
    fail('Transcript JSON is invalid.');
  }
}

function seconds(value,label){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>7*24*60*60)fail(`Invalid supplied ${label}; expected finite seconds within seven days.`);
  const micros=Math.round(value*1e6);
  if(Math.abs(value*1e6-micros)>0.0001)fail('Supplied chunk times exceed supported microsecond precision.');
  return micros;
}
const time=micros=>`${Math.floor(micros/1000000)}.${String(micros%1000000).padStart(6,'0')}`;

function transcriptDocument(bytes,format,audioHash){
  const decoded=decode(bytes);
  if(format==='utf8-text')return {kind:'utf8-text/1',texts:[decoded],bounds:null,observed:{},warnings:['Text origin and ASR run metadata are unknown. No timing was supplied.']};
  if(format!=='omnilingual-json')fail('Choose UTF-8 text or supported Omnilingual JSON explicitly.');
  const source=parseJson(decoded);
  if(!object(source))fail('Omnilingual JSON must be an object.');
  if(unsupportedClaims(source))fail('Unsupported Omnilingual schema, version or alignment shape. The documented local wrapper has no version claim.');
  if(own(source,'text')){
    if(Object.keys(source).length!==1||typeof source.text!=='string')fail('Supported Omnilingual server JSON contains only a text string.');
    return {kind:'omniasr-server-json/0.1.0',texts:[source.text],bounds:null,observed:{},warnings:['The supplied Omnilingual server response has no run provenance or timestamps.']};
  }
  if(source.request_endpoint!=='/v1/audio/transcriptions'||source.response_format!=='text'||!Array.isArray(source.chunks))fail('Unsupported Omnilingual JSON. Supply the server text response or the documented local chunk wrapper.');
  if(typeof source.source_sha256!=='string'||!/^[a-f0-9]{64}$/u.test(source.source_sha256)||source.source_sha256!==audioHash)fail('Omnilingual source SHA-256 must match the selected original recording.');
  const duration=seconds(source.decoded_duration_seconds,'decoded duration');
  if(!source.chunks.length||source.chunks.length>MAX_SEGMENTS)fail(`Supply between 1 and ${MAX_SEGMENTS} chunks.`);
  const bounds=[],texts=[];let priorIndex=null,priorEnd=0;
  for(const chunk of source.chunks){
    if(!object(chunk)||!Number.isSafeInteger(chunk.index)||chunk.index<0||(priorIndex!==null&&chunk.index!==priorIndex+1))fail('Supplied chunk indices must be consecutive and ordered.');
    if(unsupportedClaims(chunk))fail('Unsupported chunk schema, version or alignment shape.');
    if(typeof chunk.text!=='string'||chunk.http_status!==200||chunk.error!==null||typeof chunk.empty!=='boolean'||chunk.empty!==(chunk.text.length===0))fail('Every supplied chunk must be a successful text result; failed chunks cannot become transcript text.');
    const start=seconds(chunk.start_seconds,'chunk start'),end=seconds(chunk.end_seconds,'chunk end'),length=seconds(chunk.duration_seconds,'chunk duration');
    if(start>=end||start<priorEnd||end>duration||Math.abs(end-start-length)>1)fail('Supplied chunk bounds are reversed, overlapping, outside the recording or inconsistent with duration.');
    bounds.push({index:chunk.index,start_us:start,end_us:end});texts.push(chunk.text);priorIndex=chunk.index;priorEnd=end;
  }
  const observed={};
  for(const key of ['model','checkpoint','code_version','config_version','run_id','device','dtype','runtime_image_id']){
    if(own(source,key)&&source[key]!==null){if(typeof source[key]!=='string'||source[key].length>1024)fail('Supplied run metadata has an unsupported value.');observed[key]={value:source[key],json_pointer:`/${key}`};}
  }
  if(own(source,'run_started_unix')&&source.run_started_unix!==null){if(typeof source.run_started_unix!=='number'||!Number.isFinite(source.run_started_unix))fail('Supplied run start is invalid.');observed.run_started_unix={value:source.run_started_unix,json_pointer:'/run_started_unix'};}
  if(own(source,'package_versions')&&source.package_versions!==null){
    if(!object(source.package_versions)||Object.keys(source.package_versions).length>100||Object.entries(source.package_versions).some(([key,value])=>key.length>128||typeof value!=='string'||value.length>256))fail('Supplied package versions are invalid.');
    observed.package_versions={value:source.package_versions,json_pointer:'/package_versions'};
  }
  return {kind:'local-omniasr-chunks/1',texts,bounds,observed,warnings:['Times are supplied recording chunk bounds, not word alignment or speech boundaries.','Chunk text is concatenated in source order without inserting separators. Run fields are supplied claims, not independently measured.']};
}

function buildPackage({audioBytes,audioName,transcriptBytes,transcriptName,format,title='Unreviewed local transcript'}={}){
  if(!Buffer.isBuffer(audioBytes)||audioBytes.length===0||audioBytes.length>MAX_SOURCE_BYTES)fail('A nonempty original recording of at most 64 MiB is required.');
  if(!Buffer.isBuffer(transcriptBytes)||!transcriptBytes.length||transcriptBytes.length>MAX_TRANSCRIPT_BYTES)fail(`Transcript must contain 1 to ${MAX_TRANSCRIPT_BYTES} bytes.`);
  sourceName(audioName);sourceName(transcriptName);
  const extension=recordingType(audioBytes);
  if(typeof title!=='string'||!title.trim()||title.length>256)fail('Supply a title of 1 to 256 characters.');
  const escapedTitle=xml(title),audioHash=hash(audioBytes),draft=transcriptDocument(transcriptBytes,format,audioHash);
  let tokenCount=0;
  const wrapped=draft.texts.map(text=>{
    // Validate even separators and successful empty chunks before projection.
    xml(text);
    return (text.match(/\s+|\S+/gu)||[]).map(piece=>{
      const escaped=xml(piece);if(/^\s+$/u.test(piece))return escaped;
      if(Buffer.byteLength(piece,'utf8')>MAX_TOKEN_BYTES)fail('A mechanical token exceeds the 64 KiB editable text limit.');
      if(++tokenCount>MAX_TOKENS)fail(`Transcript exceeds ${MAX_TOKENS} mechanical tokens.`);
      return `<tok id="draft-t${String(tokenCount).padStart(6,'0')}">${escaped}</tok>`;
    }).join('');
  });
  if(!tokenCount)fail('Transcript contains no non-whitespace text.');
  const body=draft.bounds?wrapped.map((text,index)=>`<u id="chunk-${String(index+1).padStart(6,'0')}" start="${time(draft.bounds[index].start_us)}" end="${time(draft.bounds[index].end_us)}">${text}</u>`).join(''):wrapped[0];
  const audioPath=`Audio/recording.${extension}`,rawPath=`Raw/transcript.raw.${format==='utf8-text'?'txt':'json'}`;
  const xmlBytes=Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><TEI><teiHeader><fileDesc><titleStmt><title>${escapedTitle}</title></titleStmt><publicationStmt><p>Unreviewed local transcript. Restricted research copy; redistribution and training not granted.</p></publicationStmt><sourceDesc><p>Exact raw source is retained separately. Display tokens are a mechanical whitespace projection; no word alignment, language, speaker or confidence has been inferred.</p><media mimeType="${AUDIO_TYPES[extension]}" url="${audioPath}"/></sourceDesc></fileDesc></teiHeader><text xml:space="preserve">${body}</text></TEI>`,'utf8');
  if(xmlBytes.length>MAX_XML_BYTES)fail('Generated transcript exceeds the 16 MiB XML limit.');
  const observed={};for(const field of ['model','checkpoint','code_version','config_version','run_id','device','dtype','runtime_image_id','run_started_unix','package_versions'])observed[field]=draft.observed[field]||null;
  const provenance={format:'open-k-folds/local-transcript-preparation',schema:1,adapter:VERSION,input_format:format,source_contract:draft.kind,status:'unreviewed-supplied-transcript',sources:{audio:{path:audioPath,name:audioName,sha256:audioHash,bytes:audioBytes.length},transcript:{path:rawPath,name:transcriptName,sha256:hash(transcriptBytes),bytes:transcriptBytes.length}},asr:{supplied:observed,missing:'Unknown; never inferred from filenames, spelling, recording duration or current runtime.',word_times:null,confidence:null,speaker_assignment:null,language_assignment:null},projection:{path:'xmlfiles/transcript.xml',sha256:hash(xmlBytes),bytes:xmlBytes.length,tokenization:'New local IDs for maximal Unicode non-whitespace spans; no normalization, trimming, punctuation rewrite or alignment.',text_assembly:draft.bounds?'Exact chunk texts concatenated in supplied order with no inserted separators.':'Exact decoded source text.',timing:draft.bounds?'Supplied recording chunk bounds in seconds; not model word or utterance alignment.':'Absent.',chunks:draft.bounds,word_times:null,human_corrections:null,normalized_forms:null},rights:RIGHTS,review:{approved:false,decision:null}};
  provenance.recording={container:extension,mime_type:AUDIO_TYPES[extension],validation:'Bounded container header checks only; no decoding, duration or speech claim.'};
  provenance.asr.time_base=draft.bounds?{unit:'seconds',basis:'Supplied start_seconds and end_seconds field names.'}:null;
  provenance.asr.segmentation=draft.bounds?{source:'/chunks',kind:'Supplied recording chunk intervals; segmentation algorithm unknown.'}:null;
  const definitions={version:1,language_values:{},language_default:null,layers:[{id:'utterance',parent:null,alignment:'interval',overlap:true,containment:false,coverage:false},{id:'token',parent:'utterance',alignment:'optional_interval',overlap:true,containment:true,coverage:false},{id:'language',parent:'token',alignment:'unaligned',overlap:true,containment:false,coverage:false}],rights:RIGHTS,machine_draft_provenance:`Unreviewed supplied transcript; origin is not independently verified. Exact original bytes in ${rawPath}; versioned observed and unknown provenance in Resources/preparation-provenance.json. No inferred word timing, speaker, language, translation or confidence.`};
  const settings='<?xml version="1.0" encoding="UTF-8"?><ttsettings><xmlfile defaultform="form" defaultview="interpret" xpath="//text"><pattributes><forms><item key="form" display="Original supplied source" noedit="1"/><item key="nform" display="Human-corrected form" inherit="form"/><item key="wb_normalized" display="Optional normalized reading"/></forms><tags><item key="variety" display="Language / variety"/><item key="note" display="Reviewer note"/></tags></pattributes></xmlfile><files><item key="xml" display="XML" folder="xmlfiles" extension="*.xml"/></files></ttsettings>';
  const json=value=>Buffer.from(`${JSON.stringify(value,null,2)}\n`,'utf8');
  return {version:VERSION,files:{[audioPath]:Buffer.from(audioBytes),[rawPath]:Buffer.from(transcriptBytes),'xmlfiles/transcript.xml':xmlBytes,'Resources/settings.xml':Buffer.from(settings,'utf8'),'Resources/preparation-provenance.json':json(provenance),'Workbench/definitions.json':json(definitions)},summary:{format,segments:draft.bounds?draft.bounds.length:0,tokens:tokenCount,text:draft.texts.join(''),timing:draft.bounds?'Supplied chunk bounds only; word timing unavailable.':'No timing supplied; word timing unavailable.',warnings:[...draft.warnings,'Unreviewed supplied text. Token IDs are mechanical local identities, not model word IDs.']}};
}

module.exports={buildPackage,VERSION,MAX_TRANSCRIPT_BYTES,MAX_SOURCE_BYTES,MAX_TOKENS,MAX_TOKEN_BYTES,MAX_SEGMENTS,MAX_XML_BYTES};
