# Google Sheets bridge deployment

This script must be **bound to** the existing Apartment Deal Finder spreadsheet. It reads the live `ARV_Comps`, `Renovation_Costs_v2`, and `Other_Costs` tabs, underwrites listings before any write, and writes only actionable PASS/REVIEW candidates to `Deal_Analysis`. REVIEW starts at EUR 4,000 estimated profit; PASS starts at the configured minimum profit (EUR 7,000 by default) and also requires the other confidence/filter criteria. Bathroom count is excluded from comparable matching and deal qualification. FAIL and incomplete raw listings remain only in Apify history and are never written to Sheets.

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Replace `Code.gs` with the repository's `google-apps-script/Code.gs` and save.
3. In **Project settings → Script properties**, add `WEBHOOK_SECRET` with a new long random value.
4. Choose **Deploy → New deployment → Web app**.
5. Execute as yourself and allow access only as narrowly as your account supports. Copy the `/exec` deployment URL.
6. In Apify Actor environment variables, add both as encrypted secrets:
   - `GOOGLE_SHEETS_WEBHOOK_URL` = the `/exec` URL
   - `GOOGLE_SHEETS_WEBHOOK_SECRET` = the exact same random value

Never put the secret in this repository, README, Google Sheet cells, Actor input, or logs. A GET request to the deployment URL returns only a non-sensitive health response.
