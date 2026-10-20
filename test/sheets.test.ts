import { afterEach,describe,expect,it,vi } from 'vitest';
import { syncAndUnderwrite,UNDERWRITING_VERSION } from '../src/sheets.js';
import type { Listing } from '../src/types.js';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('Sheets batches',()=>{
 it('underwrites in bounded batches and passes through dry-run suppression',async()=>{
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_URL','https://example.test/bridge');
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_SECRET','test-only');
  const payloads:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{
   const body=JSON.parse(options.body);payloads.push(body);
   return {ok:true,json:async()=>({ok:true,underwritingVersion:UNDERWRITING_VERSION,sheetsRowsWritten:0,results:body.listings.map((l:any)=>({listingId:l.listingId,status:'FAIL'}))})};
  }));
  const listings=Array.from({length:101},(_,i)=>({listingId:String(i)}) as Listing);
  const result=await syncAndUnderwrite(listings,7000,true);
  expect(payloads.map(p=>p.listings.length)).toEqual([50,50,1]);
  expect(payloads.every(p=>p.dryRun===true)).toBe(true);
  expect(result.analyses.size).toBe(101);
  expect(result.requests).toBe(3);
 });
 it('refuses the outdated absolute-price bridge response',async()=>{
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_URL','https://example.test/bridge');
  vi.stubEnv('GOOGLE_SHEETS_WEBHOOK_SECRET','test-only');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({ok:true,results:[]})})));
  expect((await syncAndUnderwrite([{listingId:'abc'} as Listing],7000)).analyses.size).toBe(0);
 });
});
