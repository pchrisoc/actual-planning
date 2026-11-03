import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savings, debt} from '../src/models.mjs';
const base = {startMonth:'2027-04', balanceCents:100021, monthlyContributionCents:125000, targetCents:20000000, years:2, annualIncreasePct:2.5, annualReturnPct:0, inflationPct:0, escalation:'anniversary'};
test('zero return preserves exact deposits and anniversary escalation', () => {
  const {rows} = savings(base);
  assert.equal(rows[11].balanceCents, 1600021);
  assert.equal(rows[12].contributionCents, 128125);
});
test('January escalation differs from anniversary in a partial first year', () => {
  assert.equal(savings({...base, escalation:'january'}).rows[9].contributionCents, 128125);
  assert.equal(savings(base).rows[9].contributionCents, 125000);
});
test('effective monthly interest compounds to the annual rate without deposits', () => {
  const final = savings({...base, balanceCents:100000000, monthlyContributionCents:0, annualReturnPct:4}).rows[11];
  assert.ok(Math.abs(final.balanceCents - 104000000) <= 6);
});
test('inflation-adjusted goal is reached later', () => {
  const out = savings({...base, targetCents:1550000, inflationPct:10});
  assert.ok(out.realTargetMonth > out.nominalTargetMonth);
});
test('loan caps final payment and calculates interest independently', () => {
  const result = debt({balanceCents:100000, monthlyPaymentCents:51000, aprPct:12});
  assert.equal(result.rows.length, 2);
  assert.equal(result.totalInterestCents, 1500);
  assert.equal(result.rows[1].paymentCents, 50500);
  assert.equal(result.rows[1].balanceCents, 0);
});
test('rejects negative amortization, fractional cents, nonfinite values and bad dates', () => {
  assert.throws(()=>debt({balanceCents:100000, monthlyPaymentCents:1000, aprPct:12}));
  assert.throws(()=>savings({...base, balanceCents:1.5}));
  assert.throws(()=>savings({...base, annualReturnPct:NaN}));
  assert.throws(()=>savings({...base, startMonth:'2027-13'}));
});
