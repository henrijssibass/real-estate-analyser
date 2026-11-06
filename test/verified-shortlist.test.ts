import {describe,expect,it} from 'vitest';
import {verifyDealHtml} from '../src/verify-deal.js';
import {selectBalancedDeals} from '../src/top-deals.js';
import type {Listing,UnderwritingResult} from '../src/types.js';

const listing=(id:string,address=id):Listing=>({listingId:id,district:'Iļģuciems',address,priceEur:35000,rooms:2,areaM2:42,floor:1,totalFloors:5,title:'Pārdod dzīvokli'} as Listing);
const page=(text:string)=>`<div id="msg_div_msg">${text}</div><div class="ads_price">34 500 € (821.43 €/m²)</div><div id="tdo_3">42 m²</div>`;
describe('verified shortlist',()=>{
  it('excludes cokolstāvs, apartment shares and unavailable pages',()=>{
    expect(verifyDealHtml(page('Dzīvoklis ēkas cokolstāvā'),listing('a')).reason).toBe('BASEMENT');
    expect(verifyDealHtml(page('Pārdod domājamo daļu no dzīvokļa'),listing('a')).reason).toBe('SHARE_OR_AUCTION');
    expect(verifyDealHtml(page('Pārdots.'),listing('a')).reason).toBe('UNAVAILABLE');
    expect(verifyDealHtml('404',listing('a')).listing).toBeUndefined();
  });
  it('uses current detail-page price and permits ordinary cellar storage',()=>{
    const checked=verifyDealHtml(page('Dzīvoklim ir mantu glabātuve pagrabā. Zeme nav īpašumā.'),listing('a'));
    expect(checked.listing?.priceEur).toBe(34500);
    expect(checked.listing?.areaM2).toBe(42);
    expect(checked.note).toContain('zemes noma');
  });
  it('selects distinct ROI and profit winners and preserves both ranks',()=>{
    const rows=[listing('a'),listing('b'),listing('c'),listing('b2','b')];
    const vals=[['a',.5,11000],['b',.3,20000],['c',.4,15000],['b2',.25,19000]] as const;
    const analyses=new Map(vals.map(([id,roi,profit])=>[id,{listingId:id,status:'PASS',roi,expectedProfitEur:profit} as UnderwritingResult]));
    const deals=selectBalancedDeals(rows,analyses,3,1);
    expect(deals.map(d=>[d.listing.listingId,d.category,d.roiRank,d.profitRank])).toEqual([['a','ROI',1,3],['b','PROFIT',3,1],['c','PROFIT',2,2]]);
  });
});
