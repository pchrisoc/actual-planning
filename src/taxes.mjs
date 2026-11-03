// Single-filer 2026 ordinary-income brackets (IRS Publication 505).
// Held constant for projections; the standard deduction is an editable assumption.
const brackets=[[12400,.10],[50400,.12],[105700,.22],[201775,.24],[256225,.32],[640600,.35],[Infinity,.37]];
export function federalTax(taxableCents) {
  let previous=0,total=0;
  for(const [ceiling,rate] of brackets){total+=Math.max(0,Math.min(taxableCents,ceiling*100)-previous)*rate;previous=ceiling*100;}
  return Math.round(total);
}
export function singleTaxEstimate({grossCents,deferralCents,interestCents=0,standardDeductionCents=1660000,phaseoutStartCents=8500000,phaseoutEndCents=10000000}) {
  const magiCents=Math.max(0,grossCents-deferralCents);
  const fraction=Math.max(0,Math.min(1,(phaseoutEndCents-magiCents)/(phaseoutEndCents-phaseoutStartCents)));
  const studentLoanDeductionCents=Math.floor(Math.min(250000,interestCents)*fraction);
  const taxableBeforeInterestCents=Math.max(0,magiCents-standardDeductionCents);
  const taxableIncomeCents=Math.max(0,taxableBeforeInterestCents-studentLoanDeductionCents);
  const federalBeforeInterestCents=federalTax(taxableBeforeInterestCents),federalTaxCents=federalTax(taxableIncomeCents);
  return {grossCents,deferralCents,magiCents,standardDeductionCents,interestCents,studentLoanDeductionCents,taxableBeforeInterestCents,taxableIncomeCents,federalBeforeInterestCents,federalTaxCents,studentLoanTaxSavingsCents:federalBeforeInterestCents-federalTaxCents};
}
