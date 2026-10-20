import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const context=vm.createContext({console});
vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
const underwrite=context.underwrite_ as (listing:any,config:any,min:number)=>any;
const rate=(68500/47.7+70000/43.9+62000/47.5)/3;
const listing={listingId:'test',district:'Ķengarags',series:'Hrušč.',rooms:2,areaM2:45,priceEur:35000,floor:3,totalFloors:5};
const config={
  // ARV_Summary: district, series, rooms, count, avg/min/max area, avg/min/max €/m².
  appraisals:[['Ķengarags','Hrušč.',2,3,46.3667,43.9,47.7,rate,62000/47.5,70000/43.9]],
  comps:[],filters:[],overrides:[],
  reno:[['2 rooms',2,1,36,52,45,160,90,25,275,0,3000,940,0,950,100,200,300,400,500,0,.05]],
  costs:[['Duty','% of purchase',.02],['Notary','Fixed €',200],['Utilities','Fixed €',600],['Tax','Fixed €',75]],
};
describe('sheet underwriting',()=>{
  it('updates qualified candidates in one batch and removes candidates that no longer qualify',()=>{
    let saved:any[]=[],cleared:any;
    const touched:string[]=[];
    const previous=[['keep'],['obsolete'],['unqualified-review']];
    context.SpreadsheetApp={getActive:()=>({getSheetByName:(name:string)=>{touched.push(name);return {
      getLastRow:()=>7,
      getRange:(row:number,column:number,count:number,width:number)=>({getValues:()=>previous,setValues:(v:any[])=>{saved=v;},clearContent:()=>{cleared={row,column,count,width};}}),
    };}})};
    const keep=underwrite({...listing,listingId:'keep'},config,7000);
    const review={...keep,listingId:'new-review',status:'REVIEW',importantReview:true};
    const sync=context.syncCandidateBatch_;
    const result=sync([{...listing,listingId:'keep'},listing,listing,{...listing,listingId:'new-review'}],
      [keep,{listingId:'obsolete',status:'FAIL'},{listingId:'unqualified-review',status:'REVIEW',importantReview:false},review],config);
    expect(result.written).toBe(2);expect(result.removed).toBe(2);
    expect(saved.map(r=>r[0])).toEqual(['keep','new-review']);
    expect(saved.map(r=>r[29])).toEqual(['PASS','REVIEW']);
    expect(cleared).toEqual({row:7,column:1,count:1,width:32});
    expect(touched).toEqual(['Deal_Analysis']);
  });
  it('uses the arithmetic mean €/m² times the actual listing area, including all costs',()=>{
    const r=underwrite(listing,config,7000);
    expect(r.baseArvPerM2).toBe(1445.28);
    expect(r.baseArvEur).toBeCloseTo(rate*45,2);
    expect(r.underwritingArvEur).toBe(r.baseArvEur);
    expect(r.renovationFixedEur).toBe(6390);
    expect(r.otherCostsEur).toBe(1575);
    expect(r.totalProjectCostEur).toBeCloseTo(35000+(45*275+6390)*1.05+1575,2);
    expect(r.expectedProfitEur).toBeCloseTo(rate*45-r.totalProjectCostEur,2);
    expect(r.roi).toBeCloseTo((rate*45-(35000+(45*275+6390)*1.05+1575))/(35000+(45*275+6390)*1.05+1575),8);
    expect(r.expectedProfitHighEur).toBeGreaterThan(r.expectedProfitLowEur);
    expect(r.status).toBe('PASS');
  });
  it('does not use legacy evidence metadata or bathroom count for ARV or status',()=>{
    const a=underwrite({...listing,bathrooms:null},config,7000);
    const b=underwrite({...listing,bathrooms:2},config,7000);
    expect(a).toEqual(b);
    expect(a.compCount).toBe(3);
    expect(a.riskFlags).not.toContain('LOW_CONFIDENCE_BATHROOM_COUNT');
  });
  it('requires a matching district, series and room group',()=>{
    expect(underwrite({...listing,rooms:4},config,7000).status).toBe('FAIL');
  });
  it('normalizes numeric series and uses the newly added 4-room appraisal by area',()=>{
    const r=underwrite({...listing,district:'Pļavnieki',series:'602',rooms:4,areaM2:75},
      {...config,appraisals:[['Pļavnieki','602.',4,1,79.3,79.3,79.3,115000/79.3,115000/79.3,115000/79.3]]},7000);
    expect(r.baseArvEur).toBeCloseTo(108764.19,2);
    expect(r.compCount).toBe(1);
  });
});
