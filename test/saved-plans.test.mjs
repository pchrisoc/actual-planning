import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planName,listPlans} from '../src/saved-plans.mjs';

test('saved names are required, normalized and length limited',()=>{
  assert.equal(planName('  House   and retirement  '),'House and retirement');
  for(const value of [undefined,null,12,'',' \n ', 'x'.repeat(121)])assert.throws(()=>planName(value));
  assert.equal(planName('x'.repeat(120)).length,120);
});

test('saved plans sort by creation time rather than UUID, name or modification time',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'actual-plan-names-'));
  try{
    const oldId='ffffffff-ffff-4fff-8fff-ffffffffffff',newId='00000000-0000-4000-8000-000000000000';
    await writeFile(join(directory,oldId+'.json'),JSON.stringify({name:'Z old plan',createdAt:'2026-10-01T12:00:00.000Z',input:{year:2027}}));
    await writeFile(join(directory,newId+'.json'),JSON.stringify({name:'A new plan',createdAt:'2026-11-01T12:00:00.000Z',input:{year:2027}}));
    await utimes(join(directory,oldId+'.json'),new Date('2026-12-01'),new Date('2026-12-01'));
    const plans=await listPlans(directory);
    assert.deepEqual(plans.map(p=>p.id),[newId,oldId]);assert.equal(plans[0].name,'A new plan');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('legacy unnamed plans receive a readable label without rewriting their contents',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'actual-plan-legacy-'));
  try{
    const id='11111111-1111-4111-8111-111111111111',original=JSON.stringify({id,createdAt:'2026-11-01T12:34:56.000Z',input:{version:2,year:2027}});
    await writeFile(join(directory,id+'.json'),original);
    const plans=await listPlans(directory);assert.equal(plans[0].name,'Unnamed plan 2027');assert.equal(plans[0].createdAt,'2026-11-01T12:34:56.000Z');assert.equal(plans[0].id,id);
    const {readFile}=await import('node:fs/promises');assert.equal(await readFile(join(directory,id+'.json'),'utf8'),original);
  }finally{await rm(directory,{recursive:true,force:true});}
});
