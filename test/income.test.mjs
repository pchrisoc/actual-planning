import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePlan,buildAllocations} from '../src/planning.mjs';
import {inspectAllocations,applyAllocations} from '../src/budget-actions.mjs';
const input=()=>({version:2,year:2027,annualGrossCents:10400000,firstPayDate:'2027-01-01',frequency:'weekly',k401:{limitCents:2450000,ytdCents:0,targetDate:'2027-10-01'},ira:{limitCents:750000,ytdCents:0,targetDate:'2027-08-01'},employer:{mode:'match',ratePct:50,matchSalaryCapPct:6,annualCapCents:null,ytdCents:0},loans:[]});
const categories=[{id:'income',name:'Income',is_income:true},{id:'expense',name:'Roth IRA'}];
const mappings=[{source:'income',categoryId:'income'}];
test('salary income populates exact annual gross across all anchored pay dates',()=>{
 const plan=calculatePlan(input()),cells=buildAllocations(plan,mappings,plan.monthly.map(m=>m.month),categories);
 assert.equal(cells.reduce((sum,c)=>sum+c.amountCents,0),10400000);
 assert.equal(cells[0].amountCents,plan.monthly[0].grossCents);assert.notEqual(cells[0].amountCents,cells[1].amountCents);
 assert.ok(cells.every(c=>c.kind==='income'));
 assert.ok(cells.reduce((sum,c)=>sum+c.amountCents,0)>plan.rows.reduce((sum,r)=>sum+r.grossAfterDeferralCents,0));
});
test('monthly income rounds cents exactly and salary edits recalculate without changing source mappings',()=>{
 const p=input();p.frequency='monthly';p.annualGrossCents=12000001;
 let plan=calculatePlan(p),cells=buildAllocations(plan,mappings,plan.monthly.map(m=>m.month),categories);
 assert.equal(cells[0].amountCents,1000001);assert.equal(cells[1].amountCents,1000000);assert.equal(cells.reduce((sum,c)=>sum+c.amountCents,0),12000001);
 p.annualGrossCents=24000000;plan=calculatePlan(p);assert.equal(buildAllocations(plan,mappings,['2027-02'],categories)[0].amountCents,2000000);
});
test('midyear income includes only remaining pay dates and supports deliberate start-month replacement',()=>{
 const p=input();p.firstPayDate='2027-04-15';const plan=calculatePlan(p),cells=buildAllocations(plan,mappings,['2027-04','2027-05'],categories);
 assert.equal(cells[0].amountCents,plan.rows.filter(r=>r.date.startsWith('2027-04')).reduce((sum,r)=>sum+r.grossCents,0));assert.equal(cells[0].preserveExisting,true);
 assert.equal(buildAllocations(plan,mappings,['2027-04'],categories,{preserveStartMonth:false})[0].preserveExisting,false);
 assert.throws(()=>buildAllocations(plan,mappings,['2027-03'],categories),/on or after/);
});
test('income and expense source/category types cannot be crossed or combined',()=>{
 const plan=calculatePlan(input());
 assert.throws(()=>buildAllocations(plan,[{source:'income',categoryId:'expense'}],['2027-01'],categories),/income category/);
 assert.throws(()=>buildAllocations(plan,[{source:'ira',categoryId:'income'}],['2027-01'],categories),/expense category/);
 const cells=buildAllocations(plan,[...mappings,{source:'ira',categoryId:'expense'}],['2027-01'],categories);
 assert.deepEqual(cells.map(c=>c.kind),['income','expense']);
});
test('income previews use income-group metadata, preserve overwrite approval, back up and verify writes',async()=>{
 let value=388300,writes=0,backed=false;
 const api={getCategories:async()=>[{id:'income',name:'Income',group_id:'income-group'},{id:'expense',name:'Roth'}],getCategoryGroups:async()=>[{id:'income-group',is_income:true}],getBudgetMonth:async()=>({categoryGroups:[{is_income:true,categories:[{id:'income',budgeted:value}]}]}),setBudgetAmount:async(month,id,amount)=>{assert.ok(backed);assert.equal(id,'income');value=amount;writes++;},sync:async()=>{}};
 const allocation={month:'2027-01',categoryId:'income',kind:'income',amountCents:800000};
 await assert.rejects(()=>inspectAllocations(api,[{...allocation,kind:'expense'}]),/category type/);
 await assert.rejects(()=>inspectAllocations(api,[{...allocation,categoryId:'expense'}]),/category type/);
 const preview=await inspectAllocations(api,[allocation]);assert.equal(preview.cells[0].categoryName,'Gross income / Income');assert.equal(preview.cells[0].beforeCents,388300);assert.equal(writes,0);
 await assert.rejects(()=>applyAllocations(api,preview,{allowOverwrite:false,backup:async()=>{throw new Error('Must not backup');}}),/Confirm/);
 const result=await applyAllocations(api,preview,{allowOverwrite:true,backup:async()=>{backed=true;return {file:'test-backup.zip'};}});
 assert.equal(result.status,'verified');assert.equal(value,800000);assert.equal(writes,1);
});
