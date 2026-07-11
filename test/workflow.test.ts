import { describe,expect,it } from 'vitest';
import { formatTelegramDealAlert,notificationFingerprint,shouldNotify } from '../src/telegram.js';
import type { Listing,UnderwritingResult } from '../src/types.js';
const listing={listingId:'abc',priceEur:50000} as Listing;
const result={listingId:'abc',status:'PASS',importantReview:false} as UnderwritingResult;
describe('notification policy',()=>{
 it('notifies PASS once per price/status fingerprint',()=>{expect(shouldNotify(result,false)).toBe(true);expect(shouldNotify(result,true)).toBe(false);expect(notificationFingerprint(listing,result)).toBe('abc|50000|PASS');});
 it('notifies actionable REVIEW and never FAIL',()=>{expect(shouldNotify({...result,status:'REVIEW',importantReview:true},false)).toBe(true);expect(shouldNotify({...result,status:'FAIL'},false)).toBe(false);});
 it('formats a concise deal alert without diagnostics',()=>{const text=formatTelegramDealAlert({...listing,district:'Ķengarags',address:'Dubnas 8',areaM2:36,url:'https://example.test'} as Listing,{...result,renovationCostEur:15372,baseArvEur:73924,underwritingArvEur:73924,expectedProfitEur:4754,roi:.076} as UnderwritingResult);expect(text).toContain('🏠 Ķengarags, Dubnas 8');expect(text).toContain('🏦 ARV: €73,924');expect(text).toContain('📈 Profit: €4,754');expect(text).not.toMatch(/risk|confidence|comps|status/i);});
});
