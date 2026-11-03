const DAY=86400000;
function cents(value,label){if(!Number.isSafeInteger(value)||value<0||value>1e12)throw new Error(`${label} must be nonnegative integer cents`);return value;}
export function forecastGoal(goal,startDate){
  if(typeof goal.id!=='string'||!goal.id||typeof goal.name!=='string'||!goal.name.trim()||goal.name.length>120)throw new Error('Every goal needs an ID and a name');
  if(typeof goal.categoryId!=='string')throw new Error('Invalid goal category');
  const target=cents(goal.targetCents,'Goal target'),initial=cents(goal.balanceCents,'Current savings'),contribution=cents(goal.contributionCents,'Goal contribution');
  if(!target)throw new Error('Goal target must be greater than zero');
  if(!Number.isFinite(goal.aprPct)||goal.aprPct<0||goal.aprPct>100)throw new Error('Goal APR must be between 0 and 100');
  if(!['weekly','biweekly','monthly'].includes(goal.frequency))throw new Error('Choose a goal contribution frequency');
  const start=new Date(`${startDate}T00:00:00Z`);
  if(!Number.isFinite(+start)||start.toISOString().slice(0,10)!==startDate)throw new Error('Invalid goal start date');
  const end=new Date(+start);end.setUTCFullYear(end.getUTCFullYear()+50);
  let balance=initial,totalContributionsCents=0,reachedDate=balance>=target?startDate:null,next=+start,period=0;
  const rows=[{date:startDate,balanceCents:initial,contributionCents:0,totalContributionsCents:0,interestCents:0}];
  // Daily APR/365 compounding, followed by deposits on scheduled dates. Keep fractional cents until reporting.
  for(let time=+start;time<=+end&&!reachedDate;time+=DAY){
    if(time>+start)balance*=1+goal.aprPct/36500;
    let deposit=0;const scheduled=time===next;
    if(time===next){
      deposit=Math.min(contribution,Math.max(0,target-Math.round(balance)));
      balance+=deposit;totalContributionsCents+=deposit;period++;
      if(goal.frequency==='monthly')next=Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+period,Math.min(start.getUTCDate(),new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+period+1,0)).getUTCDate()));
      else next+=DAY*(goal.frequency==='weekly'?7:14);
    }
    if(Math.round(balance)>=target)reachedDate=new Date(time).toISOString().slice(0,10);
    if(scheduled||reachedDate||time===+end){
      // Record contribution dates, the crossing date and the horizon, never every daily accrual.
      rows.push({date:new Date(time).toISOString().slice(0,10),balanceCents:Math.round(balance),contributionCents:deposit,totalContributionsCents,interestCents:Math.round(balance)-initial-totalContributionsCents});
    }
  }
  return {...goal,name:goal.name.trim(),startDate,reachedDate,horizonDate:end.toISOString().slice(0,10),rows,totalContributionsCents,interestCents:rows.at(-1).interestCents,endingBalanceCents:Math.round(balance),assumption:'Daily APR/365 compounding; first deposit on the plan start date, then your selected frequency. Final deposit is capped at the target. No withdrawals, taxes or fees; rates may change. Forecast stops at the target or 50 years.'};
}
