const CANDIDATES_SHEET = 'Deal_Analysis';
const COMPS_SHEET = 'ARV_Comps';
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
      results.forEach((r,i) => { if (isActionable_(r)) upsertCandidate_(listings[i],r,config); });
      SpreadsheetApp.flush();
      return json_({ ok:true, results:results });
    } finally { lock.releaseLock(); }
  } catch (err) { console.error(String(err)); return json_({ok:false,error:String(err)}); }
}
function doGet(){return json_({ok:true,service:'ss-apartment-deal-finder-sheets-bridge'});}

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
  const reno=ss.getSheetByName(RENO_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(RENO_SHEET).getLastRow()-4),24).getValues();
  const costs=ss.getSheetByName(COSTS_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(COSTS_SHEET).getLastRow()-4),5).getValues();
  const filters=ss.getSheetByName(FILTERS_SHEET).getRange(5,1,Math.max(1,ss.getSheetByName(FILTERS_SHEET).getLastRow()-4),17).getValues();
  const overrides=ss.getSheetByName('Listing_Overrides').getRange(5,1,Math.max(1,ss.getSheetByName('Listing_Overrides').getLastRow()-4),9).getValues();
  return {comps:comps,reno:reno,costs:costs,filters:filters,overrides:overrides};
}

function underwrite_(l,cfg,minProfit) {
  const flags=[]; const bathrooms=Number(l.bathrooms||1); if(!l.bathrooms) flags.push('LOW_CONFIDENCE_BATHROOM_COUNT');
  const comparable=cfg.comps.filter(r=>String(r[16]).toLowerCase()==='yes'&&String(r[9]).toLowerCase().indexOf('verified')>=0&&
    norm_(r[1])===norm_(l.district)&&norm_(r[3])===norm_(l.series)&&Number(r[4])===Number(l.rooms)&&Number(r[5]||1)===bathrooms&&Number(r[10])>0);
  const prices=comparable.map(r=>Number(r[10])).sort((a,b)=>a-b); const compCount=prices.length;
  const conservative=compCount?prices[0]:null; const base=compCount?prices.reduce((a,b)=>a+b,0)/compCount:null; const stretch=base==null?null:base*1.1;
  const manualOverride=manualArvOverride_(l.listingId,cfg.overrides); const underwritingArv=manualOverride==null?base:manualOverride;
  const renoRow=cfg.reno.find(r=>Number(r[1])===Number(l.rooms)&&Number(r[2])===bathrooms&&Number(l.areaM2)>=Number(r[3])&&Number(l.areaM2)<=Number(r[4]));
  const reno=renoRow?(Number(l.areaM2)*Number(renoRow[9]||0)+[11,12,13,14,18].reduce((s,i)=>s+Number(renoRow[i]||0),0))*(1+Number(renoRow[21]||0)):null;
  const purchasePct=sumCost_(cfg.costs,'% of purchase'),salePct=sumCost_(cfg.costs,'% of sale'),fixed=sumCost_(cfg.costs,'Fixed €');
  const other=underwritingArv==null?null:Number(l.priceEur||0)*purchasePct+underwritingArv*salePct+fixed; const total=reno==null||other==null?null:Number(l.priceEur||0)+reno+other;
  const profit=underwritingArv==null||total==null?null:underwritingArv-total; const roi=profit==null||!total?null:profit/total; const margin=profit==null||!underwritingArv?null:profit/underwritingArv;
  const filter=matchFilter_(l,cfg.filters); const effectiveMinProfit=filter&&Number(filter[11])>0?Number(filter[11]):minProfit; const effectiveMinRoi=filter&&Number(filter[12])>0?Number(filter[12]):0;
  const maxOffer=underwritingArv==null||reno==null?null:(underwritingArv*(1-salePct)-reno-fixed-effectiveMinProfit)/(1+purchasePct);
  if(compCount<3) flags.push('FEW_ARV_COMPS'); if(reno==null) flags.push('RENOVATION_PROFILE_MISSING'); if(l.floor===1) flags.push('FIRST_FLOOR'); if(l.floor&&l.totalFloors&&l.floor===l.totalFloors) flags.push('TOP_FLOOR');
  let status='FAIL'; let importantReview=false;
  if(base==null||reno==null||!l.priceEur){status='FAIL';flags.push('MISSING_UNDERWRITING_DATA');}
  else if(filter===false){status='FAIL';flags.push('FILTER_REJECT');}
  else if(compCount>=3&&profit>=effectiveMinProfit&&(roi==null||roi>=effectiveMinRoi)) status='PASS';
  else if(profit>=REVIEW_MIN_PROFIT_EUR&&compCount>=2&&roi>=0.10){status='REVIEW';importantReview=true;}
  const confidence=compCount>=3&&reno!=null?'HIGH':compCount>=2&&reno!=null?'MEDIUM':'LOW';
  const evidence=compCount?`${compCount} verified renovated sales; range €${Math.round(prices[0])}–€${Math.round(prices[prices.length-1])}; average €${Math.round(base)}`:'No exact verified renovated sales for district + series + rooms + bathrooms';
  return {listingId:l.listingId,status:status,importantReview:importantReview,renovationCostEur:round_(reno),otherCostsEur:round_(other),totalProjectCostEur:round_(total),conservativeArvEur:round_(conservative),baseArvPerM2:base==null||!l.areaM2?null:round_(base/Number(l.areaM2)),baseArvEur:round_(base),manualArvOverrideEur:round_(manualOverride),underwritingArvEur:round_(underwritingArv),stretchArvEur:round_(stretch),expectedProfitEur:round_(profit),roi:roi,profitMargin:margin,maximumOfferEur:round_(maxOffer),compCount:compCount,confidence:confidence,riskFlags:flags,comparableEvidence:evidence};
}

