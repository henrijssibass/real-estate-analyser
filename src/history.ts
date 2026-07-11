import type { KeyValueStore } from 'apify';
import type { Listing, SeenRecord } from './types.js';
import { contentHash } from './parse.js';

export type ChangeType = 'NEW'|'PRICE_CHANGED'|'CONTENT_CHANGED'|'UNCHANGED';
export async function updateHistory(store: KeyValueStore, listing: Listing, dryRun=false): Promise<{changeType:ChangeType; record:SeenRecord}> {
  const key=`listing-${listing.listingId}`; const previous=await store.getValue<SeenRecord>(key); const hash=contentHash(listing);
  const changeType:ChangeType=!previous?'NEW':previous.lastPriceEur!==listing.priceEur?'PRICE_CHANGED':previous.contentHash!==hash?'CONTENT_CHANGED':'UNCHANGED';
  const record:SeenRecord={ listingId:listing.listingId,url:listing.url,firstSeenAt:previous?.firstSeenAt??listing.scrapedAt,lastSeenAt:listing.scrapedAt,lastPriceEur:listing.priceEur,contentHash:hash,
    priceHistory:previous?.priceHistory??[{at:listing.scrapedAt,priceEur:listing.priceEur}],lastNotifiedFingerprint:previous?.lastNotifiedFingerprint,lastStatus:previous?.lastStatus };
  if (changeType==='PRICE_CHANGED') record.priceHistory=[...record.priceHistory,{at:listing.scrapedAt,priceEur:listing.priceEur}].slice(-50);
  if (!dryRun) await store.setValue(key,record); return {changeType,record};
}
