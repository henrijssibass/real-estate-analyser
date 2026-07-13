import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue, sleep } from 'crawlee';
import type { ActorInput, Listing, SeenRecord, SearchInput, UnderwritingResult } from './types.js';
import { enrichFromDetail, nextPaginationUrl, parseSearchRows } from './parse.js';
import { compactSeenRecord, hasImportantSearchChange, type ChangeType } from './history.js';
import { loadActiveSearchUrls, syncAndUnderwrite, type SheetsSyncResult } from './sheets.js';
import { notificationFingerprint, sendTelegram, sendTelegramSummary, shouldNotify } from './telegram.js';
import { calendarDateInTimeZone, shouldSendSummary } from './summary-policy.js';

await Actor.init();
const startedAt = Date.now();
const input = (await Actor.getInput<ActorInput>()) ?? {};
const runMode = input.runMode ?? 'INCREMENTAL';
const fullScan = runMode === 'FULL_SCAN';
const dryRun = input.dryRun ?? false;
const store = await Actor.openKeyValueStore('SS-COM-SEEN-HISTORY');
let sheetsRequests = 0;

// Scheduled input is the zero-cost configuration cache. A Sheets lookup is only
// needed when no URLs were supplied to the run (for example, an ad-hoc run).
let searchUrls: SearchInput[] = input.searchUrls ?? [];
if (searchUrls.length === 0) {
  sheetsRequests++;
  searchUrls = await loadActiveSearchUrls();
}
if (searchUrls.length === 0) throw new Error('No active public SS.com sale search URLs are configured');

const candidateLimit = fullScan ? Math.min(input.maxListingsPerRun ?? 1000, 1000) : Math.min(input.maxListingsPerRun ?? 100, 100);
const scrapeDetails = input.scrapeDetails ?? true;
const delayMs = (fullScan ? (input.requestDelaySecs ?? 1.5) : Math.min(input.requestDelaySecs ?? 0.2, 0.2)) * 1000;
const concurrency = Math.min(input.maxConcurrency ?? (fullScan ? 2 : 4), fullScan ? 5 : 4);
const forceNewTarget = fullScan ? 0 : Math.min(Math.max(input.diagnosticForceNewListings ?? 0, 0), 20);
const configuredMemoryMb = Number(process.env.ACTOR_MEMORY_MBYTES ?? 0) || null;
let peakMemoryMb = Math.ceil(process.memoryUsage().rss / 1024 / 1024);
const sampleMemory = () => { peakMemoryMb = Math.max(peakMemoryMb, Math.ceil(process.memoryUsage().rss / 1024 / 1024)); };

const queue = await RequestQueue.open();
const allowedHosts = new Set(['www.ss.com', 'ss.com', 'www.ss.lv', 'ss.lv']);
const historyIndex = (await store.getValue<Record<string, SeenRecord>>('HISTORY_INDEX')) ?? {};
let historyMigrationReads = 0;
let historyDirty = false;
let totalListingsDiscovered = 0;
let searchRowsObserved = 0;
let newListings = 0;
let changedListings = 0;
let skippedOldListings = 0;
let filteredOut = 0;
let forcedNewListings = 0;
let searchPageRequests = 0;
let detailPageRequests = 0;
let telegramRequests = 0;
const ignoredReasons: Record<string, number> = {};
const ignore = (reason: string) => { ignoredReasons[reason] = (ignoredReasons[reason] ?? 0) + 1; };
const runSeenKeys = new Set<string>();
const checkedSearchUrls = new Set<string>();
const evaluatedListings: Listing[] = [];
const listingHistory = new Map<string, SeenRecord>();
const pendingPrevious = new Map<string, SeenRecord | undefined>();
const pendingChangeType = new Map<string, ChangeType>();