function isActionable_(result){return result.status==='PASS'||(result.status==='REVIEW'&&result.importantReview===true);}

function matchFilter_(l,rows){
  const active=rows.filter(r=>norm_(r[0])==='yes'&&(!r[1]||norm_(r[1])===norm_(l.district))); if(!active.length)return null;
  const text=norm_(`${l.title||''} ${l.description||''}`);
  const match=active.find(r=>(!r[2]||norm_(r[2])===norm_(l.series))&&(!r[3]||Number(r[3])===Number(l.rooms))&&(!r[4]||Number(l.areaM2)>=Number(r[4]))&&(!r[5]||Number(l.areaM2)<=Number(r[5]))&&(!r[6]||Number(l.priceEur)<=Number(r[6]))&&(!r[7]||Number(l.pricePerM2)<=Number(r[7]))&&(!r[8]||Number(l.floor)>=Number(r[8]))&&!(norm_(r[9])==='yes'&&l.floor===l.totalFloors)&&!(norm_(r[10])==='yes'&&Number(l.floor)===1)&&(!r[14]||!text.includes(norm_(r[14])))&&(!r[15]||text.includes(norm_(r[15]))));
  return match||false;
}

function manualArvOverride_(listingId,rows){const row=rows.find(r=>String(r[0])===String(listingId));const value=row&&Number(row[7]);return value>0?value:null;}

function upsertCandidate_(l,r,cfg) {
  const sh=SpreadsheetApp.getActive().getSheetByName(CANDIDATES_SHEET); const last=Math.max(4,sh.getLastRow());
  const ids=last>=5?sh.getRange(5,1,last-4,1).getDisplayValues().flat():[]; const found=ids.indexOf(String(l.listingId)); const row=found>=0?found+5:last+1;
  const filter=matchFilter_(l,cfg.filters); const filterRow=filter&&filter!==false?cfg.filters.indexOf(filter)+5:''; const manual=r.manualArvOverrideEur;
  const values=[[l.listingId,l.district,l.address,l.series,l.rooms,l.bathrooms,l.areaM2,l.floor,l.totalFloors,l.priceEur,l.pricePerM2,filterRow,filter===false?'FILTER REJECT':filter?'MATCHED':'AUTO','','','','',r.renovationCostEur,r.otherCostsEur,r.compCount,r.baseArvPerM2,r.baseArvEur,'','',manual,r.underwritingArvEur,r.totalProjectCostEur,r.expectedProfitEur,r.roi,r.status,(r.riskFlags||[]).join('; '),l.url]];
  sh.getRange(row,1,1,32).setValues(values);
}
function sumCost_(rows,type){return rows.filter(r=>String(r[1])===type).reduce((s,r)=>s+Number(r[2]||0),0);}
function norm_(v){return String(v||'').trim().toLocaleLowerCase('lv-LV');}
function round_(v){return v==null||!isFinite(v)?null:Math.round(v*100)/100;}
function safeDate_(v){if(!v)return '';const d=new Date(v);return isNaN(d.getTime())?'':d;}
function json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
