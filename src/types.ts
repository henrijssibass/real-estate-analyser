export type SearchInput = string | { url: string; name?: string; district?: string; seriesFocus?: string; roomsFocus?: string };
export interface ActorInput {
  searchUrls?: SearchInput[];
  minProfit?: number;
  maxListingsPerRun?: number;
  scrapeDetails?: boolean;
  dryRun?: boolean;
  maxConcurrency?: number;
  requestDelaySecs?: number;
}
export interface Listing {
  listingId: string; source: 'SS.com'; url: string; scrapedAt: string;
  publishedAt: string | null; searchName: string; district: string;
  address: string; rooms: number | null; bathrooms: number | null;
  areaM2: number | null; floor: number | null; totalFloors: number | null;
  series: string | null; priceEur: number | null; pricePerM2: number | null;
  title: string; description: string; imageUrls: string[];
  sellerType: string | null;
}
export interface SeenRecord {
  listingId: string; url: string; firstSeenAt: string; lastSeenAt: string;
  lastPriceEur: number | null; contentHash: string;
  priceHistory: Array<{ at: string; priceEur: number | null }>;
  lastNotifiedFingerprint?: string;
  lastStatus?: DealStatus;
  listingSnapshot?: Listing;
}
export type DealStatus = 'PASS'|'REVIEW'|'FAIL'|'UNCERTAIN';
export interface UnderwritingResult {
  listingId: string; status: DealStatus; importantReview: boolean;
  renovationCostEur: number | null; otherCostsEur: number | null;
  totalProjectCostEur: number | null; conservativeArvEur: number | null;
  baseArvEur: number | null; stretchArvEur: number | null;
  expectedProfitEur: number | null; roi: number | null; profitMargin: number | null;
  maximumOfferEur: number | null; compCount: number; confidence: 'HIGH'|'MEDIUM'|'LOW';
  riskFlags: string[]; comparableEvidence: string;
}
