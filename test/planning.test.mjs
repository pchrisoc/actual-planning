import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePlan,payCalendar,buildAllocations} from '../src/planning.mjs';
import {inspectAllocations,applyAllocations} from '../src/budget-actions.mjs';
export const example=()=>({version:2,year:2027,annualGrossCents:10400000,firstPayDate:'2027-01-01',frequency:'weekly',k401:{limitCents:2450000,ytdCents:0,targetDate:'2027-10-01'},ira:{limitCents:750000,ytdCents:0,targetDate:'2027-08-01'},employer:{mode:'match',ratePct:50,matchSalaryCapPct:6,annualCapCents:300000,ytdCents:0},loans:[]});
test('53 anchored weekly dates preserve annual gross and exact retirement limits',()=>{
  const result=calculatePlan(example());
  assert.equal(payCalendar(2027,'2027-01-01','weekly').length,53);
  assert.equal(result.rows.reduce((s,r)=>s+r.grossCents,0),10400000);
  assert.equal(result.employee401kCents,2450000);
  assert.equal(result.iraContributionCents,750000);
  assert.ok(result.k401FinishDate<='2027-10-01');
  assert.ok(result.rows.filter(r=>r.date>'2027-10-01').every(r=>r.k401Cents===0&&r.grossAfterDeferralCents===r.grossCents));
  assert.ok(result.rows.filter(r=>r.date>'2027-08-01').every(r=>r.iraCents===0));
});
test('monthly dates clamp February without drifting and aggregate by actual month',()=>{
  const p=example();p.frequency='monthly';p.firstPayDate='2027-01-31';
  const r=calculatePlan(p);assert.equal(r.rows[1].date,'2027-02-28');assert.equal(r.rows[2].date,'2027-03-31');
  assert.notEqual(calculatePlan(example()).monthly[0].grossCents,calculatePlan(example()).monthly[1].grossCents);
});
test('YTD contributions reduce remaining funding with exact cent rounding',()=>{
  const p=example();p.k401.ytdCents=2449999;p.ira.ytdCents=749998;
  const r=calculatePlan(p);assert.equal(r.employee401kCents,1);assert.equal(r.iraContributionCents,2);
  assert.equal(r.rows.filter(x=>x.k401Cents>0).length,1);
});
test('employer match uses eligible compensation cap and stays separate from employee cap',()=>{
  const p=example();p.frequency='monthly';p.annualGrossCents=12000000;p.k401.targetDate='2027-12-31';p.employer.annualCapCents=100000;p.employer.ytdCents=25000;
  const r=calculatePlan(p);assert.equal(r.rows[0].employerCents,30000);assert.equal(r.employerContributionCents,75000);assert.equal(r.employee401kCents,2450000);
});
test('salary-based employer contribution continues after employee max-out',()=>{
  const p=example();p.employer={mode:'salary',ratePct:3,matchSalaryCapPct:0,annualCapCents:null,ytdCents:0};
  const r=calculatePlan(p);assert.ok(r.rows.at(-1).employerCents>0);assert.equal(r.rows.at(-1).k401Cents,0);
});
test('editable tax rate calculates estimated taxes and post-tax pay after 401(k)',()=>{
  const p=example();p.frequency='monthly';p.annualGrossCents=12000000;p.taxRatePct=25;p.k401.targetDate='2027-06-30';
  const r=calculatePlan(p);
  assert.equal(r.taxRatePct,25);
  assert.equal(r.totalTaxCents,r.monthly.reduce((sum,m)=>sum+m.taxCents,0));
  assert.equal(r.totalNetPayCents,r.monthly.reduce((sum,m)=>sum+m.netPayCents,0));
  assert.equal(r.totalTaxCents,r.rows.reduce((sum,row)=>sum+Math.round(row.grossAfterDeferralCents*.25),0));
  assert.equal(r.totalNetPayCents,12000000-2450000-r.totalTaxCents);
  assert.equal(r.rows[0].netPayCents,r.rows[0].grossCents-r.rows[0].k401Cents-r.rows[0].taxCents);
  assert.equal(calculatePlan({...p,taxRatePct:0}).totalTaxCents,0);
  assert.throws(()=>calculatePlan({...p,taxRatePct:100.1}),/Estimated tax rate/);
});
test('legacy plans without a tax rate use the editable California estimate default',()=>{
  const p=example();delete p.taxRatePct;
  const r=calculatePlan(p);assert.equal(r.taxRatePct,25);assert.ok(r.totalTaxCents>0);assert.ok(r.totalNetPayCents<r.rows.reduce((sum,row)=>sum+row.grossAfterDeferralCents,0));
});
test('impossible 401(k) goal is flagged and cannot consume more than gross',()=>{
  const p=example();p.annualGrossCents=10000;
  const r=calculatePlan(p);assert.ok(r.rows.every(x=>x.k401Cents<=x.grossCents));assert.ok(r.warnings.some(x=>x.includes('not reachable')));
});
test('multiple loans calculate payoff payments independently and cap final payment',()=>{
  const p=example();p.loans=[{id:'a',name:'Zero APR',balanceCents:120000,aprPct:0,targetDate:'2027-12-31',monthlyPaymentCents:0},{id:'b',name:'Interest loan',balanceCents:100000,aprPct:12,targetDate:'2027-12-31',monthlyPaymentCents:51000}];
  const r=calculatePlan(p);assert.equal(r.loans[0].monthlyPaymentCents,10000);assert.equal(r.loans[0].remainingCents,0);assert.equal(r.loans[1].totalInterestCents,1500);assert.equal(r.loans[1].payments[1].paymentCents,50500);assert.equal(r.monthly[1].loanPaymentsCents,60500);
});
test('selected mappings sum IRA and loans into one category and respect chosen months',()=>{
  const p=example();p.loans=[{id:'a',name:'Loan',balanceCents:120000,aprPct:0,targetDate:'2027-12-31',monthlyPaymentCents:0}];
  const plan=calculatePlan(p),categories=[{id:'x',name:'Retirement and debt'}];
  const cells=buildAllocations(plan,[{source:'ira',categoryId:'x'},{source:'loan:a',categoryId:'x'}],['2027-01'],categories);
  assert.equal(cells.length,1);assert.equal(cells[0].amountCents,plan.monthly[0].iraCents+10000);
  assert.throws(()=>buildAllocations(plan,[{source:'401k',categoryId:'x'}],['2027-01'],categories));
});
test('rejects bad dates, YTD above limit, and duplicate loan IDs',()=>{
  let p=example();p.firstPayDate='2027-02-30';assert.throws(()=>calculatePlan(p));
  p=example();p.ira.ytdCents=750001;assert.throws(()=>calculatePlan(p));
  p=example();p.loans=[{id:'x',name:'Loan',balanceCents:1,aprPct:0,targetDate:'2027-12-31',monthlyPaymentCents:1}];p.loans.push({...p.loans[0]});assert.throws(()=>calculatePlan(p));
});
function fake(){let value=100,writes=0,syncs=0;return {api:{getCategories:async()=>[{id:'c',name:'Roth'}],getBudgetMonth:async month=>{if(month==='2027-12')throw new Error('Unavailable');return {categoryGroups:[{categories:[{id:'c',budgeted:value}]}]};},setBudgetAmount:async(m,c,v)=>{value=v;writes++;},sync:async()=>{syncs++;}},change:v=>value=v,stats:()=>({value,writes,syncs})};}
test('budget preview is read-only; applying requires overwrite approval and backs up before writes',async()=>{
  const f=fake(),p=await inspectAllocations(f.api,[{month:'2027-01',categoryId:'c',amountCents:500}]);
  assert.equal(f.stats().writes,0);assert.equal(p.cells[0].deltaCents,400);
  await assert.rejects(()=>applyAllocations(f.api,p,{allowOverwrite:false,backup:async()=>{throw Error('Should not back up');}}));
  let backed=false;const set=f.api.setBudgetAmount;f.api.setBudgetAmount=async(...args)=>{assert.ok(backed);return set(...args);};
  const result=await applyAllocations(f.api,p,{allowOverwrite:true,backup:async()=>{backed=true;return {file:'backup.zip'};}});
  assert.equal(result.status,'verified');assert.deepEqual(f.stats(),{value:500,writes:1,syncs:1});
});
test('stale previews and unreadable months are rejected before writes',async()=>{
  const f=fake(),cells=[{month:'2027-01',categoryId:'c',amountCents:500}],p=await inspectAllocations(f.api,cells);f.change(101);
  await assert.rejects(()=>applyAllocations(f.api,p,{allowOverwrite:true,backup:async()=>({})}),/changed/);
  const future=await inspectAllocations(f.api,[{...cells[0],month:'2027-12'}]);assert.equal(future.canApply,false);
  await assert.rejects(()=>applyAllocations(f.api,future,{allowOverwrite:true,backup:async()=>({})}),/Unreadable/);assert.equal(f.stats().writes,0);
});
test('failed write propagates instead of reporting success',async()=>{
  const f=fake(),p=await inspectAllocations(f.api,[{month:'2027-01',categoryId:'c',amountCents:500}]);f.api.setBudgetAmount=async()=>{throw new Error('write failed');};
  await assert.rejects(()=>applyAllocations(f.api,p,{allowOverwrite:true,backup:async()=>({})}),/write failed/);assert.equal(f.stats().syncs,0);
});
test('income-group categories are excluded even when category-level income flag is absent',async()=>{
  const f=fake();f.api.getCategories=async()=>[{id:'c',name:'Income',group_id:'income'}];f.api.getCategoryGroups=async()=>[{id:'income',is_income:true}];
  await assert.rejects(()=>inspectAllocations(f.api,[{month:'2027-01',categoryId:'c',amountCents:500}]),/Invalid/);
  assert.equal(f.stats().writes,0);
});
test('mid-month plans preserve an existing April allocation instead of clearing an earlier payment',async()=>{
  const p=example();p.firstPayDate='2027-04-15';p.loans=[{id:'loan',name:'Loan',balanceCents:120000,aprPct:0,targetDate:'2028-04-02',monthlyPaymentCents:0}];
  const plan=calculatePlan(p),allocations=buildAllocations(plan,[{source:'loan:loan',categoryId:'c'}],['2027-04','2027-05'],[{id:'c'}]);
  assert.equal(allocations[0].amountCents,0);
  const f=fake();f.change(15000);
  const preview=await inspectAllocations(f.api,allocations);
  assert.equal(preview.cells[0].amountCents,15000);assert.equal(preview.cells[0].forecastAmountCents,0);assert.equal(preview.cells[0].deltaCents,0);assert.equal(preview.cells[0].preserved,true);
  assert.equal(preview.cells[1].amountCents,10000);assert.equal(preview.cells[1].preserved,false);
});
test('partial-month protection keeps funded IRA amounts without altering contribution forecasts',async()=>{
  const p=example();p.firstPayDate='2027-04-15';p.ira.targetDate='2027-10-01';
  const plan=calculatePlan(p),allocations=buildAllocations(plan,[{source:'ira',categoryId:'c'}],['2027-04'],[{id:'c'}]);
  const f=fake();f.change(100000);const preview=await inspectAllocations(f.api,allocations);
  assert.equal(preview.cells[0].forecastAmountCents,90000);assert.equal(preview.cells[0].amountCents,100000);assert.equal(plan.iraContributionCents,750000);
  f.change(0);const empty=await inspectAllocations(f.api,allocations);assert.equal(empty.cells[0].amountCents,90000);assert.equal(empty.cells[0].preserved,false);
});
test('start-month replacement requires opting out; plans beginning on the first retain normal behavior',async()=>{
  const p=example();p.firstPayDate='2027-04-15';const plan=calculatePlan(p),f=fake();f.change(100000);
  const optedOut=buildAllocations(plan,[{source:'ira',categoryId:'c'}],['2027-04'],[{id:'c'}],{preserveStartMonth:false});
  assert.equal((await inspectAllocations(f.api,optedOut)).cells[0].amountCents,plan.monthly[3].iraCents);
  p.firstPayDate='2027-04-01';const fromFirst=buildAllocations(calculatePlan(p),[{source:'ira',categoryId:'c'}],['2027-04'],[{id:'c'}]);assert.equal(fromFirst[0].preserveExisting,false);
});
test('preserved allocations are not written and a changed preserved value invalidates its preview',async()=>{
  const f=fake(),allocation=[{month:'2027-04',categoryId:'c',amountCents:0,preserveExisting:true}];
  const preview=await inspectAllocations(f.api,allocation);
  const job=await applyAllocations(f.api,preview,{allowOverwrite:false,backup:async()=>({file:'backup.zip'})});assert.equal(job.status,'verified');assert.equal(f.stats().writes,0);
  f.change(101);await assert.rejects(()=>applyAllocations(f.api,preview,{allowOverwrite:false,backup:async()=>({})}),/changed/);
});
test('months before the plan start cannot clear historical allocations',()=>{
  const p=example();p.firstPayDate='2027-04-15';
  assert.throws(()=>buildAllocations(calculatePlan(p),[{source:'ira',categoryId:'c'}],['2027-01'],[{id:'c'}]),/on or after/);
});
