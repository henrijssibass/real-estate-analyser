import { log } from 'apify';
import type { Listing, UnderwritingResult } from './types.js';

export const notificationFingerprint = (listing: Listing, result: UnderwritingResult) =>
  `${listing.listingId}|${listing.priceEur ?? 'unknown'}|${result.status}`;

export async function sendTelegramNotice(text:string):Promise<boolean>{
  const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId||!text.trim()||text.length>4000)return false;
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
    if(!response.ok){log.error('Telegram notice failed',{httpStatus:response.status});return false;}
    const body=await response.json() as {ok?:boolean};return body.ok===true;
  }catch{log.error('Telegram notice delivery failed');return false;}
}

export function shouldNotify(result: UnderwritingResult, alreadySent: boolean): boolean {
  if (alreadySent) return false;
  return result.status === 'PASS' || (result.status === 'REVIEW' && result.importantReview);
}

interface ShortlistLabel {rank:number;roiRank:number;profitRank:number;category:'ROI'|'PROFIT';note?:string}

export function formatTelegramDealAlert(listing: Listing, result: UnderwritingResult, shortlist?:ShortlistLabel): string {
  const money=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
  const floor=listing.floor==null?'—':listing.totalFloors==null?String(listing.floor):`${listing.floor}/${listing.totalFloors}`;
  const profitLow=result.expectedProfitLowEur??result.expectedProfitEur;
  const profitHigh=result.expectedProfitHighEur??result.expectedProfitEur;
  if(shortlist)return [`🏠 ${shortlist.rank}. ${listing.district}, ${listing.address} — ${shortlist.category==='ROI'?'ROI atlase':'Peļņas atlase'}`,
    `${listing.rooms??'—'} ist. · ${listing.areaM2??'—'} m² · ${floor}. st. · ${listing.series??'—'}`,
    `💰 Cena: ${money(listing.priceEur)} · Kopā jāiegulda: ${money(result.totalProjectCostEur)}`,
    `🔨 Remonts ar rezervi: ${money(result.renovationCostEur)} · Citas izmaksas: ${money(result.otherCostsEur)}`,
    `🏦 Pārdošanas vērtības aplēse: ${money(result.underwritingArvEur)}`,
    `📈 Peļņas aplēse: ${money(profitLow)}–${money(profitHigh)} · ROI ar rezervi: ${result.roi==null?'—':(result.roi*100).toFixed(1)+'%'}`,
    `ROI rangs #${shortlist.roiRank} · Peļņas rangs #${shortlist.profitRank}`,
    ...(result.compCount<3?[`Vērtības aplēsei ir ${result.compCount} salīdzināmi darījumi.`]:[]),
    ...(shortlist.note?[shortlist.note]:[]),listing.url].join('\n');
  return [`🏠 ${result.status} — ${listing.district}, ${listing.address}`,'',`💰 Price: ${money(listing.priceEur)}`,
    `🚪 Rooms: ${listing.rooms ?? '—'}`,`📐 Size: ${listing.areaM2 ?? '—'} m²`,`🏢 Floor: ${floor}`,`🏗 Series: ${listing.series || '—'}`,
    `🔨 Renovation: ${money(result.renovationCostBeforeContingencyEur)}–${money(result.renovationCostEur)}`,
    `🧾 Other costs: ${money(result.otherCostsEur)}`,
    `🏦 ARV: ${money(result.underwritingArvEur)}`,`📈 Profit: ${money(profitLow)}–${money(profitHigh)}`,
    `📊 ROI: ${result.roi==null?'—':`${(result.roi*100).toFixed(1)}%`}`,'',`🔗 Link:`,listing.url].join('\n');
}

export async function sendTelegram(listing: Listing, result: UnderwritingResult, shortlist?:ShortlistLabel): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN; const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { log.warning('Telegram notification skipped: required secret variables are unavailable'); return false; }
  const text=formatTelegramDealAlert(listing,result,shortlist);
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:false})});
    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
    const body=await response.json() as {ok?:boolean}; if(!body.ok) throw new Error('Telegram rejected the message'); return true;
  } catch(error) { log.error('Telegram delivery failed',{message:error instanceof Error?error.message:String(error)}); return false; }
}

