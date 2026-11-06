import type { Listing, UnderwritingResult } from './types.js';

export interface RankedDeal { rank:number; listing:Listing; analysis:UnderwritingResult; category?:'ROI'|'PROFIT'; roiRank?:number; profitRank?:number }

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

export function selectBalancedDeals(listings:Listing[],analyses:Map<string,UnderwritingResult>,limit:number,roiSlots:number):RankedDeal[]{
  const seen=new Set<string>();
  const profitOrder=selectTopDeals(listings,analyses,listings.length).filter(({listing:l})=>{
    // Same layout, floor, and address is normally a cross-post. Keep the better quote.
    const key=l.address?.trim()?[l.district,l.address,l.rooms,l.areaM2,l.floor,l.totalFloors].map(v=>String(v).toLowerCase().replace(/\s+/g,'')).join('|'):l.listingId;
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).map((d,i)=>({...d,rank:i+1}));
  const roiOrder=[...profitOrder].sort((a,b)=>b.analysis.roi!-a.analysis.roi!||a.rank-b.rank);
  const roiRanks=new Map(roiOrder.map((d,i)=>[d.listing.listingId,i+1]));
  const roi=roiOrder.slice(0,Math.min(limit,roiSlots));
  const used=new Set(roi.map(d=>d.listing.listingId));
  return [...roi.map(d=>({...d,category:'ROI' as const})),...profitOrder.filter(d=>!used.has(d.listing.listingId)).slice(0,limit-roi.length).map(d=>({...d,category:'PROFIT' as const}))]
    .map((d,i)=>({...d,rank:i+1,profitRank:d.rank,roiRank:roiRanks.get(d.listing.listingId)}));
}
