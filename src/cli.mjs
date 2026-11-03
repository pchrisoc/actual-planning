import {state, backup} from './actual.mjs';
try {
  const command = process.argv[2];
  const result = command === 'backup' ? await backup() : command === 'state' ? await state(Number(process.argv[3] || new Date().getUTCFullYear())) : null;
  if (!result) throw new Error('Use backup or state [year]');
  if (command === 'state' && process.argv.includes('--summary')) console.log(JSON.stringify({budgetName:result.budgetName, fetchedAt:result.fetchedAt, accounts:result.accounts.length, categories:result.categories.length, monthsRead:result.budgets.filter(b=>b.status === 'read').length}));
  else console.log(JSON.stringify(result));
} catch { console.error('Actual job failed; inspect connection settings, permissions, and worker lock.'); process.exitCode = 1; }
