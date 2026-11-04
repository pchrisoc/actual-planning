import {test} from 'node:test';
import assert from 'node:assert/strict';
import {singleTaxEstimate,federalTax} from '../src/taxes.mjs';
import {calculatePlan,buildAllocations} from '../src/planning.mjs';
const input=()=>({version:2,year:2027,annualGrossCents:7810000,tax:{mode:'single',standardDeductionCents:1660000,otherTaxRatePct:7.65},firstPayDate:'2027-01-01',frequency:'monthly',k401:{limitCents:2450000,ytdCents:0,targetDate:'2027-11-30'},ira:{limitCents:0,ytdCents:0,targetDate:'2027-12-31'},employer:{mode:'salary',ratePct:0,matchSalaryCapPct:0,annualCapCents:null,ytdCents:0},loans:[]});
const loan=(extra={})=>({id:'student',name:'Student loan',studentLoan:true,balanceCents:2000000,aprPct:6,targetDate:'2029-12-01',monthlyPaymentCents:0,...extra});
test('first-year taxable income follows actual wages, traditional 401(k), and standard deduction',()=>{
 const p=input(),plan=calculatePlan(p);
 assert.equal(plan.tax.magiCents,5360000);assert.equal(plan.tax.taxableIncomeCents,3700000);assert.equal(plan.tax.federalTaxCents,419200);
 assert.equal(plan.totalTaxCents,419200+plan.rows.reduce((s,r)=>s+r.otherTaxCents,0));
 assert.equal(plan.totalNetPayCents,7810000-2450000-plan.totalTaxCents);
 assert.equal(plan.k401FinishDate,'2027-11-01');assert.ok(plan.monthly[10].k401Cents>0);assert.equal(plan.monthly[11].k401Cents,0);
 p.k401.targetDate='2027-10-31';assert.ok(calculatePlan(p).k401RequiredPerPeriodCents>plan.k401RequiredPerPeriodCents);
 const cells=buildAllocations(plan,[{source:'income',categoryId:'income'}],plan.monthly.map(m=>m.month),[{id:'income',is_income:true}]);
 assert.equal(cells.reduce((s,c)=>s+c.amountCents,0),plan.totalNetPayCents);
});
test('student interest is a deduction with income-dependent tax savings, never a fixed credit',()=>{
 const estimate=(gross,interest=84500)=>singleTaxEstimate({grossCents:gross,deferralCents:2450000,interestCents:interest});
 assert.equal(estimate(7810000).studentLoanTaxSavingsCents,10140);
 assert.equal(estimate(10000000).studentLoanTaxSavingsCents,18590);
 assert.equal(estimate(12450000).studentLoanDeductionCents,0);
 assert.equal(estimate(11700000).studentLoanDeductionCents,42250);
 assert.equal(estimate(10950000).studentLoanDeductionCents,84500);
 assert.equal(estimate(7810000,900000).studentLoanDeductionCents,250000);
 assert.equal(federalTax(0),0);assert.equal(federalTax(1240000),124000);assert.equal(federalTax(5040000),580000);
});
test('interest savings do not increase monthly cash and qualified interest is combined across loans',()=>{
 const p=input(),without=calculatePlan(p);p.loans=[loan(),loan({id:'other',name:'Other'})];
 const plan=calculatePlan(p),interest=plan.loans.flatMap(l=>l.payments).filter(r=>r.date.startsWith('2027')).reduce((s,r)=>s+r.interestCents,0);
 assert.equal(plan.tax.interestCents,interest);assert.equal(plan.totalNetPayCents,without.totalNetPayCents);assert.ok(plan.tax.studentLoanTaxSavingsCents>0);
 p.loans[1].studentLoan=false;assert.ok(calculatePlan(p).tax.interestCents<interest);
});
test('partial first year uses prior wages and YTD deferrals; future years use full salary',()=>{
 const p=input();p.annualGrossCents=12000000;p.firstPayDate='2027-07-01';p.k401.ytdCents=450000;p.tax.priorGrossCents=2000000;p.tax.priorInterestCents=10000;p.loans=[loan()];
 const plan=calculatePlan(p);assert.equal(plan.tax.grossCents,8000000);assert.equal(plan.tax.deferralCents,2450000);
 assert.equal(plan.loanTaxYears[1].grossCents,12000000);assert.equal(plan.loanTaxYears[1].magiCents,9550000);
 assert.ok(plan.loanTaxYears[1].studentLoanDeductionCents<plan.loanTaxYears[1].interestCents);
 assert.ok(plan.tax.interestCents>=10000);
 assert.ok(plan.rows.every(r=>r.netPayCents===r.grossCents-r.k401Cents-r.taxCents));
 p.tax.priorGrossCents=0;assert.throws(()=>calculatePlan(p),/prior wages/);
});
test('autopay expires and optional refinance changes APR on its date without stacking discounts',()=>{
 const p=input();p.loans=[loan({autopayDiscountPct:1,ongoingAutopayDiscountPct:.25})];
 const plan=calculatePlan(p),rows=plan.loans[0].payments;
 assert.equal(rows.find(r=>r.date==='2028-06-01').aprPct,5);assert.equal(rows.find(r=>r.date==='2028-07-01').aprPct,5.75);
 assert.ok(plan.loans[0].totalInterestCents<calculatePlan({...p,loans:[loan()]}).loans[0].totalInterestCents);
 p.loans[0].refinanceDate='2028-01-01';p.loans[0].refinanceAprPct=3;
 const refi=calculatePlan(p).loans[0];assert.equal(refi.payments.find(r=>r.date==='2028-01-01').aprPct,3);assert.ok(refi.totalInterestCents<plan.loans[0].totalInterestCents);
 p.loans[0].aprPct=.5;delete p.loans[0].refinanceDate;assert.equal(calculatePlan(p).loans[0].payments[0].aprPct,0);
});
test('tax and loan assumptions reject invalid values',()=>{
 const p=input();p.tax.phaseoutStartCents=10000000;assert.throws(()=>calculatePlan(p),/phaseout end/);
 p.tax={mode:'single',otherTaxRatePct:-1};assert.throws(()=>calculatePlan(p),/State and payroll/);
 p.tax={mode:'single'};p.loans=[loan({refinanceDate:'2028-01-01'})];assert.throws(()=>calculatePlan(p),/Enter an APR/);
 p.loans=[loan({autopayEndDate:'2028-02-31'})];assert.throws(()=>calculatePlan(p),/autopay/);
});

