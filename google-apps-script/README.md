# Google Sheets bridge deployment

This script must be **bound to** the existing Apartment Deal Finder spreadsheet. It reads the live `ARV_Comps`, `Renovation_Costs_v2`, and `Other_Costs` tabs, writes only PASS/REVIEW candidates to `Raw_Listings`, and returns underwriting results to Apify.

1. In the spreadsheet, open **Extensions → Apps Script**.
2. Replace `Code.gs` with the repository's `google-apps-script/Code.gs` and save.
3. In **Project settings → Script properties**, add `WEBHOOK_SECRET` with a new long random value.
4. Choose **Deploy → New deployment → Web app**.
5. Execute as yourself and allow access only as narrowly as your account supports. Copy the `/exec` deployment URL.
6. In Apify Actor environment variables, add both as encrypted secrets:
   - `GOOGLE_SHEETS_WEBHOOK_URL` = the `/exec` URL
   - `GOOGLE_SHEETS_WEBHOOK_SECRET` = the exact same random value

Never put the secret in this repository, README, Google Sheet cells, Actor input, or logs. A GET request to the deployment URL returns only a non-sensitive health response.
