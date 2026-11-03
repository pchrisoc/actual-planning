# ActualPlanning

A self-hosted annual salary, retirement and loan planner connected to Actual Budget. The app has no web login on the user's private network. Existing Actual, REST bridge and MCP connection credentials remain server-side.

## Annual planning flow

1. Enter annual salary **before tax**, planning year, first contribution/pay date, and weekly, biweekly or monthly frequency.
2. Set the employee 401(k) limit (default **$24,500**), prior YTD contributions across jobs, and the date you want to finish contributing.
3. Configure employer contributions as a percentage of employee contributions or gross salary. Matching supports an eligible salary percentage, an optional annual dollar cap, and employer YTD contributions.
4. Set the combined IRA limit (default **$7,500**), all prior IRA contributions, and the target Roth IRA completion date.
5. Add individual loans with balances, APRs and payoff dates. Leave monthly payment blank to calculate a payoff payment, or enter a monthly payment override.
6. Calculate to see per-date contributions, exact annual caps, monthly totals, employer contributions, loan payments and remaining balances.
7. Load Actual categories, map Roth IRA and individual loans to existing expense categories, choose target months, and click **Populate selected values**.
8. Give your plan a name before saving. Saved plans are listed by creation time, newest first; loading a plan does not change its position. Older unnamed plans receive a date-based label.
9. Review current/proposed/delta values and preservation notes, export the budget CSV or complete PDF, or apply a reviewed preview when running a live, write-enabled Docker instance.

The requested retirement defaults are editable planning inputs. They are not a claim about a tax year's published legal limits or personal eligibility. Gross salary is not spendable income: income tax, payroll tax, withholding and benefits are **not calculated**. Roth eligibility is not determined. See [IRS retirement contribution information](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-contributions) and [Roth IRA eligibility](https://www.irs.gov/retirement-plans/roth-iras).

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
- 401(k) deductions and employer contributions are excluded from category population. IRA, loans and savings goals can share a category; their monthly amounts are summed. Unselected categories remain untouched.

## Savings goals

Add multiple named goals (for example, House Savings). Enter the target, current saved balance, expected APR, contribution amount and weekly, biweekly or monthly frequency. Select an Actual expense category on the goal card to include its contributions in the annual budget preview. Current savings is entered manually: category budget allocations are not treated as savings balances.

Forecasts begin on the plan start date, accrue daily at APR/365 and deposit on the selected schedule. Monthly dates clamp at month-end without drifting. Deposits stop when the target is reached and the last deposit is capped at the remaining amount. Charts separate the forecast balance from starting savings plus deposits and mark the target. Dates and balances are available in a table; the PDF includes the chart and annual summaries. Unreached targets are reported explicitly after a 50-year horizon. Interest, fees, withdrawals and tax treatment are not actual transactions; only scheduled deposits for the planning year enter the preview. Goals and category selections persist with saved plans; older plans continue to load.

## Safe budget population

**Populate selected values** makes a draft and a preview only. Months before the plan start cannot be populated. When the plan begins after the first of a month, existing funded start-month allocations are kept by default, with the remaining-period forecast shown separately. Uncheck **Keep existing allocations in the partial first month** only to intentionally replace that month. This does not alter retirement contribution projections. The backend recalculates the plan, validates existing expense category IDs, and retrieves current allocations. Income categories cannot receive retirement/loan cash allocations.

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
