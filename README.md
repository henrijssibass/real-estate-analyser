# SS.com Apartment Deal Finder

Low-cost Apify Actor using TypeScript, Crawlee and `CheerioCrawler`. It reads only public SS.com apartment-sale pages, honors `robots.txt`, rate-limits requests, stores compact seen/price history in the named key-value store `SS-COM-SEEN-HISTORY`, and emits only new or changed listings.

## Local development

```bash
npm install
npm test
npm run build
```

Run with Apify CLI or set `APIFY_INPUT` to the JSON accepted by `.actor/input_schema.json`. Start with one Ķengarags URL, `maxListingsPerRun: 20`, `dryRun: true`.

## Safety

The Actor does not authenticate, solve CAPTCHAs, rotate identities to evade blocks, contact sellers, or mutate source data. A blocked/CAPTCHA response is treated as a failed request. Telegram and Google Sheets are intentionally deferred to later phases; no credentials belong in source control or workbook cells.

## Current output

When `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_WEBHOOK_SECRET` are configured, the Actor sends scraped listings to the bound Apps Script bridge for live workbook underwriting and receives PASS / REVIEW / FAIL results. Without that bridge, changed listings remain `UNCERTAIN` with `DEAL_ANALYSIS_PENDING_SHEET_SYNC`.

When SS.com does not publish a bathroom count, the Actor keeps a one-bath internal fallback for schema compatibility. Bathroom count does not affect comparable matching or deal qualification.

Telegram uses only the encrypted Apify variables `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Notifications are sent for PASS and important REVIEW results only. The named history store retains the last notification fingerprint (`listing ID + price + status`) to prevent repeated two-hour alerts.

Deal alerts show the status, floor, renovation before/after contingency, Base ARV, conservative-to-upside profit range, conservative ROI, and listing link. Every non-dry run also sends a concise run summary with discovery, incremental, deal, runtime, and near-final Apify cost counters.

See `google-apps-script/README.md` for the credential-free Google Sheets bridge deployment.
