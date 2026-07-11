import { log } from 'apify';
import type { Listing, UnderwritingResult } from './types.js';

export const notificationFingerprint = (listing: Listing, result: UnderwritingResult) =>
  `${listing.listingId}|${listing.priceEur ?? 'unknown'}|${result.status}`;

export function shouldNotify(result: UnderwritingResult, alreadySent: boolean): boolean {
  if (alreadySent) return false;
  return result.status === 'PASS' || (result.status === 'REVIEW' && result.importantReview);
}

export function formatTelegramDealAlert(listing: Listing, result: UnderwritingResult): string {
  const money=(v:number|null)=>v==null?'—':new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
  return [`🏠 ${listing.district}, ${listing.address}`,'',`💰 Price: ${money(listing.priceEur)}`,
    `📐 Size: ${listing.areaM2 ?? '—'} m²`,`🔨 Renovation: ${money(result.renovationCostEur)}`,
    `🏦 ARV: ${money(result.baseArvEur)}`,`📈 Profit: ${money(result.expectedProfitEur)}`,
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