for (const item of searchUrls) {
  const url = typeof item === 'string' ? item : item.url;
  const name = typeof item === 'string' ? new URL(url).pathname : (item.name || new URL(url).pathname);
  const parsed = new URL(url);
  if (!allowedHosts.has(parsed.hostname) || !/\/real-estate\/flats\/.+\/sell\//.test(parsed.pathname)) throw new Error(`Unsupported search URL: ${url}`);
  const district = typeof item === 'string' ? decodeURIComponent(parsed.pathname.split('/').at(-3) ?? '') : (item.district || decodeURIComponent(parsed.pathname.split('/').at(-3) ?? ''));
  const seriesFocus = typeof item === 'string' ? 'All' : item.seriesFocus ?? 'All';
  const roomsFocus = typeof item === 'string' ? 'All' : item.roomsFocus ?? 'All';
  await queue.addRequest({url, uniqueKey:`SEARCH-${url}`, userData:{label:'SEARCH', searchName:name, district, seriesFocus, roomsFocus, rootSearchUrl:url, pageNumber:1}});
}

const crawler = new CheerioCrawler({
  requestQueue: queue,
  maxConcurrency: concurrency,
  maxRequestRetries: 2,
  respectRobotsTxtFile: true,
  additionalMimeTypes: ['text/html'],
  requestHandlerTimeoutSecs: 45,
  async requestHandler({request, $}) {
    if (delayMs > 0) await sleep(delayMs);
    sampleMemory();
    if (request.userData.label === 'SEARCH') {
      searchPageRequests++;
      checkedSearchUrls.add(request.userData.rootSearchUrl ?? request.url);
      const listings = parseSearchRows($, request.url, request.userData.searchName, request.userData.district, new Date().toISOString());
      let pageHasNewOrChanged = false;
      for (const listing of listings) {
        const uniqueKey = listing.listingId || listing.url;
        if (runSeenKeys.has(uniqueKey)) continue;
        runSeenKeys.add(uniqueKey);
        searchRowsObserved++;

        if (!matchesFocus(listing, request.userData.seriesFocus, request.userData.roomsFocus)) {
          filteredOut++;
          ignore('SEARCH_ROW_FILTER_MISMATCH');
          continue;
        }

        let previous: SeenRecord | undefined = historyIndex[listing.listingId];
        if (!previous) {
          // One-time migration path from the old per-listing storage layout.
          previous = await store.getValue<SeenRecord>(`listing-${listing.listingId}`) ?? undefined;
          historyMigrationReads++;
          if (previous) historyIndex[listing.listingId] = previous;
        }
        const naturallyUnchanged = Boolean(previous && !hasImportantSearchChange(previous, listing));
        const forceThisListing = naturallyUnchanged && forcedNewListings < forceNewTarget;

        if (naturallyUnchanged && !fullScan && !forceThisListing) {
          skippedOldListings++;
          historyIndex[listing.listingId] = compactSeenRecord(previous, listing, 'UNCHANGED');
          historyDirty = true;
          continue;
        }

        if (!fullScan && totalListingsDiscovered >= candidateLimit) {
          ignore('INCREMENTAL_CANDIDATE_LIMIT');
          continue;
        }

        pageHasNewOrChanged = true;
        let changeType: ChangeType;
        if (forceThisListing) {
          changeType = 'NEW';
          forcedNewListings++;
          newListings++;
        } else if (!previous) {
          changeType = 'NEW';
          newListings++;
        } else if (naturallyUnchanged) {
          changeType = 'UNCHANGED';
        } else {
          changeType = previous.lastPriceEur !== listing.priceEur ? 'PRICE_CHANGED' : 'CONTENT_CHANGED';
          changedListings++;
        }
        totalListingsDiscovered++;
        pendingPrevious.set(listing.listingId, previous);
        pendingChangeType.set(listing.listingId, changeType);

        if (scrapeDetails) {
          await queue.addRequest({url:listing.url, uniqueKey:`DETAIL-${listing.listingId}`, userData:{label:'DETAIL', listing}});
        } else {
          processListing(listing);
        }
      }

      // INCREMENTAL walks one page at a time. It never fans out every pagination
      // link, and it stops as soon as a complete page is unchanged.
      const next = nextPaginationUrl($, request.url);
      if (next && (fullScan || pageHasNewOrChanged) && (fullScan || totalListingsDiscovered < candidateLimit)) {
        await queue.addRequest({url:next, uniqueKey:`SEARCH-${next}`, userData:{...request.userData, pageNumber:Number(request.userData.pageNumber ?? 1) + 1}});
      } else if (!pageHasNewOrChanged && listings.length) {
        log.info('Incremental pagination stopped on unchanged page', {url:request.url, listings:listings.length});
      }
      return;
    }

    detailPageRequests++;
    processListing(enrichFromDetail($, request.userData.listing as Listing));
  },
  failedRequestHandler({request}, error) {
    if (request.userData.label === 'SEARCH') checkedSearchUrls.add(request.userData.rootSearchUrl ?? request.url);
    log.warning(`Request failed safely: ${request.url}`, {error:error.message});
  },
});

function processListing(listing: Listing) {
  const normalized: Listing = listing.bathrooms == null ? {...listing, bathrooms:1} : listing;
  const changeType = pendingChangeType.get(normalized.listingId) ?? 'NEW';
  const previous = pendingPrevious.get(normalized.listingId);
  const record = compactSeenRecord(previous, normalized, changeType);
  historyIndex[normalized.listingId] = record;
  historyDirty = true;
  evaluatedListings.push(Object.assign(normalized, {changeType, firstSeenAt:record.firstSeenAt, isNew:changeType === 'NEW', _changeType:changeType, _firstSeenAt:record.firstSeenAt}));
  listingHistory.set(normalized.listingId, record);
}

function matchesFocus(listing: Listing, seriesFocus?: string, roomsFocus?: string) {
  const all = (value?: string) => !value || value.trim().toLowerCase() === 'all';
  const seriesOk = all(seriesFocus) || seriesFocus!.split(',').map((value) => value.trim().toLowerCase()).includes((listing.series ?? '').trim().toLowerCase());
  const roomsOk = all(roomsFocus) || roomsFocus!.split(',').map((value) => Number(value.trim())).includes(Number(listing.rooms));
  return seriesOk && roomsOk;
}

await crawler.run();
sampleMemory();

let sheetsSync: SheetsSyncResult = {analyses:new Map(), sheetsRowsWritten:0};
if (evaluatedListings.length > 0) {
  sheetsRequests++;
  sheetsSync = await syncAndUnderwrite(evaluatedListings, input.minProfit ?? 7000);
}
const analyses = sheetsSync.analyses;
let notificationsSent = 0;
const statusCounts: Record<string, number> = {};

for (const listing of evaluatedListings) {
  const internal = listing as Listing & {_changeType:string; _firstSeenAt:string};
  const analysis = analyses.get(listing.listingId);
  const riskFlags = analysis?.riskFlags ?? ['DEAL_ANALYSIS_PENDING_SHEET_SYNC'];
  const output = {...listing, firstSeenAt:internal._firstSeenAt, isNew:internal._changeType === 'NEW', changeType:internal._changeType,
    ...(analysis ?? {status:'UNCERTAIN', confidence:'LOW'}), riskFlags, minProfitEur:input.minProfit ?? 7000};
  delete (output as Record<string, unknown>)._changeType;
  delete (output as Record<string, unknown>)._firstSeenAt;
  const record = listingHistory.get(listing.listingId)!;
  const statusChanged = Boolean(analysis && record.lastStatus && record.lastStatus !== analysis.status);
  const finalStatus = analysis?.status ?? 'UNCERTAIN';
  statusCounts[finalStatus] = (statusCounts[finalStatus] ?? 0) + 1;
  const actionable = analysis?.status === 'PASS' || analysis?.status === 'REVIEW';
  if (actionable && (fullScan || internal._changeType !== 'UNCHANGED' || statusChanged)) await Actor.pushData(output);
  if (!dryRun && analysis) {
    const fingerprint = notificationFingerprint(listing, analysis);
    const hasDealNumbers = analysis.underwritingArvEur != null && analysis.expectedProfitEur != null && analysis.roi != null;
    if (hasDealNumbers && shouldNotify(analysis, !fullScan && record.lastNotifiedFingerprint === fingerprint)) {
      telegramRequests++;
      if (await sendTelegram(listing, analysis)) {
        record.lastNotifiedFingerprint = fingerprint;
        notificationsSent++;
      }
    }
    record.lastStatus = analysis.status;
    historyIndex[listing.listingId] = record;
    historyDirty = true;
  }
}

for (const listing of evaluatedListings) {
  const analysis = analyses.get(listing.listingId);
  if (!analysis) { ignore('UNDERWRITING_UNAVAILABLE'); continue; }
  if (analysis.status === 'FAIL' || analysis.status === 'UNCERTAIN') {
    const reasons = analysis.riskFlags.length ? analysis.riskFlags : ['PROFIT_OR_ROI_BELOW_THRESHOLD'];
    for (const reason of reasons) ignore(reason);
  }
}

if (historyDirty && !dryRun) await store.setValue('HISTORY_INDEX', historyIndex);

const pass = statusCounts.PASS ?? 0;
const review = statusCounts.REVIEW ?? 0;
const analysisIgnored = (statusCounts.FAIL ?? 0) + (statusCounts.UNCERTAIN ?? 0) + filteredOut;
const dealNotificationsSent = notificationsSent;
const runtimeSecondsBeforeSummary = Math.round((Date.now() - startedAt) / 1000);
const usageTotalUsd = await getCurrentRunCostUsd();
let summarySent = false;
const summaryFrequency = input.summaryFrequency ?? 'DAILY';
const summaryDate = calendarDateInTimeZone(new Date());
const summaryState = await store.getValue<{lastSentDate?:string}>('TELEGRAM_SUMMARY_STATE');
const summaryDue = !dryRun && shouldSendSummary(summaryFrequency, summaryDate, summaryState?.lastSentDate);
if (summaryDue) {
  telegramRequests++;
  summarySent = await sendTelegramSummary({runMode, activeUrlsConfigured:searchUrls.length, activeUrlsChecked:checkedSearchUrls.size,
    totalListingsDiscovered, newListings, changedListings, skippedOldListings, evaluated:evaluatedListings.length,
    ignored:analysisIgnored, pass, review, dealNotificationsSent, runtimeSeconds:runtimeSecondsBeforeSummary,
    estimatedCostUsd:usageTotalUsd, searchPageRequests, detailPageRequests, sheetsRequests});
  if (summarySent) {
    notificationsSent++;
    await store.setValue('TELEGRAM_SUMMARY_STATE', {lastSentDate:summaryDate, lastSentAt:new Date().toISOString()});
  }
}
sampleMemory();

const runSummary = {
  finishedAt:new Date().toISOString(), runMode, activeUrlsConfigured:searchUrls.length, activeUrlsChecked:checkedSearchUrls.size,
  totalListingsDiscovered, searchRowsObserved, newListings, changedListings, skippedOldListings,
  evaluated:evaluatedListings.length, pass, review, ignored:analysisIgnored, ignoredReasons,
  sheetsRowsWritten:sheetsSync.sheetsRowsWritten, dealNotificationsSent, notificationsSent, summarySent,
  searchPageRequests, detailPageRequests, sheetsRequests, telegramRequests,
  runtimeMs:Date.now() - startedAt, runtimeSeconds:Math.round((Date.now() - startedAt) / 1000),
  memoryMb:configuredMemoryMb, peakMemoryMb, usageTotalUsd, estimatedCostUsd:usageTotalUsd,
  maxListings:candidateLimit, maxConcurrency:concurrency, requestDelaySecs:delayMs / 1000,
  historyIndexEntries:Object.keys(historyIndex).length, historyMigrationReads, forcedNewListings,
  summaryFrequency, summaryDue, summaryDate, dryRun, sheetsConnected:analyses.size > 0, statusCounts,
};
log.info('RUN_SUMMARY', runSummary);
await Actor.setValue('RUN_SUMMARY', runSummary);
await Actor.exit();

async function getCurrentRunCostUsd(): Promise<number | null> {
  const runId = process.env.ACTOR_RUN_ID;
  const token = process.env.APIFY_TOKEN;
  const base = process.env.APIFY_API_PUBLIC_BASE_URL ?? 'https://api.apify.com';
  if (!runId || !token || process.env.APIFY_IS_AT_HOME !== '1') return null;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/v2/actor-runs/${runId}`, {headers:{authorization:`Bearer ${token}`}});
    if (!response.ok) return null;
    const body = await response.json() as {data?:{usageTotalUsd?:number}};
    const value = Number(body.data?.usageTotalUsd);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    log.warning('Apify cost estimate unavailable', {message:error instanceof Error ? error.message : String(error)});
    return null;
  }
}
