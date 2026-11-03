# ActualPlanning

A self-hosted annual salary, retirement and loan planner connected to Actual Budget. The app has no web login on the user's private network. Existing Actual, REST bridge and MCP connection credentials remain server-side.

## Annual planning flow

1. Enter annual salary **before tax**, a tax method, planning year, first contribution/pay date, and weekly, biweekly or monthly frequency. New plans use a single-filer federal estimate plus a separate editable state/payroll estimate; older plans retain their flat rate.
2. Set the employee 401(k) limit (default **$24,500**), prior YTD contributions across jobs, and the date you want to finish contributing (new plans default to November 30).
3. Configure employer contributions as a percentage of employee contributions or gross salary. Matching supports an eligible salary percentage, an optional annual dollar cap, and employer YTD contributions.
4. Set the combined IRA limit (default **$7,500**), all prior IRA contributions, and the target Roth IRA completion date.
5. Add individual loans with balances, APRs and payoff dates. Leave monthly payment blank to calculate a payoff payment, or enter a monthly payment override.
6. Calculate to see per-date contributions, estimated taxes, post-tax pay after 401(k), exact annual caps, monthly totals, employer contributions, loan payments and remaining balances.
7. Load Actual categories, map post-tax take-home pay to an income category and IRA, loan and savings-goal contributions to expense categories, choose target months, and click **Populate selected values**.
8. Give your plan a name before saving. Saved plans are listed by creation time, newest first; loading a plan does not change its position. Older unnamed plans receive a date-based label.
9. Review current/proposed/delta values and preservation notes, export the budget CSV or complete PDF, or apply a reviewed preview when running a live, write-enabled Docker instance.

