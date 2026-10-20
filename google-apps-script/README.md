# Google Sheets bridge deployment

This script must be **bound to** the existing Apartment Deal Finder spreadsheet. It reads `ARV_Summary`, `Renovation_Costs_v2`, and `Other_Costs`, underwrites listings before any write, and writes only actionable PASS/REVIEW candidates to `Deal_Analysis`.

`ARV_Summary` groups every valid, user-confirmed `ARV_Comps` row by district + series + rooms. Its appraisal rate is the arithmetic mean of individual `price / area` values, retaining full precision. Base ARV is that rate multiplied by the listing's actual area. Legacy evidence/include columns and bathroom count do not exclude comps. `Best_Deals` remains a reference sheet and is not the underwriting source. REVIEW starts at EUR 4,000 profit with at least one matching comp and ROI of at least 10%; PASS requires the configured minimum profit (EUR 7,000 by default), at least three comps, and enabled manual filters. Renovation, all configured manual renovation extras, contingency, acquisition/selling percentages, fixed costs and one month of monthly costs enter total investment. Profit = Underwriting ARV − total investment, and ROI = profit / total investment.

The bridge returns version `arv-per-m2-2026-10-20`; the Actor refuses older responses. Deploy the bridge before the matching Actor build. `dryRun: true` suppresses candidate writes as well as Actor history updates and Telegram alerts. FAIL and incomplete raw listings are never written to Sheets.

Each batch reads the existing candidate table once, bulk-upserts actionable results, and removes existing rows whose re-analysis no longer qualifies. Other candidates remain untouched. The response counts `sheetsRowsWritten` and `sheetsRowsRemoved` separately; no raw-listing tab is used.

Qualification uses the conservative renovation cost including contingency. The bridge also returns renovation before contingency and an upside profit value without contingency, so Telegram and `Deal_Analysis` show a transparent profit range without changing the conservative PASS/REVIEW decision.

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Replace `Code.gs` with the repository's `google-apps-script/Code.gs` and save.
3. In **Project settings → Script properties**, add `WEBHOOK_SECRET` with a new long random value.
4. Choose **Deploy → New deployment → Web app**.
5. Execute as yourself and allow access only as narrowly as your account supports. Copy the `/exec` deployment URL.
6. In Apify Actor environment variables, add both as encrypted secrets:
   - `GOOGLE_SHEETS_WEBHOOK_URL` = the `/exec` URL
   - `GOOGLE_SHEETS_WEBHOOK_SECRET` = the exact same random value

Never put the secret in this repository, README, Google Sheet cells, Actor input, or logs. A GET request to the deployment URL returns only a non-sensitive health response.