export interface TelegramRunSummary {
  runMode:string;activeUrlsConfigured:number;activeUrlsChecked:number;totalListingsDiscovered:number;newListings:number;changedListings:number;
  skippedOldListings:number;evaluated:number;ignored:number;pass:number;review:number;dealNotificationsSent:number;runtimeSeconds:number;
  estimatedCostUsd:number|null;searchPageRequests:number;detailPageRequests:number;sheetsRequests:number;
  scanComplete?:boolean;incompleteReasons?:string[];topDealsLimit?:number;
  verifiedShortlist?:boolean;detailExclusions?:Record<string,number>;
  topDeals?:Array<{rank:number;district:string;address:string;profitLowEur:number|null;profitHighEur:number|null;roi:number|null;category?:'ROI'|'PROFIT'}>;
}

export function formatTelegramRunSummary(summary:TelegramRunSummary):string{
  if(summary.verifiedShortlist){
    const euro=(v:number|null)=>v==null?'—':new Intl.NumberFormat('lv-LV',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
    const rejected=Object.values(summary.detailExclusions??{}).reduce((n,count)=>n+count,0);
    return ['📋 Rīgas dzīvokļu atlase — bez Jūrmalas',
      `Pārbaudīti ${summary.activeUrlsChecked}/${summary.activeUrlsConfigured} meklējumi; izvērtēti ${summary.evaluated} sludinājumi. Detaļās izlaisti: ${rejected}.`,
      `Telegram: ${summary.dealNotificationsSent}/${summary.topDeals?.length??0} objektu ziņas.`,
      ...(summary.scanComplete===false?['Skenējums nav pilns.',...(summary.incompleteReasons??[])]:[]),
      ...(summary.topDeals??[]).map(d=>`${d.rank}. ${d.district}, ${d.address} — ${d.category==='ROI'?'ROI':'peļņa'} · ${euro(d.profitLowEur)}–${euro(d.profitHighEur)} · ${d.roi==null?'—':(d.roi*100).toFixed(1)+'%'}`),
      'ROI = peļņa ar renovācijas rezervi / kopējais ieguldījums. Aplēses balstītas uz sludinājumu cenām un esošajiem salīdzinājumiem, nevis apskati vai īpašumtiesību pārbaudi.'
    ].join('\n').slice(0,4000);
  }
  const outcome=summary.scanComplete===false?'⚠️ Scan incomplete — this is not a complete market ranking.':summary.pass+summary.review>0?`Deals found: PASS ${summary.pass}, REVIEW ${summary.review}.`:'No qualifying deals found.';
  const cost=summary.estimatedCostUsd==null?'pending in Apify':`≈$${summary.estimatedCostUsd.toFixed(3)}`;
  const text=[`📋 Run summary — ${summary.runMode}`,'',
    `🔗 URLs: ${summary.activeUrlsChecked}/${summary.activeUrlsConfigured}`,
    `🔎 Listings discovered: ${summary.totalListingsDiscovered}`,
    `🆕 New: ${summary.newListings} · Changed: ${summary.changedListings} · Skipped old: ${summary.skippedOldListings}`,
    `🧮 Evaluated: ${summary.evaluated} · Ignored: ${summary.ignored}`,
    `🌐 Requests: search ${summary.searchPageRequests} · details ${summary.detailPageRequests} · Sheets ${summary.sheetsRequests}`,
    `✅ PASS: ${summary.pass} · 🟡 REVIEW: ${summary.review}`,
    `📨 Deal alerts sent: ${summary.dealNotificationsSent}`,
    `⏱ Runtime: ${summary.runtimeSeconds}s · 💵 Cost: ${cost}`,'',outcome];
  if(summary.scanComplete===false)text.push(...(summary.incompleteReasons??[]));
  if(summary.topDealsLimit&&summary.scanComplete!==false){
    const money=(v:number|null)=>v==null?'—':new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
    text.push('',`🏆 Top ${summary.topDeals?.length??0} — profit after contingency and all costs`);
    for(const d of summary.topDeals??[])text.push(`${d.rank}. ${`${d.district}, ${d.address}`.slice(0,90)} — ${money(d.profitLowEur)}–${money(d.profitHighEur)} · ROI ${d.roi==null?'—':(d.roi*100).toFixed(1)+'%'}`);
  }
  return text.join('\n').slice(0,4000);
}

export async function sendTelegramSummary(summary:TelegramRunSummary):Promise<boolean>{
  const token=process.env.TELEGRAM_BOT_TOKEN; const chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId){log.warning('Telegram summary skipped: required secret variables are unavailable');return false;}
  const text=formatTelegramRunSummary(summary);
  try{const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
    if(!response.ok)throw new Error(`Telegram returned HTTP ${response.status}`); const body=await response.json() as {ok?:boolean}; return body.ok===true;
  }catch(error){log.error('Telegram summary delivery failed',{message:error instanceof Error?error.message:String(error)});return false;}
}
