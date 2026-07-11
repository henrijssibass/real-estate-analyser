import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue, sleep } from 'crawlee';
import type { ActorInput, Listing } from './types.js';
import { enrichFromDetail, paginationUrls, parseSearchRows } from './parse.js';
import { updateHistory } from './history.js';
import { syncAndUnderwrite } from './sheets.js';
import { notificationFingerprint, sendTelegram, shouldNotify } from './telegram.js';
import type { SeenRecord } from './types.js';

await Actor.init();
const input=(await Actor.getInput<ActorInput>()) ?? {searchUrls:[]};
if (!Array.isArray(input.searchUrls) || input.searchUrls.length===0) throw new Error('searchUrls must contain at least one public SS.com sale search URL');
const maxListings=input.maxListingsPerRun??100, scrapeDetails=input.scrapeDetails??true, delay=(input.requestDelaySecs??1.5)*1000;
const queue=await RequestQueue.open(); const store=await Actor.openKeyValueStore('SS-COM-SEEN-HISTORY');
const allowedHosts=new Set(['www.ss.com','ss.com','www.ss.lv','ss.lv']); let discovered=0;
const evaluatedListings: Listing[]=[]; const listingHistory=new Map<string,SeenRecord>();
for (const item of input.searchUrls) {
  const url=typeof item==='string'?item:item.url; const name=typeof item==='string'?new URL(url).pathname:url && (item.name||new URL(url).pathname);
  const parsed=new URL(url); if (!allowedHosts.has(parsed.hostname) || !/\/real-estate\/flats\/.+\/sell\//.test(parsed.pathname)) throw new Error(`Unsupported search URL: ${url}`);
  const district=typeof item==='string'?decodeURIComponent(parsed.pathname.split('/').at(-3)??''):(item.district||decodeURIComponent(parsed.pathname.split('/').at(-3)??''));
  await queue.addRequest({url,userData:{label:'SEARCH',searchName:name,district}});
}
const crawler=new CheerioCrawler({ requestQueue:queue, maxConcurrency:Math.min(input.maxConcurrency??2,5), maxRequestRetries:2, respectRobotsTxtFile:true,
  additionalMimeTypes:['text/html'], requestHandlerTimeoutSecs:45,
  async requestHandler({request,$,enqueueLinks}) {
    await sleep(delay);
    if (request.userData.label==='SEARCH') {
      const listings=parseSearchRows($,request.url,request.userData.searchName,request.userData.district,new Date().toISOString());
      for (const listing of listings) { if (discovered>=maxListings) break; discovered++; if (scrapeDetails) await queue.addRequest({url:listing.url,uniqueKey:`DETAIL-${listing.listingId}`,userData:{label:'DETAIL',listing}}); else await processListing(listing); }
      if (discovered<maxListings) for (const url of paginationUrls($,request.url)) await queue.addRequest({url,userData:request.userData});
      return;
    }
    await processListing(enrichFromDetail($,request.userData.listing as Listing));
  },
  failedRequestHandler({request},error) { log.warning(`Request failed safely: ${request.url}`,{error:error.message}); }
});
async function processListing(listing:Listing) {
  const bathroomWasMissing=listing.bathrooms==null;
  const normalized:Listing=bathroomWasMissing?{...listing,bathrooms:1}:listing;
  const {changeType,record}=await updateHistory(store,normalized,input.dryRun??false);
  evaluatedListings.push(Object.assign(normalized,{changeType,firstSeenAt:record.firstSeenAt,isNew:changeType==='NEW',_changeType:changeType,_firstSeenAt:record.firstSeenAt,_bathroomWasMissing:bathroomWasMissing}));
  listingHistory.set(normalized.listingId,record);
}
await crawler.run();
const analyses=await syncAndUnderwrite(evaluatedListings,input.minProfit??7000);
let notificationsSent=0; const statusCounts:Record<string,number>={};
for (const listing of evaluatedListings) {
  const internal=listing as Listing & {_changeType:string;_firstSeenAt:string;_bathroomWasMissing:boolean};
  const analysis=analyses.get(listing.listingId); const riskFlags=analysis?.riskFlags??['DEAL_ANALYSIS_PENDING_SHEET_SYNC'];
  if(internal._bathroomWasMissing&&!riskFlags.includes('LOW_CONFIDENCE_BATHROOM_COUNT')) riskFlags.push('LOW_CONFIDENCE_BATHROOM_COUNT');
  const output={...listing,firstSeenAt:internal._firstSeenAt,isNew:internal._changeType==='NEW',changeType:internal._changeType,
    ...(analysis??{status:'UNCERTAIN',confidence:'LOW'}),riskFlags,minProfitEur:input.minProfit??7000};
  delete (output as Record<string,unknown>)._changeType; delete (output as Record<string,unknown>)._firstSeenAt; delete (output as Record<string,unknown>)._bathroomWasMissing;
  const record=listingHistory.get(listing.listingId)!; const statusChanged=Boolean(analysis&&record.lastStatus&&record.lastStatus!==analysis.status);
  const finalStatus=analysis?.status??'UNCERTAIN'; statusCounts[finalStatus]=(statusCounts[finalStatus]??0)+1;
  if(analysis?.status!=='FAIL'&&(internal._changeType!=='UNCHANGED'||statusChanged)) await Actor.pushData(output);
  if(!input.dryRun&&analysis){ const fingerprint=notificationFingerprint(listing,analysis);
    if(shouldNotify(analysis,record.lastNotifiedFingerprint===fingerprint)&&await sendTelegram(listing,analysis)){record.lastNotifiedFingerprint=fingerprint;notificationsSent++;}
    record.lastStatus=analysis.status; await store.setValue(`listing-${listing.listingId}`,record);}
}
await Actor.setValue('RUN_SUMMARY',{finishedAt:new Date().toISOString(),discovered,evaluated:evaluatedListings.length,maxListings,dryRun:input.dryRun??false,sheetsConnected:analyses.size>0,statusCounts,notificationsSent});
await Actor.exit();
