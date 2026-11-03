import {singleTaxEstimate} from './taxes.mjs';
import {forecastGoal} from './goals.mjs';
const DAY = 86400000;
const fail = message => { throw new Error(message); };
function amount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1e12) fail(`${label} must be nonnegative integer cents`);
  return value;
}
function pct(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 100) fail(`${label} must be between 0 and 100`);
  return value / 100;
}
function date(value, label) {
  const d = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+d) || d.toISOString().slice(0,10) !== value) fail(`Invalid ${label}`);
  return d;
}
const iso = d => d.toISOString().slice(0,10);
function monthDate(year, month, day) {return new Date(Date.UTC(year,month,Math.min(day,new Date(Date.UTC(year,month+1,0)).getUTCDate())));}
export function payCalendar(year, firstPayDate, frequency) {
  const anchor = date(firstPayDate,'first contribution date');
  if (anchor.getUTCFullYear() !== year) fail('First contribution date must be in the planning year');
  if (!['weekly','biweekly','monthly'].includes(frequency)) fail('Choose weekly, biweekly or monthly');
  if (frequency === 'monthly') return Array.from({length:12},(_,m)=>iso(monthDate(year,m,anchor.getUTCDate())));
  const step = (frequency === 'weekly' ? 7 : 14) * DAY;
  let day = +anchor;
  while (new Date(day-step).getUTCFullYear() === year) day -= step;
  const dates = [];
  while (new Date(day).getUTCFullYear() === year) {dates.push(iso(new Date(day)));day += step;}
  return dates;
}
function split(total, count) {
  if (!count) return [];
  const base = Math.floor(total/count), extra=total%count;
  return Array.from({length:count},(_,i)=>base+(i<extra?1:0));
}
export function calculatePlan(input) {
  const year = input.year;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('Choose a planning year from 2000 to 2100');
  const annualGrossCents=amount(input.annualGrossCents,'Annual salary');
  const taxRatePct=input.taxRatePct??25;
  const taxRate=pct(taxRatePct,'Estimated tax rate');
  const calendar=payCalendar(year,input.firstPayDate,input.frequency);
  const grossParts=split(annualGrossCents,calendar.length);
  const paydays=calendar.map((d,i)=>({date:d,grossCents:grossParts[i]})).filter(d=>d.date>=input.firstPayDate);
  const k=input.k401, ira=input.ira, employer=input.employer;
  const kLimit=amount(k.limitCents,'Employee 401(k) limit'), kYtd=amount(k.ytdCents,'401(k) YTD');
  const iraLimit=amount(ira.limitCents,'Combined IRA limit'), iraYtd=amount(ira.ytdCents,'Combined IRA YTD');
  for(const [label,goal] of [['401(k)',k],['IRA',ira]]) {
    const target=date(goal.targetDate,`${label} target date`);
    if(target.getUTCFullYear()!==year) fail(`${label} target must be in the planning year`);
    if(goal.ytdCents>goal.limitCents) fail(`${label} YTD exceeds the selected limit`);
  }
  if(!['salary','match'].includes(employer.mode))fail('Invalid employer contribution method');
  const employerRate=pct(employer.ratePct,'Employer contribution percentage');
  const matchSalaryCap=pct(employer.matchSalaryCapPct,'Employer eligible salary percentage');
  const employerCap=employer.annualCapCents===null?Infinity:amount(employer.annualCapCents,'Employer annual cap');
  let employerYtd=amount(employer.ytdCents,'Employer YTD');
  if(employerYtd>employerCap)fail('Employer YTD exceeds the selected employer cap');
  const kEligible=paydays.filter(p=>p.date<=k.targetDate), iraEligible=paydays.filter(p=>p.date<=ira.targetDate);
  const kParts=split(kLimit-kYtd,kEligible.length), iraParts=split(iraLimit-iraYtd,iraEligible.length);
  const warnings=[];
  const taxSettings=input.tax??{mode:'flat'};
  if(!['flat','single'].includes(taxSettings.mode))fail('Choose a valid tax calculation method');
  const standardDeductionCents=amount(taxSettings.standardDeductionCents??1660000,'Standard deduction');
  const priorGrossCents=amount(taxSettings.priorGrossCents??0,'Prior wages');
  const priorInterestCents=amount(taxSettings.priorInterestCents??0,'Prior qualified student interest');
  const otherTaxRate=pct(taxSettings.otherTaxRatePct??12.65,'State and payroll tax estimate');
  const phaseoutStartCents=amount(taxSettings.phaseoutStartCents??8500000,'Student interest phaseout start');
  const phaseoutEndCents=amount(taxSettings.phaseoutEndCents??10000000,'Student interest phaseout end');
  if(phaseoutStartCents>=phaseoutEndCents)fail('Student interest phaseout end must exceed start');
  if(!kParts.length&&kLimit>kYtd)warnings.push('No contribution dates occur before the 401(k) target.');
  if(!iraParts.length&&iraLimit>iraYtd)warnings.push('No contribution dates occur before the IRA target.');
  let kTotal=kYtd, iraTotal=iraYtd, employerTotal=0;
  const rows=paydays.map((p,i)=>{
    const kScheduled=kParts[i]??0, k401Cents=Math.min(kScheduled,p.grossCents);
    const iraCents=iraParts[i]??0;
    const employerScheduled=Math.round(employer.mode==='salary'?p.grossCents*employerRate:Math.min(k401Cents,Math.round(p.grossCents*matchSalaryCap))*employerRate);
    const employerCents=Math.min(employerScheduled,Math.max(0,employerCap-employerYtd));
    kTotal+=k401Cents;iraTotal+=iraCents;employerYtd+=employerCents;employerTotal+=employerCents;
    const grossAfterDeferralCents=p.grossCents-k401Cents;
    const taxCents=Math.round(grossAfterDeferralCents*taxRate);
    return {...p,k401Cents,iraCents,employerCents,k401YtdCents:kTotal,iraYtdCents:iraTotal,grossAfterDeferralCents,taxCents,netPayCents:grossAfterDeferralCents-taxCents};
  });
  if(kTotal<kLimit)warnings.push('The 401(k) target is not reachable with the selected dates and gross salary.');
  if(employer.mode==='match'&&employerRate>0&&k.targetDate<`${year}-12-31`)warnings.push('Matching is calculated per contribution date and stops when employee deferrals stop. A year-end employer true-up is not modeled.');
  if(taxSettings.mode==='flat')warnings.push(`Estimated taxes use an editable ${taxRatePct}% effective-rate assumption applied to pay after 401(k). This is not a tax or payroll calculation; actual federal, California, Social Security and Medicare amounts depend on your circumstances. Benefits and payroll election restrictions are not modeled.`);
  warnings.push('Retirement limits are editable planning assumptions. Confirm tax-year limits, Roth income eligibility, and all IRA contributions across accounts.');
  const monthly=Array.from({length:12},(_,i)=>({month:`${year}-${String(i+1).padStart(2,'0')}`,grossCents:0,grossAfterDeferralCents:0,taxCents:0,netPayCents:0,k401Cents:0,iraCents:0,employerCents:0,loanPaymentsCents:0,loans:{}}));
  for(const p of rows){const m=monthly[Number(p.date.slice(5,7))-1];for(const key of ['grossCents','grossAfterDeferralCents','taxCents','netPayCents','k401Cents','iraCents','employerCents'])m[key]+=p[key];}
  if(!Array.isArray(input.loans)||input.loans.length>30)fail('Provide at most 30 loans');
  const ids=new Set();
  const loans=input.loans.map(loan=>{
    if(typeof loan.id!=='string'||!loan.id||ids.has(loan.id))fail('Every loan needs a unique ID');ids.add(loan.id);
    if(typeof loan.name!=='string'||!loan.name.trim()||loan.name.length>120)fail('Enter a loan name');
    let balance=amount(loan.balanceCents,'Loan balance');
    const baseApr=pct(loan.aprPct,'Loan APR')*100;
    const autopayDiscount=pct(loan.autopayDiscountPct??0,'Autopay discount')*100;
    const autopayEnd=loan.autopayEndDate??'2028-06-30';date(autopayEnd,'autopay discount end date');
    const ongoingDiscount=pct(loan.ongoingAutopayDiscountPct??0,'Ongoing autopay discount')*100;
    if(loan.studentLoan!==undefined&&typeof loan.studentLoan!=='boolean')fail('Student loan eligibility must be true or false');
    const refinanceDate=loan.refinanceDate||null;
    if(refinanceDate){if(date(refinanceDate,'refinance date')<date(input.firstPayDate,'start date'))fail('Refinance date must follow the start');}
    const refinanceApr=loan.refinanceAprPct==null?null:pct(loan.refinanceAprPct,'Refinance APR')*100;
    if(refinanceDate&&refinanceApr===null)fail('Enter an APR for the refinancing scenario');
    const aprFor=day=>refinanceDate&&day>=refinanceDate?refinanceApr:Math.max(0,baseApr-(day<=autopayEnd?autopayDiscount:ongoingDiscount));
    const target=date(loan.targetDate,'loan target date');
    const start=date(input.firstPayDate,'first contribution date');
    if(target<start||target.getUTCFullYear()>year+50)fail('Loan target must follow the start and be within 50 years');
    const dates=[];
    for(let i=0;i<601;i++){
      const d=monthDate(start.getUTCFullYear(),start.getUTCMonth()+i,target.getUTCDate());
      if(d>target)break;if(d>=start)dates.push(iso(d));
    }
    if(!dates.length)fail('No loan payment dates before target');
    const requested=amount(loan.monthlyPaymentCents,'Loan monthly payment');
    // Discount/refinance changes require a variable-rate amortization calculation.
    let factor=1,presentValue=0;
    for(const day of dates){factor/=1+aprFor(day)/1200;presentValue+=factor;}
    const payment=requested||Math.ceil(balance/presentValue);
    let totalInterestCents=0;const payments=[];
    for(const day of dates){
      if(balance<=0)break;
      const aprPct=aprFor(day),interestCents=Math.round(balance*aprPct/1200);
      if(payment<=interestCents&&balance>0)fail(`${loan.name}: monthly payment must exceed interest`);
      const paymentCents=Math.min(payment,balance+interestCents);
      balance=balance+interestCents-paymentCents;totalInterestCents+=interestCents;
      payments.push({date:day,paymentCents,interestCents,balanceCents:balance,aprPct});
      if(day.startsWith(`${year}-`)){const m=monthly[Number(day.slice(5,7))-1];m.loans[loan.id]=paymentCents;m.loanPaymentsCents+=paymentCents;}
    }
    if(balance>0)warnings.push(`${loan.name}: ${balance/100} remains at the selected payoff date.`);
    return {id:loan.id,name:loan.name,studentLoan:loan.studentLoan===true,autopayDiscountPct:autopayDiscount,autopayEndDate:autopayEnd,refinanceDate,refinanceAprPct:refinanceApr,monthlyPaymentCents:payment,totalInterestCents,remainingCents:balance,payoffDate:balance===0?payments.at(-1)?.date??input.firstPayDate:null,payments};
  });
  let tax=null;
  const loanTaxYears=[];
  if(taxSettings.mode==='single'){
    const grossCents=priorGrossCents+rows.reduce((sum,r)=>sum+r.grossCents,0);
    if(kYtd>priorGrossCents)fail('Enter prior wages at least as large as prior 401(k) contributions');
    if(kTotal>grossCents)fail('Annual 401(k) contributions exceed wages; enter prior wages for YTD contributions');
    const interestByYear=new Map([[year,priorInterestCents]]);
    for(const loan of loans.filter(l=>l.studentLoan))for(const p of loan.payments){const y=Number(p.date.slice(0,4));interestByYear.set(y,(interestByYear.get(y)??0)+p.interestCents);}
    const estimate=(gross,deferrals,interest)=>singleTaxEstimate({grossCents:gross,deferralCents:deferrals,interestCents:interest,standardDeductionCents,phaseoutStartCents,phaseoutEndCents});
    tax=estimate(grossCents,kTotal,interestByYear.get(year)??0);
    // Reserve federal tax before the interest deduction. Filing-time savings are
    // reported separately, rather than silently spending a future refund.
    let cumulative=0,allocated=0;
    const annualAfterDeferral=Math.max(0,grossCents-kTotal);
    for(const r of rows){
      cumulative+=r.grossAfterDeferralCents;
      const target=annualAfterDeferral?Math.round(tax.federalBeforeInterestCents*cumulative/annualAfterDeferral):0;
      r.federalTaxCents=target-allocated;allocated=target;
      r.otherTaxCents=Math.round(r.grossCents*otherTaxRate);
      r.taxCents=r.federalTaxCents+r.otherTaxCents;r.netPayCents=r.grossAfterDeferralCents-r.taxCents;
    }
    for(const m of monthly){m.taxCents=0;m.netPayCents=0;}
    for(const r of rows){const m=monthly[Number(r.date.slice(5,7))-1];m.taxCents+=r.taxCents;m.netPayCents+=r.netPayCents;}
    for(const [y,interest] of [...interestByYear].sort((a,b)=>a[0]-b[0]))loanTaxYears.push({year:y,...(y===year?tax:estimate(annualGrossCents,Math.min(kLimit,annualGrossCents),interest))});
    warnings.push('Single-filer federal estimate assumes traditional pre-tax 401(k), ordinary wages only, no credits or other income. Federal brackets use the 2026 schedule; the $16,600 default standard deduction is an editable planning assumption, not a verified future-year amount. State and payroll taxes use a separate editable rate on gross wages; 401(k) does not reduce payroll tax.');
    warnings.push('Prior wages plus scheduled wages determine first-year income. Enter all prior wages and qualified student interest. Federal tax is spread at an annual effective rate; this is not actual paycheck withholding. Student interest tax savings are shown separately and are not added to spendable income or treated as a guaranteed refund.');
    warnings.push('Student interest is capped at $2,500 across qualified loans and phases out using MAGI before the standard deduction. Only loans marked qualified are included. Future years assume full annual salary, the selected 401(k) limit, and unchanged tax assumptions; revisit as income and rules change.');
  }
  if(input.loans.some(l=>l.autopayDiscountPct))warnings.push('Autopay discounts apply only while eligible and enrolled. Enter the original APR before discounts. The temporary federal 1 percentage point total discount ends June 30, 2028; use the ongoing discount field for later periods. Monthly accrual uses the payment-date rate.');
  if(input.loans.some(l=>l.refinanceDate))warnings.push('Refinancing is an optional assumed offer, not guaranteed savings. Its APR is the final rate including discounts. Federal consolidation uses a weighted-average rate; private refinancing can remove federal borrower protections.');
  if(!Array.isArray(input.goals??[])||(input.goals??[]).length>30)fail('Provide at most 30 goals');
  const goalIds=new Set();
  const goals=(input.goals??[]).map(g=>{if(goalIds.has(g.id))fail('Every goal needs a unique ID');goalIds.add(g.id);return forecastGoal(g,input.firstPayDate);});
  for(const m of monthly){m.goals={};m.goalContributionsCents=0;}
  for(const g of goals)for(const r of g.rows){if(r.date.startsWith(`${year}-`)){const m=monthly[Number(r.date.slice(5,7))-1];m.goals[g.id]=(m.goals[g.id]??0)+r.contributionCents;m.goalContributionsCents+=r.contributionCents;}}
  if(monthly.some(m=>m.iraCents+m.loanPaymentsCents+m.goalContributionsCents>m.netPayCents))warnings.push('Some months require more IRA, loan and savings goal funding than estimated take-home pay after tax and 401(k). Review targets before budgeting; living costs are additional.');
  return {version:2,year,tax,loanTaxYears,startDate:input.firstPayDate,rows,monthly,loans,goals,warnings,annualPayPeriods:calendar.length,taxRatePct,totalTaxCents:rows.reduce((sum,r)=>sum+r.taxCents,0),totalNetPayCents:rows.reduce((sum,r)=>sum+r.netPayCents,0),k401RequiredPerPeriodCents:Math.max(0,...kParts),iraRequiredPerPeriodCents:Math.max(0,...iraParts),k401FinishDate:rows.find(r=>r.k401YtdCents>=kLimit)?.date??null,iraFinishDate:rows.find(r=>r.iraYtdCents>=iraLimit)?.date??null,employee401kCents:kTotal-kYtd,iraContributionCents:iraTotal-iraYtd,employerContributionCents:employerTotal};
}
export function buildAllocations(plan, mappings, months, categories, {preserveStartMonth=true}={}) {
  if(!Array.isArray(mappings)||!Array.isArray(months)||!months.length)fail('Select categories and at least one month');
  const valid=new Map(categories.filter(c=>!c.hidden).map(c=>[c.id,c]));
  const selected=[...new Set(months)];
  if(selected.some(m=>!plan.monthly.some(r=>r.month===m)))fail('Invalid selected month');
  if(plan.startDate&&selected.some(m=>m<plan.startDate.slice(0,7)))fail('Select months on or after the plan start month');
  const used=new Set(), result=new Map();
  for(const mapping of [...mappings,...(plan.goals??[]).filter(g=>g.categoryId&&!mappings.some(m=>m.source===`goal:${g.id}`)).map(g=>({source:`goal:${g.id}`,categoryId:g.categoryId}))]){
    const category=valid.get(mapping.categoryId),isIncome=mapping.source==='income';
    if(!category||!!category.is_income!==isIncome)fail(isIncome?'Select an existing income category for salary':'Select an existing expense category for contributions and loans');
    if(used.has(mapping.source))fail('Each planning source can be mapped only once');used.add(mapping.source);
    if(mapping.source!=='income'&&mapping.source!=='ira'&&!plan.loans.some(l=>`loan:${l.id}`===mapping.source)&&!(plan.goals??[]).some(g=>`goal:${g.id}`===mapping.source))fail('Only salary income, IRA, loan and savings goal contributions can populate budget allocations');
    for(const month of selected){const row=plan.monthly.find(r=>r.month===month);const value=isIncome?row.netPayCents:mapping.source==='ira'?row.iraCents:mapping.source.startsWith('goal:')?row.goals[mapping.source.slice(5)]??0:row.loans[mapping.source.slice(5)]??0;const key=`${month}/${mapping.categoryId}`;const cell=result.get(key)??{month,categoryId:mapping.categoryId,kind:isIncome?'income':'expense',amountCents:0,preserveExisting:preserveStartMonth&&!!plan.startDate&&plan.startDate.slice(8)!=='01'&&month===plan.startDate.slice(0,7)};cell.amountCents+=value;result.set(key,cell);}
  }
  if(!result.size)fail('Choose at least one category mapping');
  return [...result.values()];
}
