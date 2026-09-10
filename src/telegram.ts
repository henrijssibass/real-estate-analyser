import { log } from 'apify';
import type { Listing, UnderwritingResult } from './types.js';

export const notificationFingerprint = (listing: Listing, result: UnderwritingResult) =>
  `${listing.listingId}|${listing.priceEur ?? 'unknown'}|${result.status}`;

export function shouldNotify(result: UnderwritingResult, alreadySent: boolean): boolean {
  if (alreadySent) return false;
  return result.status === 'PASS' || result.status === 'REVIEW';
}

export function formatTelegramDealAlert(listing: Listing, result: UnderwritingResult): string {
  const money=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
  const floor=listing.floor==null?'—':listing.totalFloors==null?String(listing.floor):`${listing.floor}/${listing.totalFloors}`;
  const profitLow=result.expectedProfitLowEur??result.expectedProfitEur;
  const profitHigh=result.expectedProfitHighEur??result.expectedProfitEur;
  return [`🏠 ${result.status} — ${listing.district}, ${listing.address}`,'',`💰 Price: ${money(listing.priceEur)}`,
    `🚪 Rooms: ${listing.rooms ?? '—'}`,`📐 Size: ${listing.areaM2 ?? '—'} m²`,`🏢 Floor: ${floor}`,`🏗 Series: ${listing.series || '—'}`,
    `🔨 Renovation: ${money(result.renovationCostBeforeContingencyEur)}–${money(result.renovationCostEur)}`,
    `🧾 Other costs: ${money(result.otherCostsEur)}`,
    `🏦 ARV: ${money(result.underwritingArvEur)}`,`📈 Profit: ${money(profitLow)}–${money(profitHigh)}`,
    `📊 ROI: ${result.roi==null?'—':`${(result.roi*100).toFixed(1)}%`}`,'',`🔗 Link:`,listing.url].join('\n');
}

export async function sendTelegram(listing: Listing, result: UnderwritingResult): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN; const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { log.warning('Telegram notification skipped: required secret variables are unavailable'); return false; }
  const text=formatTelegramDealAlert(listing,result);
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:false})});
    if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
    const body=await response.json() as {ok?:boolean}; if(!body.ok) throw new Error('Telegram rejected the message'); return true;
  } catch(error) { log.error('Telegram delivery failed',{message:error instanceof Error?error.message:String(error)}); return false; }
}

export async function sendTelegramSummary(summary:{runMode:string;activeUrlsConfigured:number;activeUrlsChecked:number;totalListingsDiscovered:number;newListings:number;changedListings:number;skippedOldListings:number;evaluated:number;ignored:number;pass:number;review:number;dealNotificationsSent:number;runtimeSeconds:number;estimatedCostUsd:number|null;searchPageRequests:number;detailPageRequests:number;sheetsRequests:number}):Promise<boolean>{
  const token=process.env.TELEGRAM_BOT_TOKEN; const chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId){log.warning('Telegram summary skipped: required secret variables are unavailable');return false;}
  const outcome=summary.pass+summary.review>0?`Deals found: PASS ${summary.pass}, REVIEW ${summary.review}.`:'No qualifying deals found.';
  const cost=summary.estimatedCostUsd==null?'pending in Apify':`≈$${summary.estimatedCostUsd.toFixed(3)}`;
  const text=[`📋 Run summary — ${summary.runMode}`,'',
    `🔗 URLs: ${summary.activeUrlsChecked}/${summary.activeUrlsConfigured}`,
    `🔎 Listings discovered: ${summary.totalListingsDiscovered}`,
    `🆕 New: ${summary.newListings} · Changed: ${summary.changedListings} · Skipped old: ${summary.skippedOldListings}`,
    `🧮 Evaluated: ${summary.evaluated} · Ignored: ${summary.ignored}`,
    `🌐 Requests: search ${summary.searchPageRequests} · details ${summary.detailPageRequests} · Sheets ${summary.sheetsRequests}`,
    `✅ PASS: ${summary.pass} · 🟡 REVIEW: ${summary.review}`,
    `📨 Deal alerts sent: ${summary.dealNotificationsSent}`,
    `⏱ Runtime: ${summary.runtimeSeconds}s · 💵 Cost: ${cost}`,'',outcome].join('\n');
  try{const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
    if(!response.ok)throw new Error(`Telegram returned HTTP ${response.status}`); const body=await response.json() as {ok?:boolean}; return body.ok===true;
  }catch(error){log.error('Telegram summary delivery failed',{message:error instanceof Error?error.message:String(error)});return false;}
}
