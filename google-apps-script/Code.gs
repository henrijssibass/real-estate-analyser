const CANDIDATES_SHEET = 'Deal_Analysis';
const COMPS_SHEET = 'ARV_Comps';
const APPRAISAL_SHEET = 'ARV_Summary';
const UNDERWRITING_VERSION = 'arv-per-m2-2026-10-20';
const RENO_SHEET = 'Renovation_Costs_v2';
const COSTS_SHEET = 'Other_Costs';
const FILTERS_SHEET = 'Deal_Filters';
const SEARCH_URLS_SHEET = 'Search_URLs';
const REVIEW_MIN_PROFIT_EUR = 4000;

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || payload.sharedSecret !== expected) return json_({ ok:false, error:'Unauthorized' });
    if (payload.action === 'getSearchUrls') return json_({ok:true,searchUrls:loadActiveSearchUrls_()});
    const listings = Array.isArray(payload.listings) ? payload.listings : [];
    const minProfit = Number(payload.minProfitEur || 7000);
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const config = loadConfig_();
      const results = listings.map(l => underwrite_(l, config, minProfit));
      const sync=payload.dryRun?{written:0,removed:0}:syncCandidateBatch_(listings,results,config);
      SpreadsheetApp.flush();
      return json_({ ok:true, underwritingVersion:UNDERWRITING_VERSION, results:results, sheetsRowsWritten:sync.written, sheetsRowsRemoved:sync.removed });
    } finally { lock.releaseLock(); }
  } catch (err) { console.error(String(err)); return json_({ok:false,error:String(err)}); }
}
function doGet(){return json_({ok:true,service:'ss-apartment-deal-finder-sheets-bridge',underwritingVersion:UNDERWRITING_VERSION});}

function loadActiveSearchUrls_(){
  const sh=SpreadsheetApp.getActive().getSheetByName(SEARCH_URLS_SHEET); if(!sh)return [];
  const values=sh.getRange(4,1,Math.max(1,sh.getLastRow()-3),8).getDisplayValues();
  return values.slice(1).filter(r=>norm_(r[0])==='yes'&&norm_(r[1])==='ss.com'&&r[3]).map(r=>({
    url:r[3].trim(),name:r[2].trim(),district:r[4].trim(),seriesFocus:(r[5]||'All').trim(),roomsFocus:(r[6]||'All').trim()
  }));
}

function loadConfig_() {
  const ss=SpreadsheetApp.getActive();
  const comps=ss.getSheetByName(COMPS_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(COMPS_SHEET).getLastRow()-4),18).getValues();
  const appraisals=ss.getSheetByName(APPRAISAL_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(APPRAISAL_SHEET).getLastRow()-4),11).getValues();
  const reno=ss.getSheetByName(RENO_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(RENO_SHEET).getLastRow()-4),24).getValues();
  const costs=ss.getSheetByName(COSTS_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(COSTS_SHEET).getLastRow()-4),5).getValues();
  const filters=ss.getSheetByName(FILTERS_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(FILTERS_SHEET).getLastRow()-4),17).getValues();
  const overrides=ss.getSheetByName('Listing_Overrides').getRange(5,1,Math.max(1,ss.getSheetByName('Listing_Overrides').getLastRow()-4),9).getValues();
  return {comps:comps,appraisals:appraisals,reno:reno,costs:costs,filters:filters,overrides:overrides};
}

