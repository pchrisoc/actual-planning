import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';

export function planName(value) {
  if(typeof value!=='string')throw new Error('Enter a plan name before saving');
  const name=value.trim().replace(/\s+/g,' ');
  if(!name)throw new Error('Enter a plan name before saving');
  if(name.length>120)throw new Error('Plan names must be 120 characters or fewer');
  return name;
}

export async function listPlans(directory) {
  const files=(await readdir(directory)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));
  const plans=await Promise.all(files.map(async file=>{
    const saved=JSON.parse(await readFile(join(directory,file),'utf8'));
    const createdAt=Number.isFinite(Date.parse(saved.createdAt))?saved.createdAt:null;
    const name=[saved.name,saved.input?.name].find(value=>typeof value==='string'&&value.trim())?.trim()||`Unnamed plan${saved.input?.year?' '+saved.input.year:''}`;
    return {id:file.slice(0,-5),name,createdAt};
  }));
  return plans.sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||b.id.localeCompare(a.id));
}
