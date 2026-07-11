import { describe,expect,it } from 'vitest';
import { notificationFingerprint,shouldNotify } from '../src/telegram.js';
import type { Listing,UnderwritingResult } from '../src/types.js';
const listing={listingId:'abc',priceEur:50000} as Listing;
const result={listingId:'abc',status:'PASS',importantReview:false} as UnderwritingResult;
describe('notification policy',()=>{
 it('notifies PASS once per price/status fingerprint',()=>{expect(shouldNotify(result,false)).toBe(true);expect(shouldNotify(result,true)).toBe(false);expect(notificationFingerprint(listing,result)).toBe('abc|50000|PASS');});
 it('only notifies important REVIEW',()=>{expect(shouldNotify({...result,status:'REVIEW',importantReview:false},false)).toBe(false);expect(shouldNotify({...result,status:'REVIEW',importantReview:true},false)).toBe(true);expect(shouldNotify({...result,status:'FAIL'},false)).toBe(false);});
});
