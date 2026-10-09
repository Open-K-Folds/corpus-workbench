'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Registry}=require('../registry.cjs');

test('recent projects round-trip without exposing paths and deduplicate exact authority',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-registry-test-'));
  try{
    const registry=await new Registry(root).load();
    const first=await registry.remember(path.join(root,'authority-a'),'preview','First preview');
    await registry.remember(path.join(root,'authority-b'),'preview','Another authority');
    const reopened=await registry.remember(path.join(root,'authority-a'),'preview','Reopened preview');
    assert.equal(reopened.id,first.id);assert.equal(registry.data.recent.length,2);
    const restored=await new Registry(root).load();assert.equal(restored.data.current,first.id);
    assert.deepEqual(restored.get(first.id),reopened);
    assert.equal(JSON.stringify(restored.publicRecent()).includes(root),false);
    for(let i=0;i<23;i++)await restored.remember(path.join(root,'extra-'+i),'project-'+i,'Synthetic '+i);
    assert.equal((await new Registry(root).load()).data.recent.length,20);
    assert.deepEqual((await fs.readdir(root)).filter(name=>name.endsWith('.tmp')),[]);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('invalid registry is preserved rather than silently overwritten',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-registry-invalid-'));
  try{
    const file=path.join(root,'desktop-projects.json'),raw='{"schema":1,"recent":[{"store":"relative/path"}]}';
    await fs.writeFile(file,raw);await assert.rejects(()=>new Registry(root).load(),/preserved/);
    assert.equal(await fs.readFile(file,'utf8'),raw);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
