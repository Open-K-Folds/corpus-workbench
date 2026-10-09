'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Journal,validateJournal}=require('../journal.cjs');

function record(){
  const id='draft-'+randomUUID();
  const draft={schema:1,id,authority:'a'.repeat(64),actor:'local',project:'synthetic',document:'xmlfiles/interview.xml',revision:1,snapshot:'b'.repeat(64),artifact:'c'.repeat(64),config:1,layer:'corrected',ids:['w2'],internalIds:['w2'],readings:['walked'],start:0,end:6,backward:true,quote:'walked',before:'walked',prefix:'',suffix:'',replacement:'strolled',command:null,updated:Date.now()};
  draft.command={schema:1,project:draft.project,command_id:'cmd-'+randomUUID(),base_revision:draft.revision,preimage_hash:draft.snapshot,config_version:draft.config,label:'Correct w2 in place',operations:[{kind:'set_token',document:draft.document,token:'w2',fields:{nform:draft.replacement}}]};
  return draft;
}

test('native journal acknowledges exact command bytes and lineage before fresh-process read',async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-journal-'));
  try{
    const draft=record(),raw=JSON.stringify({[draft.id]:draft});
    const journal=new Journal(profile);assert.equal(await journal.read(),null);
    assert.equal(await journal.write(raw),true);
    assert.equal(await new Journal(profile).read(),raw);
    const restored=validateJournal(raw)[draft.id];assert.deepEqual(restored.command,draft.command);assert.equal(restored.authority,draft.authority);
    await Promise.all([journal.write(raw),journal.write('{}')]);
    assert.equal(await new Journal(profile).read(),'{}');
    assert.deepEqual((await fs.readdir(journal.directory)).filter(name=>name.endsWith('.tmp')),[]);
  }finally{await fs.rm(profile,{recursive:true,force:true})}
});

test('native journal refuses malformed command identity and keeps its valid prior record',async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-journal-binding-'));
  try{
    const draft=record(),journal=new Journal(profile),raw=JSON.stringify({[draft.id]:draft});await journal.write(raw);
    for(const change of [{base_revision:2},{command_id:'new-command'},{operations:[{kind:'restore',revision:1}]},{project:'other-authority'}]){
      const bad={...draft,command:{...draft.command,...change}};
      assert.throws(()=>journal.write(JSON.stringify({[bad.id]:bad})),/original correction command/);
    }
    assert.throws(()=>journal.write('['),/JSON/);
    assert.throws(()=>journal.write('x'.repeat(1024*1024+1)),/size limit/);
    assert.equal(await new Journal(profile).read(),raw);
  }finally{await fs.rm(profile,{recursive:true,force:true})}
});

test('unrecognized disk journal remains intact and cannot be replaced by an empty renderer journal',async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-journal-preserve-'));
  try{
    const journal=new Journal(profile),raw='{"unrecognized":"retained synthetic evidence"}';
    await fs.mkdir(journal.directory,{recursive:true});await fs.writeFile(journal.file,raw);
    await assert.rejects(()=>journal.read(),/preserved/);
    await assert.rejects(()=>journal.write('{}'),/preserved/);
    assert.equal(await fs.readFile(journal.file,'utf8'),raw);
  }finally{await fs.rm(profile,{recursive:true,force:true})}
});

test('successful recovery retry restores writes after a failed journal read',async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-journal-retry-'));
  try{
    const journal=new Journal(profile),draft=record(),raw=JSON.stringify({[draft.id]:draft});
    await fs.mkdir(journal.directory,{recursive:true});await fs.writeFile(journal.file,'{"unrecognized":"preserve until repaired"}');
    await assert.rejects(()=>journal.read(),/preserved/);
    await assert.rejects(()=>journal.write(raw),/preserved/);
    await fs.writeFile(journal.file,'{}');
    assert.equal(await journal.read(),'{}');
    assert.equal(await journal.write(raw),true);
    assert.equal(await new Journal(profile).read(),raw);
  }finally{await fs.rm(profile,{recursive:true,force:true})}
});
