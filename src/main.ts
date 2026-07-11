import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue, sleep } from 'crawlee';
import type { ActorInput, Listing } from './types.js';
import { enrichFromDetail, paginationUrls, parseSearchRows } from './parse.js';
import { updateHistory } from './history.js';

await Actor.init();
const input=(await Actor.getInput<ActorInput>()) ?? {searchUrls:[]};
if (!Array.isArray(input.searchUrls) || input.searchUrls.length===0) throw new Error('searchUrls must contain at least one public SS.com sale search URL');
const maxListings=input.maxListingsPerRun??100, scrapeDetails=input.scrapeDetails??true, delay=(input.requestDelaySecs??1.5)*1000;
const queue=await RequestQueue.open(); const store=await Actor.openKeyValueStore('SS-COM-SEEN-HISTORY');
const allowedHosts=new Set(['www.ss.com','ss.com','www.ss.lv','ss.lv']); let discovered=0;
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
  if (changeType==='UNCHANGED') return;
  const riskFlags=['DEAL_ANALYSIS_PENDING_SHEET_SYNC'];
  if (bathroomWasMissing) riskFlags.push('LOW_CONFIDENCE_BATHROOM_COUNT');
  await Actor.pushData({...normalized,firstSeenAt:record.firstSeenAt,isNew:changeType==='NEW',changeType,status:'UNCERTAIN',confidence:'LOW',riskFlags,minProfitEur:input.minProfit??7000});
}
await crawler.run();
await Actor.setValue('RUN_SUMMARY',{finishedAt:new Date().toISOString(),discovered,maxListings,dryRun:input.dryRun??false});
await Actor.exit();
