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
  warnings.push(`Estimated taxes use an editable ${taxRatePct}% effective-rate assumption applied to pay after 401(k). This is not a tax or payroll calculation; actual federal, California, Social Security and Medicare amounts depend on your circumstances. Benefits and payroll election restrictions are not modeled.`);
  warnings.push('Retirement limits are editable planning assumptions. Confirm tax-year limits, Roth income eligibility, and all IRA contributions across accounts.');
  const monthly=Array.from({length:12},(_,i)=>({month:`${year}-${String(i+1).padStart(2,'0')}`,grossCents:0,grossAfterDeferralCents:0,taxCents:0,netPayCents:0,k401Cents:0,iraCents:0,employerCents:0,loanPaymentsCents:0,loans:{}}));
  for(const p of rows){const m=monthly[Number(p.date.slice(5,7))-1];for(const key of ['grossCents','grossAfterDeferralCents','taxCents','netPayCents','k401Cents','iraCents','employerCents'])m[key]+=p[key];}
  if(!Array.isArray(input.loans)||input.loans.length>30)fail('Provide at most 30 loans');
  const ids=new Set();
  const loans=input.loans.map(loan=>{
    if(typeof loan.id!=='string'||!loan.id||ids.has(loan.id))fail('Every loan needs a unique ID');ids.add(loan.id);
    if(typeof loan.name!=='string'||!loan.name.trim()||loan.name.length>120)fail('Enter a loan name');
    let balance=amount(loan.balanceCents,'Loan balance');
    const rate=pct(loan.aprPct,'Loan APR')/12;
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
    const payment=requested||Math.ceil(rate?balance*rate/(1-(1+rate)**(-dates.length)):balance/dates.length);
    let totalInterestCents=0;const payments=[];
    for(const day of dates){
      if(balance<=0)break;
      const interestCents=Math.round(balance*rate);
      if(payment<=interestCents&&balance>0)fail(`${loan.name}: monthly payment must exceed interest`);
      const paymentCents=Math.min(payment,balance+interestCents);
      balance=balance+interestCents-paymentCents;totalInterestCents+=interestCents;
      payments.push({date:day,paymentCents,interestCents,balanceCents:balance});
      if(day.startsWith(`${year}-`)){const m=monthly[Number(day.slice(5,7))-1];m.loans[loan.id]=paymentCents;m.loanPaymentsCents+=paymentCents;}
    }
    if(balance>0)warnings.push(`${loan.name}: ${balance/100} remains at the selected payoff date.`);
    return {id:loan.id,name:loan.name,monthlyPaymentCents:payment,totalInterestCents,remainingCents:balance,payoffDate:balance===0?payments.at(-1)?.date??input.firstPayDate:null,payments};
  });
  if(!Array.isArray(input.goals??[])||(input.goals??[]).length>30)fail('Provide at most 30 goals');
  const goalIds=new Set();
  const goals=(input.goals??[]).map(g=>{if(goalIds.has(g.id))fail('Every goal needs a unique ID');goalIds.add(g.id);return forecastGoal(g,input.firstPayDate);});
  for(const m of monthly){m.goals={};m.goalContributionsCents=0;}
  for(const g of goals)for(const r of g.rows){if(r.date.startsWith(`${year}-`)){const m=monthly[Number(r.date.slice(5,7))-1];m.goals[g.id]=(m.goals[g.id]??0)+r.contributionCents;m.goalContributionsCents+=r.contributionCents;}}
  if(monthly.some(m=>m.iraCents+m.loanPaymentsCents+m.goalContributionsCents>m.netPayCents))warnings.push('Some months require more IRA, loan and savings goal funding than estimated take-home pay after tax and 401(k). Review targets before budgeting; living costs are additional.');
  return {version:2,year,startDate:input.firstPayDate,rows,monthly,loans,goals,warnings,annualPayPeriods:calendar.length,taxRatePct,totalTaxCents:rows.reduce((sum,r)=>sum+r.taxCents,0),totalNetPayCents:rows.reduce((sum,r)=>sum+r.netPayCents,0),k401RequiredPerPeriodCents:Math.max(0,...kParts),iraRequiredPerPeriodCents:Math.max(0,...iraParts),k401FinishDate:rows.find(r=>r.k401YtdCents>=kLimit)?.date??null,iraFinishDate:rows.find(r=>r.iraYtdCents>=iraLimit)?.date??null,employee401kCents:kTotal-kYtd,iraContributionCents:iraTotal-iraYtd,employerContributionCents:employerTotal};
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
