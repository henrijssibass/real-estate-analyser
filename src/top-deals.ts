import type { Listing, UnderwritingResult } from './types.js';

export interface RankedDeal { rank:number; listing:Listing; analysis:UnderwritingResult }

export function resolveCandidateLimit(fullScan:boolean, requested:number|undefined, fullScanAll=false):number {
  if(fullScan&&fullScanAll)return Number.POSITIVE_INFINITY;
  return Math.min(requested??(fullScan?1000:100),fullScan?1000:100);
}

/** Rank only actionable, fully calculated deals by downside profit, never stretch ARV. */
export function selectTopDeals(listings:Listing[],analyses:Map<string,UnderwritingResult>,limit:number):RankedDeal[]{
  const seen=new Set<string>();
  const deals:listingsWithAnalysis[]=[];
  for(const listing of listings){
    const analysis=analyses.get(listing.listingId);
    const profit=analysis?.expectedProfitLowEur??analysis?.expectedProfitEur;
    if(seen.has(listing.listingId)||!analysis||!(analysis.status==='PASS'||analysis.status==='REVIEW'&&analysis.importantReview)
      ||profit==null||!Number.isFinite(profit)||analysis.roi==null||!Number.isFinite(analysis.roi))continue;
    seen.add(listing.listingId);deals.push({listing,analysis,profit});
  }
  deals.sort((a,b)=>b.profit-a.profit||(b.analysis.roi!-a.analysis.roi!)||a.listing.listingId.localeCompare(b.listing.listingId));
  return deals.slice(0,Math.max(0,Math.floor(limit))).map(({listing,analysis},i)=>({rank:i+1,listing,analysis}));
}
interface listingsWithAnalysis {listing:Listing;analysis:UnderwritingResult;profit:number}
