import {describe,it,expect} from 'vitest';
import {resolveCandidateLimit,selectTopDeals} from '../src/top-deals.js';
import {formatTelegramRunSummary,type TelegramRunSummary} from '../src/telegram.js';
import type {Listing,UnderwritingResult} from '../src/types.js';

const listing=(id:string)=>({listingId:id,district:'Teika',address:id} as Listing);
const analysis=(id:string,profit:number,extra:Partial<UnderwritingResult>={})=>({listingId:id,status:'PASS',importantReview:false,
  expectedProfitLowEur:profit,expectedProfitHighEur:profit+3000,expectedProfitEur:profit,roi:.15,...extra} as UnderwritingResult);

describe('one-off full-market ranking',()=>{
  it('preserves scheduled limits but allows explicit all-listing full scans',()=>{
    expect(resolveCandidateLimit(false,1000,true)).toBe(100);
    expect(resolveCandidateLimit(true,10000)).toBe(1000);
    expect(resolveCandidateLimit(true,1000,true)).toBe(Infinity);
  });
  it('ranks downside profit rather than optimistic profit and deduplicates',()=>{
    const a=analysis('a',9000,{expectedProfitHighEur:50000}),b=analysis('b',11000),c=analysis('c',10000);
    const result=selectTopDeals([listing('a'),listing('b'),listing('c'),listing('b')],new Map([['a',a],['b',b],['c',c]]),2);
    expect(result.map(d=>[d.rank,d.listing.listingId])).toEqual([[1,'b'],[2,'c']]);
  });
  it('excludes FAIL, unqualified REVIEW and missing profit/ROI',()=>{
    const rows=[analysis('a',20000,{status:'FAIL'}),analysis('b',19000,{status:'REVIEW',importantReview:false}),
      analysis('c',9000,{roi:null}),analysis('d',8000,{status:'REVIEW',importantReview:true})];
    const result=selectTopDeals(rows.map(r=>listing(r.listingId)),new Map(rows.map(r=>[r.listingId,r])),10);
    expect(result.map(d=>d.listing.listingId)).toEqual(['d']);
  });
  it('can select ten deals from beyond the old 1000 listing boundary',()=>{
    const rows=Array.from({length:1100},(_,i)=>analysis(String(i),i+7000));
    const result=selectTopDeals(rows.map(r=>listing(r.listingId)),new Map(rows.map(r=>[r.listingId,r])),10);
    expect(result).toHaveLength(10);expect(result[0].listing.listingId).toBe('1099');
  });
});

const summary={runMode:'FULL_SCAN',activeUrlsConfigured:14,activeUrlsChecked:14,totalListingsDiscovered:1100,
  newListings:1,changedListings:0,skippedOldListings:0,evaluated:1100,ignored:1000,pass:60,review:40,dealNotificationsSent:10,
  runtimeSeconds:120,estimatedCostUsd:.03,searchPageRequests:40,detailPageRequests:0,sheetsRequests:23,topDealsLimit:10} as TelegramRunSummary;
describe('full scan summary',()=>{
  it('clearly reports a failed scan instead of claiming no deals exist',()=>{
    const text=formatTelegramRunSummary({...summary,activeUrlsChecked:0,scanComplete:false,incompleteReasons:['SS.com robots.txt was unavailable.']});
    expect(text).toContain('Scan incomplete');expect(text).toContain('robots.txt');expect(text).not.toContain('🏆 Top');
  });
  it('includes the profit range, ROI and a bounded top-deal digest',()=>{
    const text=formatTelegramRunSummary({...summary,scanComplete:true,topDeals:[{rank:1,district:'Teika',address:'Testa 1',profitLowEur:14000,profitHighEur:16000,roi:.18}]});
    expect(text).toContain('🏆 Top 1');expect(text).toContain('€14,000–€16,000 · ROI 18.0%');expect(text.length).toBeLessThan(4096);
  });
});