New plans calculate single-filer federal tax on wages after traditional 401(k), an editable standard deduction (your **$16,600 planning assumption**) and eligible student loan interest. Federal brackets use the [2026 IRS schedule](https://www.irs.gov/publications/p505), held constant for projections; $16,600 is not represented as a verified tax-year limit. The separate default **12.65%** state/payroll estimate applies to gross wages; it is an editable assumption, not a California tax calculation. Traditional 401(k) reduces federal taxable wages, but does not reduce payroll tax. No credits, other income, benefits or detailed state/payroll calculations are modeled. Flat mode retains the prior 25% combined estimate after 401(k).

First-year tax wages equal scheduled pay plus the entered prior wages; enter prior wages if contributions YTD are nonzero. For example, $78,100 wages minus $24,500 traditional 401(k) minus $16,600 standard deduction gives **$37,000 federal taxable income before student interest**. That result depends on actual wages, not simply maxing the 401(k).

Only loans explicitly marked qualified enter the [student interest deduction](https://www.irs.gov/publications/p970). Interest is capped at $2,500 across loans, then phased out using MAGI after 401(k) and before the standard deduction. The editable $85,000–$100,000 single-filer phaseout is a planning assumption based on published rules; at or above the cutoff there is no deduction. Savings equal the difference in federal tax with and without the deduction: $845 of interest at a 22% marginal rate saves $185.90 only if fully deductible and entirely in that bracket. At $37,000 taxable income, the modeled 12% rate saves $101.40. These savings appear separately and do not increase budgeted income or imply a guaranteed refund. Future-year tables recompute interest and deduction using full annual salary, continued 401(k) contributions and unchanged tax assumptions.

Loan APRs are entered **before discounts**. Autopay discount points, expiration and ongoing discount are editable per loan and default to zero for compatibility and unconfirmed eligibility. Eligible federal autopay can be modeled with a total 1-point discount through June 30, 2028, then 0.25 points; confirm enrollment and eligibility with the servicer. See [Federal Student Aid](https://studentaid.gov/articles/prepare-for-payments/). The optional dated refinancing scenario uses a final offered APR including any discounts; approval and savings are not assumed. [Federal consolidation](https://studentaid.gov/articles/5-things-before-consolidating-student-loans/) uses a weighted-average rate; private refinancing can remove federal protections. Variable-rate payoff payments account for the selected discount expiration and refinancing date. Monthly interest uses the rate on the payment date, not daily proration.

Retirement limits remain editable planning inputs. Confirm annual limits and [Roth eligibility](https://www.irs.gov/retirement-plans/roth-iras). Tax on savings-goal investment income is not modeled.

## Local development on the Mac

Node 22+ is required. Run `npm ci` once to install dependencies, including the PDF export library. Then start the local preview:

```sh
cd /Users/pchrisoc/actual-planning
npm run dev
```

Open **http://127.0.0.1:3016**. `npm run dev` uses an optional `.env.local`, listens only on localhost, and keeps scenarios and previews in `./data`.

The prepared `.env.local` points to `data/actual-state.json`, a private read-only snapshot of your real categories and available 2027 allocations. Snapshot mode never connects to or writes to Actual. Both files are ignored by Git and excluded from the source archive. Without a snapshot or live connection, the salary/retirement/loan calculator still works; category loading reports that no connection is available.

To connect from another machine, install dependencies with `npm ci` and configure the official API with `ACTUAL_SERVER_URL`, `ACTUAL_BUDGET_SYNC_ID`, `ACTUAL_PASSWORD_FILE`, and a writable `DATA_DIR`. Do not copy passwords into source control.

## Calculation assumptions

- All monetary inputs, contributions and allocations are integer cents internally.
- Salary is divided across all dates in the anchored calendar year, including 53-payday years. Starting midyear plans only dates from the selected start onward. Actual payroll may instead use a fixed 52/26 divisor; verify against payslips.
- Monthly schedules retain the starting day, clamping short months without drifting subsequent months.
- Remaining employee 401(k) and IRA amounts are distributed across eligible contribution dates on or before each target. Contributions cease at the selected limit, including prior YTD amounts. 401(k) deductions cannot exceed gross pay on a date; an unreachable target is flagged.
- Employer money does not reduce the employee deferral limit or appear in the cash budget. Percentage matching stops when employee contributions stop. True-ups, bonuses, vesting, catch-ups, legal combined employer/employee limits and payroll restrictions are not modeled.
- IRA YTD must include both Roth and traditional IRA contributions across accounts. All projections use the selected calendar year; prior-year IRA contributions made in a following year are not modeled.
- Loan estimates use monthly APR/12 interest, with first payment on the payoff date's day of the month (clamped when needed). They are not daily-accrual servicer payoff quotes.
- The selected tax method determines estimated taxes as described above. Estimated taxes and 401(k) are deducted before calculating post-tax pay. Salary may populate an income category using that post-tax amount; IRA, loans and savings goals can share an expense category; their monthly amounts are summed. Employer contributions are excluded from cash income. Unselected categories remain untouched.

## Combined plan overview

After calculating, a stacked monthly chart compares post-tax pay with Roth IRA, each loan, each named savings goal, and positive existing Actual expense allocations outside mapped plan categories. Estimated taxes, gross wages and employer contributions are shown separately. Map all active IRA, loan and goal sources first; until mappings are complete, existing Actual expense allocations are excluded to avoid double-counting and the view is marked incomplete. Older saved plans without mappings receive this same safeguard. A finish timeline shows projected completion and requested target dates, including future loan payoffs and goals beyond the planning year. Unreachable goals stay explicitly unreached.

At the bottom, **Where your wage goes** shows post-tax pay, commitments and unassigned amounts for all planned dates or one selected month. Click a monthly bar or use the period selector to inspect it. Spending percentages use estimated post-tax pay after 401(k) for the selected dates. Annual shares net monthly deficits and surpluses; shortfall warnings preserve timing gaps and overallocated months can exceed 100%. Missing Actual months are marked incomplete. Unassigned amounts are post-tax estimates, not a guarantee of take-home pay, and must still cover missing costs and benefits. This view is a full forecast; partial-first-month protection still applies separately to budget previews. Charts include accessible tables and keyboard month selection.

## Savings goals

Add multiple goals with any names you choose, such as Emergency Fund, Car or Vacation. New goals start with neutral numbered names. Renaming a goal updates its chart and Populate row while preserving its category mapping. Enter the target, current saved balance, expected APR, contribution amount and weekly, biweekly or monthly frequency. Select an Actual expense category for each goal under **Populate your Actual budget** to include its contributions in the annual budget preview. Current savings is entered manually: category budget allocations are not treated as savings balances.

Forecasts begin on the plan start date, accrue daily at APR/365 and deposit on the selected schedule. Monthly dates clamp at month-end without drifting. Deposits stop when the target is reached and the last deposit is capped at the remaining amount. Charts separate the forecast balance from starting savings plus deposits and mark the target. Dates and balances are available in a table; the PDF includes the chart and annual summaries. Unreached targets are reported explicitly after a 50-year horizon. Interest, fees, withdrawals and taxes on investment income are not actual transactions; only scheduled deposits for the planning year enter the preview. Forecasts recalculate as plan inputs change, and editing invalidates any old budget preview. Mapping rows update when goals or loans are added, renamed or removed. Refresh categories after adding a category in Actual. IRA, loan and goal category selections persist with saved plans; older plans continue to load.

## Safe budget population

**Populate selected values** makes a draft and a preview only. Months before the plan start cannot be populated. When the plan begins after the first of a month, existing funded start-month allocations are kept by default, with the remaining-period forecast shown separately. Uncheck **Keep existing allocations in the partial first month** only to intentionally replace that month. This does not alter retirement contribution projections. The backend recalculates the plan, validates existing expense category IDs, and retrieves current allocations. Map **Take-home pay after tax & 401(k)** to an income category to populate the estimated post-tax amount after scheduled employee 401(k) deductions. Each deduction follows the selected limit, YTD and target date; income increases after actual projected max-out. Employer contributions are not added to income, and IRA/loan/savings allocations are not subtracted again. Annual salary is split exactly across that year's anchored pay dates, then summed by month; only dates on or after the plan start are included. Weekly and biweekly months vary with payday counts, while monthly pay is approximately annual wage / 12 with cent rounding. Existing funded partial-start-month allocations remain protected unless you opt out, even when the new forecast differs. Only the salary source can target an income category; retirement, loan and savings contributions still require expense categories.

The interface shows whether direct apply is on, and lists every apply blocker above the disabled button, including unreadable months and required confirmations. Confirmations unlock only when write-back is enabled and all selected months are readable.

Write-back is disabled by default and always disabled in local snapshot mode. To enable it after deploying a reviewed source version, set this in the **server's** `.env`:

```dotenv
ACTUAL_WRITE_ENABLED=true
```

Then recreate the planner with `docker compose up -d planner`. The UI requires an explicit reviewed-preview checkbox and, when applicable, explicit replacement of nonzero allocations. The apply endpoint requires the preview ID and a request idempotency key.

Before changes, the worker rechecks the preview against current Actual amounts and exports a timestamped backup. It updates only selected category/month allocations through `setBudgetAmount`, syncs once, and reads amounts back. Unreadable future months block applying that preview. Preview records expire after 30 minutes. All jobs run under the same filesystem lock as reads and backups.

Audit records are stored in `/data/budget-jobs`. Retrying a verified request returns the saved result without writing again. A failed or interrupted request is not automatically replayed. Partial writes may exist after failure; inspect its before/after audit and backup before preparing another preview. Rollback requires deliberate reapplication of recorded original allocations or a carefully reviewed restore. The app never creates projected transactions or rewrites historical bank records.

## Docker and community companions

`compose.yaml` preserves the existing stack:

| Service | Address / purpose |
| --- | --- |
| Planner | `http://10.10.10.40:3016` on the deployed VM |
| Actual Bench | https://bench.pchrisoc.com; annual budget editing and diagnostics |
| actual-http-api | `http://bridge:5007` inside Docker only; Bench's authenticated connection |
| actual-mcp | `http://10.10.10.40:3018/mcp`; bearer-authenticated, read-only tools |
| Auto Sync | Disabled optional `bank-sync` profile |

Bench's HTTP API mode uses `http://bridge:5007` with the VM-local key in `secrets/bridge_api_key`. Its direct mode requires HTTPS or localhost and the upstream browser isolation requirements. Bench sign-in and gateway Basic authentication remain disabled as requested.

The planner's official API cache is separate from those of MCP, the REST bridge and optional Auto Sync. Actual remains the source of truth. The secret password at `/home/pchrisoc/actual-api/.password` is mounted read-only; server SQLite files are never mounted for mutation.

## Push to GitHub, then deploy

Push the source in this directory to your chosen repository. `.gitignore` excludes `.env*` (except `.env.example`), `data/`, secrets, node_modules, archives and the private handoff. Do not add ignored files or runtime data to the repository.

After checking out the pushed version on the Docker VM at `/home/pchrisoc/financial-planner`, retain the server's `.env` and `secrets/` and run:

```sh
docker compose build planner
docker compose up -d planner
```

This change is prepared **locally**; the currently deployed planner is not updated by these source changes. After you push, provide the repository URL/branch so the reviewed commit can be deployed.

For a fresh installation, copy `.env.example` to `.env`, configure your target IP and Actual connection, provision the Actual password privately, and review `ops/deploy.sh` for its desktop target path and UID 1000. That script creates missing MCP/bridge keys, initializes cache volumes, pins pulled community images by digest, builds the planner and starts the stack. It does not start bank sync or apply plans.

## Backups and operations

The existing n8n [daily backup](https://n8n.pchrisoc.com/workflow/syxEBd5l0eXwUNdE) remains active in the personal project: 04:15 in the n8n instance timezone, plus a manual trigger. The [Health workflow](https://n8n.pchrisoc.com/workflow/JTwFSCSSglSxPycw) reads the deployed connection. Neither was changed to deploy this local revision.

```sh
docker compose ps
docker compose exec -T planner node src/cli.mjs state 2027 --summary
docker compose exec -T planner node src/cli.mjs backup
```

Backups and hash metadata are in the private planner volume at `/data/backups`. Off-host replication and retention are not configured. If a crash leaves `/data/actual.lock`, confirm no worker is running before removing the stale lock.

Optional bank sync imports real transactions once daily at 05:00 America/Los_Angeles, with startup sync disabled. Ensure only one scheduler is importing the budget before enabling it:

```sh
docker compose --profile bank-sync up -d auto-sync
```

## Verification

`npm test` exercises retirement dates/caps/YTD, 53-payday calendars, cent rounding, employer formulas/caps, independent loan payoff, selected-category aggregation, income-category rejection, stale/unreadable previews, backups-before-write and failed writes. No real Actual allocations are changed by these tests.

`ops/verify.py` checks the original savings/debt API, reads, access configuration and MCP on the deployed VM. `ops/verify-backup.py` verifies a stored ZIP hash/CRC. `ops/verify-bridge.py` checks Bench-to-bridge connectivity. These scripts read credentials only on the server and print no secrets.

Historical deployment details are in DEPLOYMENT.md; community-project choices are in INTEGRATIONS.md.

## Complete reports

Use **Download complete PDF** after populating selected values. The report includes all twelve monthly rows, every contribution date and every selected budget cell, with repeated headers and explicit notes for preserved start-month amounts. The server verifies that the report preview belongs to the current plan. The browser print stylesheet also expands scrolling tables and repeats headers; closed details remain closed.
