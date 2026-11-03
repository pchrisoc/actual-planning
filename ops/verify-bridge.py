"""Verify Bench-to-bridge access without printing the bridge key or account data."""
from pathlib import Path
import subprocess

script = r"""
const fs = require('node:fs');
const key = fs.readFileSync(0,'utf8').trim();
const url = 'http://bridge:5007/v1/budgets/'+process.env.ACTUAL_BUDGET_SYNC_ID+'/accounts';
(async()=>{
  const denied = await fetch(url);
  if (![401,403].includes(denied.status)) throw new Error('Bridge allowed unauthenticated request');
  const res = await fetch(url, {headers:{'x-api-key':key}});
  if (!res.ok) throw new Error('Bridge read failed: '+res.status);
  const result = await res.json();
  const accounts = Array.isArray(result) ? result : result.data || result.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('Missing accounts');
  console.log('PASS: Bench container reaches authenticated internal bridge; '+accounts.length+' accounts; unauthenticated read denied');
})().catch(e=>{console.error(e.message);process.exitCode=1});
"""
settings = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
subprocess.run(['docker','compose','exec','-T','-e','ACTUAL_BUDGET_SYNC_ID='+settings['ACTUAL_BUDGET_SYNC_ID'],'bench','node','-e',script], input=Path('secrets/bridge_api_key').read_text(), text=True, check=True)
