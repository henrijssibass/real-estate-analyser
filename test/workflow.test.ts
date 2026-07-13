import { describe,expect,it } from 'vitest';
import { formatTelegramDealAlert,notificationFingerprint,shouldNotify } from '../src/telegram.js';
import type { Listing,UnderwritingResult } from '../src/types.js';
import { compactSeenRecord, hasImportantSearchChange } from '../src/history.js';
const listing={listingId:'abc',priceEur:50000} as Listing;
const result={listingId:'abc',status:'PASS',importantReview:false} as UnderwritingResult;
describe('notification policy',()=>{
 it('notifies PASS once per price/status fingerprint',()=>{expect(shouldNotify(result,false)).toBe(true);expect(shouldNotify(result,true)).toBe(false);expect(notificationFingerprint(listing,result)).toBe('abc|50000|PASS');});
 it('notifies actionable REVIEW and never FAIL',()=>{expect(shouldNotify({...result,status:'REVIEW',importantReview:true},false)).toBe(true);expect(shouldNotify({...result,status:'FAIL'},false)).toBe(false);});
 it('formats a concise deal alert with status, floor, series and cost ranges',()=>{const text=formatTelegramDealAlert({...listing,district:'Ķengarags',address:'Dubnas 8',areaM2:36,floor:4,totalFloors:9,series:'602.',url:'https://example.test'} as Listing,{...result,renovationCostBeforeContingencyEur:14640,renovationCostEur:15372,baseArvEur:73924,underwritingArvEur:73924,expectedProfitEur:4754,expectedProfitLowEur:4754,expectedProfitHighEur:5486,roi:.076} as UnderwritingResult);expect(text).toContain('🏠 PASS — Ķengarags, Dubnas 8');expect(text).toContain('🏢 Floor: 4/9\n🏗 Series: 602.');expect(text).toContain('🔨 Renovation: €14,640–€15,372');expect(text).toContain('🏦 ARV: €73,924');expect(text).toContain('📈 Profit: €4,754–€5,486');expect(text).not.toMatch(/risk|confidence|comps/i);});
});

describe('compact history index',()=>{
 it('keeps search fingerprints without heavy detail content',()=>{
  const current={listingId:'abc',url:'https://example.test/abc',scrapedAt:'2026-01-01T00:00:00Z',source:'SS.com',searchName:'test',district:'A',address:'A',rooms:2,bathrooms:1,areaM2:50,floor:2,totalFloors:5,series:'602.',priceEur:50000,pricePerM2:1000,title:'Flat',description:'long detail',imageUrls:['https://img'],publishedAt:null,sellerType:null} as Listing;
  const record=compactSeenRecord(undefined,current,'NEW');
  expect(record.listingSnapshot?.description).toBe('');
  expect(record.listingSnapshot?.imageUrls).toEqual([]);
  expect(record.lastPriceEur).toBe(50000);
 });
});
describe('incremental listing detection',()=>{
 it('skips an unchanged seen listing',()=>{const current={listingId:'abc',url:'https://example.test/abc',address:'A',rooms:2,areaM2:50,floor:2,totalFloors:5,series:'602.',priceEur:50000,title:'Flat'} as Listing;const previous={listingId:'abc',url:current.url,lastPriceEur:50000,listingSnapshot:{...current,description:'full details'}} as any;expect(hasImportantSearchChange(previous,current)).toBe(false);});
 it('reprocesses price and important field changes',()=>{const current={listingId:'abc',url:'https://example.test/abc',address:'A',rooms:2,areaM2:50,floor:2,totalFloors:5,series:'602.',priceEur:50000,title:'Flat'} as Listing;const previous={listingId:'abc',url:current.url,lastPriceEur:50000,listingSnapshot:current} as any;expect(hasImportantSearchChange(previous,{...current,priceEur:48000})).toBe(true);expect(hasImportantSearchChange(previous,{...current,areaM2:52})).toBe(true);});
});
