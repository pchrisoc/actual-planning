import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const root = process.env.DATA_DIR || '/data';
function expenseMetadata(snapshot) {
  const incomeGroups=new Set((snapshot.groups??[]).filter(g=>g.is_income).map(g=>g.id));
  return {...snapshot,categories:snapshot.categories.map(c=>({...c,is_income:!!c.is_income||incomeGroups.has(c.group_id)}))};
}
export async function withActual(fn) {
  await mkdir(root, {recursive:true, mode:0o700});
  const lock = join(root, 'actual.lock');
  try { await mkdir(lock); } catch (e) { if (e.code === 'EEXIST') throw new Error('Actual worker is busy; retry shortly. A crash may require removing /data/actual.lock after confirming no job is running.'); throw e; }
  let api;
  try {
    api = await import('@actual-app/api');
    await mkdir(join(root, 'cache'), {recursive:true, mode:0o700});
    await api.init({dataDir:join(root, 'cache'), serverURL:process.env.ACTUAL_SERVER_URL, password:(await readFile(process.env.ACTUAL_PASSWORD_FILE, 'utf8')).trim()});
    await api.downloadBudget(process.env.ACTUAL_BUDGET_SYNC_ID);
    return await fn(api);
  } finally {
    try { if (api) await api.shutdown(); } finally { await rm(lock, {recursive:true, force:true}); }
  }
}
export async function state(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Invalid year');
  if (process.env.ACTUAL_SNAPSHOT_FILE) {
    const snapshot=JSON.parse(await readFile(process.env.ACTUAL_SNAPSHOT_FILE,'utf8'));
    return expenseMetadata({...snapshot,year,mode:'snapshot',budgets:(snapshot.budgets??[]).filter(b=>b.month.startsWith(`${year}-`)),freshnessMeaning:'Local snapshot, not a live Actual connection. Write-back is unavailable.'});
  }
  return withActual(async api => {
    const accounts = [];
    for (const a of await api.getAccounts()) accounts.push({id:a.id, name:a.name, offbudget:a.offbudget, closed:a.closed, ledgerBalanceCents:await api.getAccountBalance(a.id), institutionBalanceCents:a.balance_current ?? null});
    const availableMonths = await api.getBudgetMonths();
    const budgets = [];
    for (let i = 1; i <= 12; i++) {
      const month = `${year}-${String(i).padStart(2, '0')}`;
      if (!availableMonths.includes(month)) {budgets.push({month, status:'unavailable'}); continue;}
      try {budgets.push({month, status:'read', budget:await api.getBudgetMonth(month)});} catch {budgets.push({month, status:'read-failed'});}
    }
    const budgetFiles = await api.getBudgets();
    const loaded = budgetFiles.find(b => b.groupId === process.env.ACTUAL_BUDGET_SYNC_ID || b.cloudFileId === process.env.ACTUAL_BUDGET_SYNC_ID || b.id === process.env.ACTUAL_BUDGET_SYNC_ID);
    return expenseMetadata({year,budgetName:loaded?.name ?? 'Configured budget (name unresolved)', syncId:process.env.ACTUAL_BUDGET_SYNC_ID, fetchedAt:new Date().toISOString(), freshnessMeaning:'Time this worker downloaded the server budget; not last bank sync.', accounts, categories:await api.getCategories(), groups:await api.getCategoryGroups(), budgets});
  });
}
export async function exportBackup(api) {
    const bytes = Buffer.from(await api.exportBudget());
    if (bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Export is not a ZIP archive');
    const directory = join(root, 'backups');
    await mkdir(directory, {recursive:true, mode:0o700});
    const file = `budget-${new Date().toISOString().replaceAll(':', '-')}.zip`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(directory, file), bytes, {mode:0o600, flag:'wx'});
    const audit = {file, bytes:bytes.length, sha256, createdAt:new Date().toISOString(), validation:'ZIP signature and SHA256; restore has not been tested'};
    await writeFile(join(directory, `${file}.json`), JSON.stringify(audit, null, 2), {mode:0o600});
    return audit;
}
export async function backup() {return withActual(exportBackup);}