function underwrite_(l,cfg,minProfit) {
  const flags=[];
  // Every ARV_Comps row is user-confirmed. Legacy evidence/include columns and
  // bathroom count must not remove valid district + series + rooms matches.
  const appraisalRows=(cfg.appraisals||[]).filter(r=>norm_(r[0])===norm_(l.district)&&seriesKey_(r[1])===seriesKey_(l.series)&&Number(r[2])===Number(l.rooms)&&Number(r[3])>0&&Number(r[7])>0);
  const compCount=appraisalRows.reduce((sum,r)=>sum+Number(r[3]),0);
  const baseRate=compCount?appraisalRows.reduce((sum,r)=>sum+Number(r[7])*Number(r[3]),0)/compCount:null;
  const area=Number(l.areaM2);
  const base=baseRate!=null&&area>0?baseRate*area:null;
  const conservative=base==null?null:Math.min.apply(null,appraisalRows.map(r=>Number(r[8])))*area;
  const stretch=base==null?null:base*1.1;
  const manualOverride=manualArvOverride_(l.listingId,cfg.overrides); const underwritingArv=manualOverride==null?base:manualOverride;
  // Bathroom count is unreliable on SS.com and must not affect qualification.
  // Prefer the one-bath baseline, then any rooms+area profile as a fallback.
  const renoRows=cfg.reno.filter(r=>Number(r[1])===Number(l.rooms)&&Number(l.areaM2)>=Number(r[3])&&Number(l.areaM2)<=Number(r[4]));
  const renoRow=renoRows.find(r=>Number(r[2]||1)===1)||renoRows[0];
  const coreRate=renoRow?Number(renoRow[9]||0):null;
  const fixedReno=renoRow?[11,12,13,14,15,16,17,18,19].reduce((s,i)=>s+Number(renoRow[i]||0),0):null;
  const contingencyPct=renoRow?Number(renoRow[21]||0):null;
  const renoBefore=renoRow?Number(l.areaM2)*coreRate+fixedReno:null;
  const reno=renoBefore==null?null:renoBefore*(1+contingencyPct);
  const purchasePct=sumCost_(cfg.costs,'% of purchase'),salePct=sumCost_(cfg.costs,'% of sale'),fixed=sumCost_(cfg.costs,'Fixed €'),monthly=sumCost_(cfg.costs,'Monthly €');
  // Until a per-listing holding period is configured, include one month of configured holding costs.
  const other=underwritingArv==null?null:Number(l.priceEur||0)*purchasePct+underwritingArv*salePct+fixed+monthly;
  const total=reno==null||other==null?null:Number(l.priceEur||0)+reno+other;
  const totalBefore=renoBefore==null||other==null?null:Number(l.priceEur||0)+renoBefore+other;
  const profit=underwritingArv==null||total==null?null:underwritingArv-total;
  const profitHigh=underwritingArv==null||totalBefore==null?null:underwritingArv-totalBefore;
  const roi=profit==null||!total?null:profit/total; const margin=profit==null||!underwritingArv?null:profit/underwritingArv;
  const filter=matchFilter_(l,cfg.filters); const effectiveMinProfit=filter&&Number(filter[11])>0?Number(filter[11]):minProfit; const effectiveMinRoi=filter&&Number(filter[12])>0?Number(filter[12]):0;
  const maxOffer=underwritingArv==null||reno==null?null:(underwritingArv*(1-salePct)-reno-fixed-monthly-effectiveMinProfit)/(1+purchasePct);
  if(compCount<3) flags.push('FEW_ARV_COMPS'); if(reno==null) flags.push('RENOVATION_PROFILE_MISSING'); if(l.floor===1) flags.push('FIRST_FLOOR'); if(l.floor&&l.totalFloors&&l.floor===l.totalFloors) flags.push('TOP_FLOOR');
  let status='FAIL'; let importantReview=false;
  if(base==null||reno==null||!l.priceEur){status='FAIL';flags.push('MISSING_UNDERWRITING_DATA');}
  else if(filter===false){status='FAIL';flags.push('FILTER_REJECT');}
  else if(compCount>=3&&profit>=effectiveMinProfit&&(roi==null||roi>=effectiveMinRoi)) status='PASS';
  else if(profit>=REVIEW_MIN_PROFIT_EUR&&compCount>=1&&roi>=0.10){status='REVIEW';importantReview=true;}
  const confidence=compCount>=3&&reno!=null?'HIGH':compCount>=1&&reno!=null?'MEDIUM':'LOW';
  const evidence=compCount?`${compCount} user-confirmed comps; average €${round_(baseRate)}/m² × ${area} m² = €${round_(base)}; ARV_Summary`:'No appraisal baseline for district + series + rooms';
  return {listingId:l.listingId,status:status,importantReview:importantReview,underwritingVersion:UNDERWRITING_VERSION,renovationCoreRatePerM2:round_(coreRate),renovationFixedEur:round_(fixedReno),renovationCostBeforeContingencyEur:round_(renoBefore),renovationContingencyPct:contingencyPct,renovationCostEur:round_(reno),otherCostsEur:round_(other),totalProjectCostBeforeContingencyEur:round_(totalBefore),totalProjectCostEur:round_(total),conservativeArvEur:round_(conservative),baseArvPerM2:round_(baseRate),baseArvEur:round_(base),manualArvOverrideEur:round_(manualOverride),underwritingArvEur:round_(underwritingArv),stretchArvEur:round_(stretch),expectedProfitEur:round_(profit),expectedProfitLowEur:round_(profit),expectedProfitHighEur:round_(profitHigh),roi:roi,profitMargin:margin,maximumOfferEur:round_(maxOffer),compCount:compCount,confidence:confidence,riskFlags:flags,comparableEvidence:evidence};
}

