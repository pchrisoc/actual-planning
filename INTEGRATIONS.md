# Community integration fit

Reviewed November 2, 2026 against upstream READMEs. Running image digests are recorded in server `.env` and `DEPLOYMENT.md`.

| Project family | Decision | Reason |
| --- | --- | --- |
| Actual Bench | Installed | Annual grid, staged edits, diagnostics and reconciliation directly support the handoff. An internal actual-http-api bridge supports HTTP API mode on the initial private HTTP deployment. |
| s-stefanov/actual-mcp | Installed, read-only | Supplies reports and conversational reads with serialized API access. Does not calculate tax-aware future payroll. |
| Other two MCP servers | Deferred | Multiple overlapping MCP servers add maintenance and extra write surfaces without closing the payroll gap. |
| Actual Auto Sync | Configured, disabled profile | Fits existing SimpleFIN use; imports change Actual data and should have one scheduler. |
| Actual Budget Backup | Replaced by dedicated official-API export job | Keeps scheduling and audit in existing n8n; no additional rclone destination or credentials supplied. |
| Actual Helpers / Actual Tasks | Deferred | Loan and investment scripts can create real transactions or valuation changes; the handoff needs forecast-only models and careful Vanguard treatment. Custom pure savings/debt calculations fill the immediate need. |
| actual-http-api | Installed internally | Bench Direct mode cannot run at a plain HTTP overlay URL. HTTP API mode uses this authenticated, container-only bridge; experimental endpoints are disabled. |
| actualpy | Deferred | The official Node adapter already supplies the planner's connection. |
| Bank2actual and other bank converters | Deferred | Existing SimpleFIN integration already imports data. A statement-specific importer can be added when an actual unsupported export is supplied. |
| Plaid / Lunch Flow / Enable / Akahu / regional importers | Deferred | No confirmed bank/provider gap; overlapping import paths risk duplicates. |
| YNAB / MoneyMoney / Quicken migration | Not needed | Desktop budget migration is already complete. |
| actual2ics | Optional later | Helpful for displaying schedules; not required for core cash-flow forecasts. No calendar destination supplied. |
| receipt2actual / AmazonExporter | Optional later | Receipt/order linkage does not address retirement, housing or payroll projections; receipt2actual writes notes. |
| Actual AI | Deferred | Current task concerns planning; category AI would send data to a configured model and alter categorization. |
| ActualTap / ActualTap-Py | Optional later | Useful for mobile capture, outside this planning integration. |
| Actuali / iOS Widget | Optional client setup | Requires a device/client and HTTPS; no server-side planner capabilities. |
| Prometheus Exporter | Deferred | No Prometheus/Grafana target identified. Container health and n8n execution failures provide initial visibility. |
| Userscripts | Deferred | Browser-specific enhancements are not a maintainable payroll engine. |
| Meal cards / Wallos / Home Assistant | Not needed initially | No matching provider, Wallos subscriptions or requested Home Assistant entities identified. |

The retirement/payroll and safe-write milestones in the supplied handoff remain separate custom development work. Installation of these community integrations does not certify the handoff's financial assumptions or complete those milestones.
