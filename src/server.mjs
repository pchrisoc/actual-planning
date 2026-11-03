import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {savings, debt} from './models.mjs';
import {state, root, withActual, exportBackup} from './actual.mjs';
import {calculatePlan, buildAllocations} from './planning.mjs';
import {inspectAllocations, applyAllocations} from './budget-actions.mjs';
import {planName,listPlans} from './saved-plans.mjs';
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const scenarioRoot = join(root, 'scenarios');
await mkdir(scenarioRoot, {recursive:true, mode:0o700});
let busy = false;
const writeEnabled=process.env.ACTUAL_WRITE_ENABLED==='true'&&!process.env.ACTUAL_SNAPSHOT_FILE;
const storedRoot=join(root,'budget-jobs');
await mkdir(storedRoot,{recursive:true,mode:0o700});
const calculate=input=>input.version===2?calculatePlan(input):{savings:savings(input.savings),debt:debt(input.debt)};
function send(res, status, data) {res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(data));}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON required');
  let size = 0, parts = [];
  for await (const chunk of req) {size += chunk.length; if (size > 65536) throw new Error('Request too large'); parts.push(chunk);}
  return JSON.parse(Buffer.concat(parts).toString());
}
createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') return send(res, 200, {status:'running', actualWriteEnabled:writeEnabled});
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, {error:'Origin rejected'}); }
    catch { return send(res, 403, {error:'Origin rejected'}); }
  }
  try {
    if (req.method === 'GET' && ['/','/app.js','/overview.mjs','/style.css'].includes(url.pathname)) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      res.writeHead(200, {'Content-Type':file.endsWith('html') ? 'text/html' : file.endsWith('js') ? 'text/javascript' : 'text/css', 'Cache-Control':'no-store'});
      return res.end(await readFile(join(publicRoot, file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/actual/state') {
      if (busy) return send(res, 409, {error:'Worker busy; retry shortly'});
      busy = true;
      try {return send(res, 200, await state(Number(url.searchParams.get('year') || new Date().getUTCFullYear())));} finally {busy = false;}
    }
    if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{actualWriteEnabled:writeEnabled,snapshot:!!process.env.ACTUAL_SNAPSHOT_FILE});
    if(req.method==='POST'&&url.pathname==='/api/actual/preview'){
      const input=await body(req);
      const plan=calculatePlan(input.plan);
      const actual=await state(plan.year);
      const allocations=buildAllocations(plan,input.mappings,input.months,actual.categories,{preserveStartMonth:input.preserveStartMonth!==false});
      const adapter={getCategories:async()=>actual.categories,getBudgetMonth:async month=>{const b=actual.budgets.find(b=>b.month===month&&b.status==='read');if(!b)throw new Error('Unavailable');return b.budget;}};
      const preview=await inspectAllocations(adapter,allocations);
      const id=randomUUID();
      const record={...preview,policyVersion:5,planFingerprint:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),id,createdAt:new Date().toISOString(),syncId:process.env.ACTUAL_BUDGET_SYNC_ID??actual.syncId};
      await writeFile(join(storedRoot,`preview-${id}.json`),JSON.stringify(record),{mode:0o600,flag:'wx'});
      return send(res,200,{...record,writeEnabled,reason:process.env.ACTUAL_SNAPSHOT_FILE?'Local snapshot; reconnect to Actual for a fresh, writable preview.':!writeEnabled?'Actual write-back is disabled in this environment.':null});
    }
    if(req.method==='POST'&&url.pathname==='/api/export/pdf'){
      const input=await body(req),plan=calculatePlan(input.plan);
      let preview=null;
      if(input.previewId){
        if(!/^[-a-f0-9]{36}$/.test(input.previewId))throw new Error('Invalid preview ID');
        preview=JSON.parse(await readFile(join(storedRoot,`preview-${input.previewId}.json`),'utf8'));
        if(preview.planFingerprint!==createHash('sha256').update(JSON.stringify(plan)).digest('hex'))throw new Error('Plan changed. Populate selected values again before exporting its preview.');
      }
      const {renderPlanPdf}=await import('./report.mjs');
      const bytes=await renderPlanPdf({input:input.plan,plan,preview});
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="actual-plan-${plan.year}.pdf"`,'Cache-Control':'no-store'});return res.end(bytes);
    }
    if(req.method==='POST'&&url.pathname==='/api/actual/apply'){
      if(!writeEnabled)return send(res,403,{error:'Actual write-back is disabled in this environment'});
      const input=await body(req);
      if(input.confirmed!==true||!/^[-a-f0-9]{36}$/.test(input.previewId)||!/^[-a-f0-9]{36}$/.test(input.idempotencyKey))return send(res,400,{error:'Confirm a valid preview and request key'});
      const key=createHash('sha256').update(input.idempotencyKey).digest('hex'),jobPath=join(storedRoot,`job-${key}.json`);
      return await withActual(async api=>{
        try{const previous=JSON.parse(await readFile(jobPath,'utf8'));if(previous.previewId!==input.previewId)throw new Error('Request key belongs to a different preview');if(previous.status==='verified')return send(res,200,previous);return send(res,409,{error:'This request was already attempted. Inspect its audit before retrying.',job:previous});}catch(error){if(error.code!=='ENOENT')throw error;}
        const preview=JSON.parse(await readFile(join(storedRoot,`preview-${input.previewId}.json`),'utf8'));
        if(preview.policyVersion!==5||Date.now()-Date.parse(preview.createdAt)>30*60*1000||preview.syncId!==process.env.ACTUAL_BUDGET_SYNC_ID)throw new Error('Preview expired or policy changed. Populate a fresh preview.');
        const job={previewId:preview.id,createdAt:new Date().toISOString(),status:'started',before:preview.cells};
        await writeFile(jobPath,JSON.stringify(job),{mode:0o600,flag:'wx'});
        try{Object.assign(job,await applyAllocations(api,preview,{allowOverwrite:input.allowOverwrite===true,backup:async client=>{const artifact=await exportBackup(client);job.backup=artifact;await writeFile(jobPath,JSON.stringify(job),{mode:0o600});return artifact;}}));}
        catch(error){job.status='failed';job.error=error.message;}
        await writeFile(jobPath,JSON.stringify(job),{mode:0o600});
        return send(res,job.status==='verified'?200:409,job);
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/calculate') {
      const input = await body(req);
      return send(res, 200, calculate(input));
    }
    if (req.method === 'POST' && url.pathname === '/api/scenarios') {
      const input = await body(req);
      const name = planName(input.name);
      input.name = name;
      const result = calculate(input);
      const id = randomUUID();
      const scenario = {id, name, createdAt:new Date().toISOString(), input, result};
      await writeFile(join(scenarioRoot, `${id}.json`), JSON.stringify(scenario), {mode:0o600, flag:'wx'});
      return send(res, 201, scenario);
    }
    if (req.method === 'GET' && url.pathname === '/api/scenarios') {const scenarios=await listPlans(scenarioRoot);return send(res,200,{scenarios,ids:scenarios.map(s=>s.id)});}
    if (req.method === 'GET' && /^\/api\/scenarios\/[a-f0-9-]{36}$/.test(url.pathname)) return send(res, 200, JSON.parse(await readFile(join(scenarioRoot, `${url.pathname.split('/').at(-1)}.json`), 'utf8')));
    return send(res, 404, {error:'Route unavailable; Actual write-back is not implemented'});
  } catch (error) {
    const actualRoute = url.pathname.startsWith('/api/actual/');
    return send(res, actualRoute ? 503 : 400, {error:actualRoute ? 'Actual read failed. Check credentials, connectivity, and worker lock on the server.' : error.message});
  }
}).listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0');
