function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
function cents(value, name) {
  number(value, name, 0, 1e12);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be integer cents`);
  return value;
}
export function savings(input) {
  const start = input.startMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) throw new Error('Invalid startMonth');
  let balance = cents(input.balanceCents, 'balanceCents');
  const contribution = cents(input.monthlyContributionCents, 'monthlyContributionCents');
  const target = cents(input.targetCents, 'targetCents');
  const years = number(input.years, 'years', 1, 50);
  if (!Number.isInteger(years)) throw new Error('years must be integer');
  const raise = number(input.annualIncreasePct, 'annualIncreasePct', 0, 30) / 100;
  const rate = (1 + number(input.annualReturnPct, 'annualReturnPct', -90, 50) / 100) ** (1 / 12) - 1;
  const inflation = number(input.inflationPct, 'inflationPct', 0, 30) / 100;
  if (!['january', 'anniversary'].includes(input.escalation)) throw new Error('Invalid escalation');
  const [year, month] = start.split('-').map(Number);
  let totalContributionsCents = 0;
  const rows = [];
  for (let i = 0; i < years * 12; i++) {
    const d = new Date(Date.UTC(year, month - 1 + i, 1));
    const exponent = input.escalation === 'january' ? d.getUTCFullYear() - year : Math.floor(i / 12);
    const contributionCents = Math.round(contribution * (1 + raise) ** exponent);
    const growthCents = Math.round(balance * rate);
    balance += growthCents + contributionCents;
    totalContributionsCents += contributionCents;
    rows.push({month:d.toISOString().slice(0, 7), contributionCents, growthCents, balanceCents:balance, realBalanceCents:Math.round(balance / (1 + inflation) ** ((i + 1) / 12))});
  }
  return {rows, targetCents:target, nominalTargetMonth:rows.find(r => r.balanceCents >= target)?.month ?? null, realTargetMonth:rows.find(r => r.realBalanceCents >= target)?.month ?? null, totalContributionsCents, assumption:'Month-end deposits; effective monthly return; forecast only. Returns are not guaranteed.'};
}
export function debt(input) {
  let balance = cents(input.balanceCents, 'balanceCents');
  const payment = cents(input.monthlyPaymentCents, 'monthlyPaymentCents');
  const rate = number(input.aprPct, 'aprPct', 0, 100) / 1200;
  const rows = [];
  let totalInterestCents = 0;
  for (let period = 1; balance > 0 && period <= 1200; period++) {
    const interestCents = Math.round(balance * rate);
    if (payment <= interestCents) throw new Error('Payment does not cover interest');
    const paymentCents = Math.min(payment, balance + interestCents);
    balance -= paymentCents - interestCents;
    totalInterestCents += interestCents;
    rows.push({period, interestCents, paymentCents, balanceCents:balance});
  }
  return {rows, totalInterestCents, paidOff:balance === 0, assumption:'Monthly APR/12 accrual; servicer daily accrual may differ.'};
}