function isActionable_(result){return result.status==='PASS'||(result.status==='REVIEW'&&result.importantReview===true);}

function matchFilter_(l,rows){
  const active=rows.filter(r=>norm_(r[0])==='yes'&&(!r[1]||norm_(r[1])===norm_(l.district))); if(!active.length)return null;
  const text=norm_(`${l.title||''} ${l.description||''}`);
  const match=active.find(r=>(!r[2]||norm_(r[2])===norm_(l.series))&&(!r[3]||Number(r[3])===Number(l.rooms))&&(!r[4]||Number(l.areaM2)>=Number(r[4]))&&(!r[5]||Number(l.areaM2)<=Number(r[5]))&&(!r[6]||Number(l.priceEur)<=Number(r[6]))&&(!r[7]||Number(l.pricePerM2)<=Number(r[7]))&&(!r[8]||Number(l.floor)>=Number(r[8]))&&!(norm_(r[9])==='yes'&&l.floor===l.totalFloors)&&!(norm_(r[10])==='yes'&&Number(l.floor)===1)&&(!r[14]||!text.includes(norm_(r[14])))&&(!r[15]||text.includes(norm_(r[15]))));
  return match||false;
}

function manualArvOverride_(listingId,rows){const row=rows.find(r=>String(r[0])===String(listingId));const value=row&&Number(row[7]);return value>0?value:null;}

function candidateRow_(l,r,cfg) {
  const filter=matchFilter_(l,cfg.filters); const filterRow=filter&&filter!==false?cfg.filters.indexOf(filter)+5:''; const manual=r.manualArvOverrideEur;
  return [l.listingId,l.district,l.address,l.series,l.rooms,'',l.areaM2,l.floor,l.totalFloors,l.priceEur,l.pricePerM2,filterRow,filter===false?'FILTER REJECT':filter?'MATCHED':'AUTO',r.renovationCoreRatePerM2,r.renovationFixedEur,r.renovationCostBeforeContingencyEur,r.renovationContingencyPct,r.renovationCostEur,r.otherCostsEur,r.compCount,r.baseArvPerM2,r.baseArvEur,r.expectedProfitLowEur,r.expectedProfitHighEur,manual,r.underwritingArvEur,r.totalProjectCostEur,r.expectedProfitEur,r.roi,r.status,(r.riskFlags||[]).join('; '),l.url];
}
function syncCandidateBatch_(listings,results,cfg) {
  const sh=SpreadsheetApp.getActive().getSheetByName(CANDIDATES_SHEET); const previousLength=Math.max(0,sh.getLastRow()-4);
  const previous=previousLength?sh.getRange(5,1,previousLength,32).getValues():[];
  const rows=new Map(previous.filter(r=>r[0]).map(r=>[String(r[0]),r])); let written=0,removed=0;
  results.forEach((r,i)=>{
    const id=String(r.listingId);
    if(isActionable_(r)){rows.set(id,candidateRow_(listings[i],r,cfg));written++;}
    else if(rows.delete(id)){removed++;}
  });
  const values=Array.from(rows.values());
  if(written||removed){
    if(values.length)sh.getRange(5,1,values.length,32).setValues(values);
    if(previousLength>values.length)sh.getRange(5+values.length,1,previousLength-values.length,32).clearContent();
  }
  return {written:written,removed:removed};
}
function sumCost_(rows,type){return rows.filter(r=>String(r[1])===type).reduce((s,r)=>{const value=Number(r[2]);return s+(isFinite(value)?value:0);},0);}
function norm_(v){return String(v||'').replace(/\u00a0/g,' ').trim().replace(/\s+/g,' ').toLocaleLowerCase('lv-LV');}
function seriesKey_(v){const value=norm_(v);return /^\d+\.?$/.test(value)?value.replace(/\.$/,'')+'.':value;}
function round_(v){return v==null||!isFinite(v)?null:Math.round(v*100)/100;}
function safeDate_(v){if(!v)return '';const d=new Date(v);return isNaN(d.getTime())?'':d;}
function json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
