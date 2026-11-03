import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forecastGoal} from '../src/goals.mjs';
import {calculatePlan,buildAllocations} from '../src/planning.mjs';
const goal=(extra={})=>({id:'house',name:'House Savings',categoryId:'house-cat',balanceCents:0,targetCents:100000,contributionCents:30000,aprPct:0,frequency:'monthly',...extra});
const plan=(goals=[])=>({version:2,year:2027,annualGrossCents:10000000,firstPayDate:'2027-01-31',frequency:'monthly',k401:{limitCents:0,ytdCents:0,targetDate:'2027-12-31'},ira:{limitCents:0,ytdCents:0,targetDate:'2027-12-31'},employer:{mode:'match',ratePct:0,matchSalaryCapPct:0,annualCapCents:null,ytdCents:0},loans:[],goals});
test('monthly goal clamps month-end, caps final deposit and stops at target',()=>{
 const r=forecastGoal(goal(),'2027-01-31');
 assert.equal(r.reachedDate,'2027-04-30');assert.equal(r.totalContributionsCents,100000);assert.equal(r.interestCents,0);
 assert.deepEqual(r.rows.slice(1).map(r=>[r.date,r.contributionCents]),[['2027-01-31',30000],['2027-02-28',30000],['2027-03-31',30000],['2027-04-30',10000]]);
});
test('weekly and biweekly goals use their own contribution dates across years',()=>{
 for(const [frequency,expected]of [['weekly','2028-01-14'],['biweekly','2028-02-04']])assert.equal(forecastGoal(goal({frequency}),'2027-12-24').reachedDate,expected);
});
test('daily APR compounds before subsequent deposits and can reach target between deposits',()=>{
 const r=forecastGoal(goal({balanceCents:100000,targetCents:101000,contributionCents:0,aprPct:36.5}),'2027-01-01');
 assert.equal(r.reachedDate,'2027-01-11');assert.equal(r.totalContributionsCents,0);assert.equal(r.endingBalanceCents,Math.round(100000*1.001**10));
 assert.equal(r.interestCents,r.endingBalanceCents-100000);
});
test('funded and unreachable goals are explicit without inventing a finish date',()=>{
 const funded=forecastGoal(goal({balanceCents:100000}),'2027-01-01');assert.equal(funded.reachedDate,'2027-01-01');assert.equal(funded.totalContributionsCents,0);
 const stuck=forecastGoal(goal({contributionCents:0}),'2027-01-01');assert.equal(stuck.reachedDate,null);assert.equal(stuck.rows.at(-1).date,'2077-01-01');assert.equal(stuck.endingBalanceCents,0);
});
test('only goal deposits enter annual budgets; mapped goals combine with IRA and loans',()=>{
 const p=plan([goal({aprPct:12})]),r=calculatePlan(p);
 assert.equal(r.monthly[0].goalContributionsCents,30000);assert.ok(r.goals[0].interestCents>0);assert.equal(r.goals[0].endingBalanceCents,100000);
 const cells=buildAllocations(r,[],['2027-01','2027-02'],[{id:'house-cat'}]);assert.equal(cells[0].amountCents,30000);assert.equal(cells[1].amountCents,30000);
 assert.throws(()=>buildAllocations(r,[],['2027-01'],[{id:'house-cat',is_income:true}]),/expense/);
 const c=buildAllocations(r,[{source:'ira',categoryId:'house-cat'}],['2027-01'],[{id:'house-cat'}]);assert.equal(c.length,1);assert.equal(c[0].amountCents,30000);
});
test('old plans remain valid; forecasts do not allocate contributions beyond goal completion',()=>{
 const p=plan();delete p.goals;assert.deepEqual(calculatePlan(p).goals,[]);
 const r=calculatePlan(plan([goal()]));assert.equal(r.monthly[4].goalContributionsCents,0);
});
test('goal validation rejects invalid amounts, duplicate IDs and invalid rates/frequencies',()=>{
 for(const change of [{targetCents:0},{balanceCents:-1},{contributionCents:1.1},{aprPct:NaN},{aprPct:101},{frequency:'daily'}])assert.throws(()=>forecastGoal(goal(change),'2027-01-01'));
 assert.throws(()=>calculatePlan(plan([goal(),goal()])),/unique/);
 assert.throws(()=>calculatePlan(plan([goal({categoryId:undefined})])),/category/);
});
test('populate goal mappings override saved defaults without double-counting and remain distinct by goal ID',()=>{
 const r=calculatePlan(plan([goal(),goal({id:'second',name:'Second goal',categoryId:'other',contributionCents:10000})]));
 const categories=[{id:'house-cat'},{id:'other'},{id:'new-cat'}];
 const cells=buildAllocations(r,[{source:'goal:house',categoryId:'new-cat'},{source:'goal:second',categoryId:'new-cat'}],['2027-01'],categories);
 assert.equal(cells.length,1);assert.equal(cells[0].categoryId,'new-cat');assert.equal(cells[0].amountCents,40000);
 const unselected=calculatePlan(plan([goal({categoryId:''})]));
 assert.throws(()=>buildAllocations(unselected,[],['2027-01'],categories),/mapping/);
 assert.equal(buildAllocations(unselected,[{source:'goal:house',categoryId:'house-cat'}],['2027-01'],categories)[0].amountCents,30000);
});
