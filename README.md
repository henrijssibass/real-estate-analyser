# SS.com Apartment Deal Finder

Low-cost Apify Actor using TypeScript, Crawlee and `CheerioCrawler`. It reads only public SS.com apartment-sale pages, honors `robots.txt`, rate-limits requests, stores compact seen/price history in the named key-value store `SS-COM-SEEN-HISTORY`, and emits only new or changed listings.

## Local development

```bash
npm install
npm test
npm run build
```

Run with Apify CLI or set `APIFY_INPUT` to the JSON accepted by `.actor/input_schema.json`. For a one-district test, explicitly set `searchUrlsSource: "INPUT"`, one Ķengarags URL, `maxListingsPerRun: 20`, and `dryRun: true`.

## Safety

The Actor does not authenticate, solve CAPTCHAs, rotate identities to evade blocks, contact sellers, or mutate source data. A blocked/CAPTCHA response is treated as a failed request. Telegram and Google Sheets credentials remain encrypted Apify secrets; no credentials belong in source control or workbook cells.

## Current output

When `GOOGLE_SHEETS_WEBHOOK_URL` and `GOOGLE_SHEETS_WEBHOOK_SECRET` are configured, the Actor sends scraped listings to the bound Apps Script bridge for live workbook underwriting and receives PASS / REVIEW / FAIL results. Without that bridge, changed listings remain `UNCERTAIN` with `DEAL_ANALYSIS_PENDING_SHEET_SYNC`.

Base ARV is `ARV_Summary`'s arithmetic mean €/m² for district + series + rooms multiplied by the listing's area. All valid `ARV_Comps` rows are user-confirmed, including rows with blank legacy approval fields. Bathroom count does not affect comparable matching or deal qualification.

Telegram uses only the encrypted Apify variables `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Notifications are sent for PASS and important REVIEW results only. The named history store retains the last notification fingerprint (`listing ID + price + status`) to prevent repeated scheduled alerts.

Deal alerts show status, rooms, floor, series, renovation before/after contingency, other costs, Base ARV, profit range, ROI on total investment, and the listing link. Run summaries are throttled to once daily by default.

## Incremental cost controls

The production schedule runs `INCREMENTAL` every 30 minutes using 256 MB, at most four concurrent Cheerio requests, and a 0.2-second handler delay. Set scheduled `searchUrlsSource: "SHEET"` so the bridge reads all active `Search_URLs` rows, including newly added districts; an empty URL array alone is unsafe because the Console may restore schema defaults. Use `INPUT` only for explicit one-district tests. The Actor checks page 1, compares ID/URL/price with compact history, and requests details only for new or materially changed rows. Pagination continues while pages contain changes. A zero-change run skips underwriting, detail pages and Dataset output. PASS/REVIEW alerts remain immediate; summaries run once per Europe/Riga calendar day. Based on 44 recent runs averaging about $0.00245, 1,440 runs in 30 days project to $3.53; actual usage varies.

Underwriting uses sequential batches of at most 50 listings. The bridge upserts qualified candidates in one bulk write and removes previously stored candidates when re-analysis no longer qualifies them. FAIL results and raw listings are never appended to Sheets. Failed analyses stay pending in history and are retried on a future incremental run, with the run marked failed instead of quietly discarding the listings. Dry runs suppress Sheets writes and Telegram alerts.

After a crawl finishes successfully, the Actor drops its temporary default request queue. Do not delete the named `SS-COM-SEEN-HISTORY` key-value store: it contains the compact history and notification state that prevent repeat processing and duplicate alerts.

`FULL_SCAN` remains separately capped at 1,000 candidates and may use the configured longer delay. `RUN_SUMMARY` includes search/detail/Sheets/Telegram request counts, configured and peak memory, runtime, and current `usageTotalUsd`.

For an explicitly budgeted one-off market review, set `runMode: "FULL_SCAN"`, `fullScanAll: true`, `topDealsLimit: 10`, and `summaryFrequency: "EVERY_RUN"`. Set a platform maximum run cost and timeout separately. With `scrapeDetails: false`, the scan uses apartment table fields and does not spend requests opening every detail page. All qualified candidates still sync to Sheets, while only the ten highest profits **after contingency and all costs** enter the Dataset and Telegram alerts. Any failed page, blocked pagination, listing cap, or missing analysis makes the scan incomplete and suppresses the purported global top list; Telegram receives an explicit incomplete-scan summary instead. `TOP_DEALS` stores the ranked result and coverage metadata. A one-off summary does not change the scheduled daily-summary state or the incremental schedule.

See `google-apps-script/README.md` for the credential-free Google Sheets bridge deployment.
