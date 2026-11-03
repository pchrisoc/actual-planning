import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOverview,wageSplit} from '../public/overview.mjs';
import {calculatePlan} from '../src/planning.mjs';
const input=()=>({version:2,year:2027,annualGrossCents:12000000,firstPayDate:'2027-01-01',frequency:'monthly',k401:{limitCents:2450000,ytdCents:0,targetDate:'2027-06-30'},ira:{limitCents:750000,ytdCents:0,targetDate:'2027-09-30'},employer:{mode:'match',ratePct:50,matchSalaryCapPct:6,annualCapCents:null,ytdCents:0},loans:[],goals:[],mappings:[{source:'ira',categoryId:'ira'}]});
function actual(plan){return {year:plan.year,categories:[{id:'living',name:'Groceries'},{id:'mapped',name:'Saved category'},{id:'income',name:'Income',group_id:'income-group'}],groups:[{id:'income-group',is_income:true}],budgets:plan.monthly.map(m=>({month:m.month,status:'read',budget:{categoryGroups:[{categories:[{id:'living',budgeted:30000},{id:'mapped',budgeted:99999},{id:'income',budgeted:999999}]}]}}))};}
test('wage breakdown counts each source once and keeps employer contributions outside wage percentages',()=>{
 const p=input();p.goals=[{id:'car',name:'Car Fund',balanceCents:0,targetCents:500000,contributionCents:50000,aprPct:0,frequency:'monthly',categoryId:'mapped'}];
 const plan=calculatePlan(p),o=buildOverview(plan,p,actual(plan)),split=wageSplit(o);
 assert.ok(o.series.some(s=>s.key==='actual:living'));assert.ok(!o.series.some(s=>s.key==='actual:mapped'||s.key==='actual:income'));
 assert.equal(split.grossCents,12000000);assert.equal(split.parts.find(p=>p.key==='401k').amountCents,2450000);
 assert.equal(split.parts.find(p=>p.key==='goal:car').amountCents,500000);
 assert.equal(split.parts.find(p=>p.key==='actual:living').amountCents,360000);
 assert.ok(split.employerCents>0);assert.equal(split.parts.reduce((sum,p)=>sum+p.amountCents,0),split.grossCents);
 assert.ok(Math.abs(split.parts.reduce((sum,p)=>sum+p.percent,0)-100)<1e-9);
});
test('custom goal names and finish milestones use actual projections, including dates beyond the annual plan',()=>{
 const p=input();p.goals=[{id:'trip',name:'Round the world',balanceCents:0,targetCents:1200000,contributionCents:10000,aprPct:0,frequency:'monthly',categoryId:''}];p.loans=[{id:'loan',name:'Bike loan',balanceCents:100000,aprPct:0,targetDate:'2028-01-01',monthlyPaymentCents:10000}];
 const plan=calculatePlan(p),o=buildOverview(plan,p);
 assert.equal(o.events.find(e=>e.key==='401k').date,plan.k401FinishDate);
 assert.equal(o.events.find(e=>e.key==='ira').date,plan.iraFinishDate);
 assert.equal(o.events.find(e=>e.key==='goal:trip').name,'Round the world');assert.equal(o.events.find(e=>e.key==='goal:trip').date,'2036-12-01');
 assert.equal(o.events.find(e=>e.key==='loan:loan').date,plan.loans[0].payoffDate);
});
test('partial-year percentages use only remaining planned gross, never the whole annual salary',()=>{
 const p=input();p.firstPayDate='2027-04-15';const plan=calculatePlan(p),o=buildOverview(plan,p),split=wageSplit(o);
 assert.equal(o.rows.length,9);assert.equal(split.grossCents,9000000);assert.equal(wageSplit(o,'2027-05').grossCents,1000000);
});
test('unavailable Actual months remain explicitly incomplete rather than claiming a known surplus',()=>{
 const p=input(),plan=calculatePlan(p),a=actual(plan);a.budgets[5].status='unavailable';const o=buildOverview(plan,p,a);
 assert.deepEqual(o.missingMonths,['2027-06']);assert.equal(wageSplit(o,'2027-06').incomplete,true);assert.equal(wageSplit(o,'2027-05').incomplete,false);
 assert.equal(buildOverview(plan,p,{...a,year:2028}).hasActual,false);
});
test('annual remainder nets monthly deficits and surpluses without percentages accidentally exceeding 100',()=>{
 const o={rows:[{month:'2027-01',grossCents:100,committedCents:150,shortfallCents:50,employerCents:0,actualAvailable:true},{month:'2027-02',grossCents:100,committedCents:0,shortfallCents:0,employerCents:0,actualAvailable:true}],series:[{key:'ira',values:[150,0]},{key:'remaining',values:[0,100]}]};
 const annual=wageSplit(o);assert.equal(annual.parts.find(p=>p.key==='remaining').amountCents,50);assert.equal(annual.parts.reduce((sum,p)=>sum+p.percent,0),100);assert.equal(annual.monthlyShortfallCents,50);
 const month=wageSplit(o,'2027-01');assert.equal(month.shortfallCents,50);assert.equal(month.parts[0].percent,150);
});
test('zero-wage allocations do not divide by zero, and unmet goals never receive invented completion dates',()=>{
 const p=input();p.annualGrossCents=0;p.goals=[{id:'stuck',name:'No contributions',balanceCents:0,targetCents:100000,contributionCents:0,aprPct:0,frequency:'monthly',categoryId:''}];
 const plan=calculatePlan(p),o=buildOverview(plan,p),split=wageSplit(o);
 assert.ok(split.parts.every(p=>p.percent===null));assert.equal(o.events.find(e=>e.key==='goal:stuck').date,null);assert.equal(o.events.find(e=>e.key==='401k').finished,false);
});

test('legacy plans without saved mappings do not count Actual retirement or loans twice',()=>{
 const p=input();p.mappings=[];const plan=calculatePlan(p),a=actual(plan),o=buildOverview(plan,p,a);
 assert.deepEqual(o.unmappedSources,['Roth IRA']);assert.ok(!o.series.some(s=>s.key.startsWith('actual:')));assert.equal(wageSplit(o).incomplete,true);
 p.mappings=[{source:'ira',categoryId:'mapped'}];const mapped=buildOverview(plan,p,a);assert.deepEqual(mapped.unmappedSources,[]);assert.ok(mapped.series.some(s=>s.key==='actual:living'));assert.ok(!mapped.series.some(s=>s.key==='actual:mapped'));
});
