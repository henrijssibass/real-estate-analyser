import { Actor, log } from 'apify';
import { CheerioCrawler, RequestQueue, sleep } from 'crawlee';
import type { ActorInput, Listing } from './types.js';
import { enrichFromDetail, paginationUrls, parseSearchRows } from './parse.js';
import { hasImportantSearchChange, markSeenUnchanged, updateHistory } from './history.js';
import { loadActiveSearchUrls, syncAndUnderwrite } from './sheets.js';
import { notificationFingerprint, sendTelegram, sendTelegramSummary, shouldNotify } from './telegram.js';
import type { SeenRecord } from './types.js';

await Actor.init();
const startedAt=Date.now();
const input=(await Actor.getInput<ActorInput>()) ?? {};
const runMode=input.runMode??'INCREMENTAL'; const fullScan=runMode==='FULL_SCAN';
const sheetSearchUrls=await loadActiveSearchUrls();
const searchUrls=sheetSearchUrls.length?sheetSearchUrls:(input.searchUrls??[]);
if (searchUrls.length===0) throw new Error('No active public SS.com sale search URLs are configured');
const maxListings=input.maxListingsPerRun??100, scrapeDetails=input.scrapeDetails??true, delay=(input.requestDelaySecs??1.5)*1000;
const queue=await RequestQueue.open(); const store=await Actor.openKeyValueStore('SS-COM-SEEN-HISTORY');
const allowedHosts=new Set(['www.ss.com','ss.com','www.ss.lv','ss.lv']); let discovered=0,newListings=0,changedListings=0,skippedOldListings=0,filteredOut=0;
const ignoredReasons:Record<string,number>={}; const ignore=(reason:string)=>{ignoredReasons[reason]=(ignoredReasons[reason]??0)+1;};
const runSeenKeys=new Set<string>(),checkedSearchUrls=new Set<string>();
const evaluatedListings: Listing[]=[]; const listingHistory=new Map<string,SeenRecord>();
for (const item of searchUrls) {
  const url=typeof item==='string'?item:item.url; const name=typeof item==='string'?new URL(url).pathname:url && (item.name||new URL(url).pathname);
  const parsed=new URL(url); if (!allowedHosts.has(parsed.hostname) || !/\/real-estate\/flats\/.+\/sell\//.test(parsed.pathname)) throw new Error(`Unsupported search URL: ${url}`);
  const district=typeof item==='string'?decodeURIComponent(parsed.pathname.split('/').at(-3)??''):(item.district||decodeURIComponent(parsed.pathname.split('/').at(-3)??''));
  const seriesFocus=typeof item==='string'?'All':item.seriesFocus??'All'; const roomsFocus=typeof item==='string'?'All':item.roomsFocus??'All';
  await queue.addRequest({url,userData:{label:'SEARCH',searchName:name,district,seriesFocus,roomsFocus,rootSearchUrl:url}});
}
const crawler=new CheerioCrawler({ requestQueue:queue, maxConcurrency:Math.min(input.maxConcurrency??2,5), maxRequestRetries:2, respectRobotsTxtFile:true,
  additionalMimeTypes:['text/html'], requestHandlerTimeoutSecs:45,
  async requestHandler({request,$,enqueueLinks}) {
    await sleep(delay);
    if (request.userData.label==='SEARCH') {
      checkedSearchUrls.add(request.userData.rootSearchUrl??request.url);
      const listings=parseSearchRows($,request.url,request.userData.searchName,request.userData.district,new Date().toISOString());
      let pageHasNewOrChanged=false;
      for (const listing of listings) { if (discovered>=maxListings) break;
        const uniqueKey=listing.listingId||listing.url; if(runSeenKeys.has(uniqueKey)) continue; runSeenKeys.add(uniqueKey); discovered++;
        const previous=await store.getValue<SeenRecord>(`listing-${listing.listingId}`);
        const unchanged=Boolean(previous&&!hasImportantSearchChange(previous,listing));
        if(unchanged&&!fullScan){skippedOldListings++;await markSeenUnchanged(store,previous!,listing,input.dryRun??false);continue;}
        pageHasNewOrChanged=true; if(!previous)newListings++; else if(!unchanged)changedListings++;
        if(unchanged&&fullScan&&previous?.listingSnapshot){await processListing({...previous.listingSnapshot,...listing,description:previous.listingSnapshot.description,imageUrls:previous.listingSnapshot.imageUrls,sellerType:previous.listingSnapshot.sellerType,publishedAt:previous.listingSnapshot.publishedAt},request.userData.seriesFocus,request.userData.roomsFocus);continue;}
        if (scrapeDetails) await queue.addRequest({url:listing.url,uniqueKey:`DETAIL-${listing.listingId}`,userData:{label:'DETAIL',listing,seriesFocus:request.userData.seriesFocus,roomsFocus:request.userData.roomsFocus}}); else await processListing(listing,request.userData.seriesFocus,request.userData.roomsFocus); }
      if (discovered<maxListings&&(fullScan||pageHasNewOrChanged)) for (const url of paginationUrls($,request.url)) await queue.addRequest({url,userData:request.userData});
      else if(!pageHasNewOrChanged&&listings.length) log.info('Pagination stopped after an unchanged results page',{url:request.url,listings:listings.length});
      return;
    }
    await processListing(enrichFromDetail($,request.userData.listing as Listing),request.userData.seriesFocus,request.userData.roomsFocus);
  },
  failedRequestHandler({request},error) { if(request.userData.label==='SEARCH') checkedSearchUrls.add(request.userData.rootSearchUrl??request.url); log.warning(`Request failed safely: ${request.url}`,{error:error.message}); }
});
async function processListing(listing:Listing,seriesFocus?:string,roomsFocus?:string) {
  if(!matchesFocus(listing,seriesFocus,roomsFocus)){filteredOut++;ignore('SEARCH_ROW_FILTER_MISMATCH');return;}
  const bathroomWasMissing=listing.bathrooms==null;
  const normalized:Listing=bathroomWasMissing?{...listing,bathrooms:1}:listing;
  const {changeType,record}=await updateHistory(store,normalized,input.dryRun??false);
  evaluatedListings.push(Object.assign(normalized,{changeType,firstSeenAt:record.firstSeenAt,isNew:changeType==='NEW',_changeType:changeType,_firstSeenAt:record.firstSeenAt,_bathroomWasMissing:bathroomWasMissing}));
  listingHistory.set(normalized.listingId,record);
}
function matchesFocus(listing:Listing,seriesFocus?:string,roomsFocus?:string){
  const all=(v?:string)=>!v||v.trim().toLowerCase()==='all';
  const seriesOk=all(seriesFocus)||seriesFocus!.split(',').map(v=>v.trim().toLowerCase()).includes((listing.series??'').trim().toLowerCase());
  const roomsOk=all(roomsFocus)||roomsFocus!.split(',').map(v=>Number(v.trim())).includes(Number(listing.rooms));
  return seriesOk&&roomsOk;
}
await crawler.run();
const sheetsSync=await syncAndUnderwrite(evaluatedListings,input.minProfit??7000); const analyses=sheetsSync.analyses;
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
  const actionable=analysis?.status==='PASS'||analysis?.status==='REVIEW';
  if(actionable&&(fullScan||internal._changeType!=='UNCHANGED'||statusChanged)) await Actor.pushData(output);
  if(!input.dryRun&&analysis){ const fingerprint=notificationFingerprint(listing,analysis);
    const hasDealNumbers=analysis.underwritingArvEur!=null&&analysis.expectedProfitEur!=null&&analysis.roi!=null;
    if(hasDealNumbers&&shouldNotify(analysis,!fullScan&&record.lastNotifiedFingerprint===fingerprint)&&await sendTelegram(listing,analysis)){record.lastNotifiedFingerprint=fingerprint;notificationsSent++;}
    record.lastStatus=analysis.status; await store.setValue(`listing-${listing.listingId}`,record);}
}
for(const listing of evaluatedListings){const analysis=analyses.get(listing.listingId);if(!analysis){ignore('UNDERWRITING_UNAVAILABLE');continue;}if(analysis.status==='FAIL'||analysis.status==='UNCERTAIN'){const reasons=analysis.riskFlags.length?analysis.riskFlags:['PROFIT_OR_ROI_BELOW_THRESHOLD'];for(const reason of reasons)ignore(reason);}}
const pass=statusCounts.PASS??0,review=statusCounts.REVIEW??0,analysisIgnored=(statusCounts.FAIL??0)+(statusCounts.UNCERTAIN??0)+filteredOut;
let heartbeatSent=false; if(!input.dryRun&&input.sendSummaryHeartbeat&&pass===0&&review===0){heartbeatSent=await sendTelegramSummary({activeUrlsChecked:checkedSearchUrls.size,totalListingsDiscovered:discovered,skippedOldListings,evaluated:evaluatedListings.length,pass,review});if(heartbeatSent)notificationsSent++;}
const runSummary={finishedAt:new Date().toISOString(),runMode,activeUrlsConfigured:searchUrls.length,activeUrlsChecked:checkedSearchUrls.size,totalListingsDiscovered:discovered,newListings,changedListings,skippedOldListings,
  evaluated:evaluatedListings.length,pass,review,ignored:analysisIgnored,ignoredReasons,sheetsRowsWritten:sheetsSync.sheetsRowsWritten,notificationsSent,heartbeatSent,runtimeMs:Date.now()-startedAt,runtimeSeconds:Math.round((Date.now()-startedAt)/1000),maxListings,dryRun:input.dryRun??false,sheetsConnected:analyses.size>0,statusCounts};
log.info('RUN_SUMMARY',runSummary); await Actor.setValue('RUN_SUMMARY',runSummary);
await Actor.exit();
