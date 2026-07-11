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

Until the Sheet sync imports the workbook's comparable and cost tables, changed listings are emitted as `UNCERTAIN` with `DEAL_ANALYSIS_PENDING_SHEET_SYNC`. This prevents false PASS decisions.

When SS.com does not publish a bathroom count, the Actor uses `bathrooms: 1` and emits the `LOW_CONFIDENCE_BATHROOM_COUNT` risk flag. A later Sheet override may replace that assumption.