test('100% 401(k) holds every other payment through the max-out payday',()=>{
 const p=input();
 p.k401={...p.k401,mode:'percent',paycheckPct:100};
 p.ira={limitCents:750000,ytdCents:0,startDate:'2027-03-01',targetDate:'2027-12-31',mode:'amount',perPayCents:100000};
 p.hsa={limitCents:450000,ytdCents:0,employerCents:50000,targetDate:'2027-12-31',mode:'amount',perPayCents:100000};
 p.loans=[loan({targetDate:'2027-12-01'})];
 p.goals=[{id:'savings',name:'Savings',categoryId:'',targetCents:100000,balanceCents:0,aprPct:0,frequency:'monthly',contributionPct:2}];
 const plan=calculatePlan(p);
 assert.equal(plan.k401FinishDate,'2027-04-01');
 assert.equal(plan.otherPaymentsResumeAfter,'2027-04-01');
 assert.ok(plan.rows.slice(0,4).every(r=>r.iraCents===0&&r.hsaCents===0));
 assert.equal(plan.rows[4].iraCents,100000);
 assert.equal(plan.hsaContributionCents,400000);
 assert.equal(plan.tax.magiCents,4960000);
 assert.equal(plan.loans[0].payments[0].date,'2027-05-01');
 assert.equal(plan.goals[0].rows.find(r=>r.contributionCents>0).date,'2027-05-01');
 assert.ok(plan.warnings.some(w=>w.includes('estimated taxes due')));
 p.ira.startDate='2027-08-01';
 assert.equal(calculatePlan(p).rows.find(r=>r.iraCents>0).date,'2027-08-01');
 p.k401.targetDate='2027-03-01';
 const blocked=calculatePlan(p);
 assert.equal(blocked.otherPaymentsBlocked,true);
 assert.equal(blocked.iraContributionCents,0);
 assert.equal(blocked.loans[0].payments.length,0);
});

test('a 100% loan payment gets priority and then releases other contributions',()=>{
 const p=input();
 p.loans=[loan({balanceCents:1000000,paymentPct:100,targetDate:'2027-12-01'})];
 const plan=calculatePlan(p);
 assert.equal(plan.loans[0].payoffDate,'2027-02-01');
 assert.equal(plan.otherPaymentsResumeAfter,'2027-02-01');
 assert.equal(plan.rows.find(r=>r.k401Cents>0).date,'2027-03-01');
});

test('negative take-home remains a forecast shortfall and exports zero budget income',()=>{
 const p=input();
 p.k401={...p.k401,mode:'percent',paycheckPct:100};
 const plan=calculatePlan(p);
 assert.ok(plan.monthly[0].netPayCents<0);
 const categories=[{id:'income',is_income:true}];
 const cells=buildAllocations(plan,[{source:'income',categoryId:'income'}],['2027-01'],categories);
 assert.equal(cells[0].amountCents,0);
});

test('smart front-loading keeps loans current and funds eligible goals on the max-out payday',()=>{
 const p=input();
 p.k401={...p.k401,mode:'percent',paycheckPct:100};
 p.ira={limitCents:750000,ytdCents:0,startDate:'2027-06-01',targetDate:'2027-12-31'};
 p.smartAllocation={percent:80,monthlyBillsCents:100000,monthlyBufferCents:50000,payrollDeductionsCents:10000};
 p.loans=[loan({monthlyPaymentCents:25000})];
 p.goals=[
   {id:'small',name:'Small goal',categoryId:'',targetCents:10000,balanceCents:0,contributionCents:0,aprPct:0,frequency:'monthly',priority:2},
   {id:'large',name:'Large goal',categoryId:'',targetCents:1000000,balanceCents:0,contributionCents:0,aprPct:0,frequency:'monthly',priority:3},
 ];
 const plan=calculatePlan(p);
 assert.equal(plan.loans[0].payments[0].date,'2027-01-01');
 assert.ok(plan.rows.every(r=>r.netPayCents>=0));
 assert.ok(plan.requiredShortfallCents>0);
 const finish=plan.k401FinishDate;
 const payday=plan.rows.find(r=>r.date===finish);
 const month=plan.monthly.find(m=>m.month===finish.slice(0,7));
 assert.equal(plan.goals[0].reachedDate,finish);
 assert.equal(plan.goals[1].rows.find(r=>r.contributionCents>0).date,finish);
 assert.equal(month.goalContributionsCents,Math.floor((payday.netPayCents-175000)*.8));
 assert.equal(plan.rows.find(r=>r.iraCents>0).date,'2027-06-01');
 assert.ok(plan.monthly.every(m=>m.iraCents+m.goalContributionsCents<=Math.max(0,m.netPayCents-m.loanPaymentsCents-150000)));
});
