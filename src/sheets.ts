import { log } from 'apify';
import type { Listing, SearchInput, UnderwritingResult } from './types.js';

const timeoutMs = 30_000;

async function callBridge(payload: Record<string, unknown>): Promise<Response | null> {
  const endpoint = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const sharedSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!endpoint || !sharedSecret) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, signal:controller.signal,
      body:JSON.stringify({...payload,sharedSecret}) });
  } finally { clearTimeout(timer); }
}

export async function loadActiveSearchUrls(): Promise<SearchInput[]> {
  try {
    const response=await callBridge({action:'getSearchUrls'}); if(!response) return [];
    if(!response.ok) throw new Error(`Sheets bridge returned HTTP ${response.status}`);
    const body=await response.json() as {ok?:boolean;searchUrls?:SearchInput[];error?:string};
    if(!body.ok||!Array.isArray(body.searchUrls)) throw new Error(body.error||'Invalid search URL response');
    return body.searchUrls;
  } catch(error) { log.error('Google Sheets search configuration failed',{message:error instanceof Error?error.message:String(error)}); return []; }
}

export async function syncAndUnderwrite(listings: Listing[], minProfitEur: number): Promise<Map<string, UnderwritingResult>> {
  if (listings.length === 0) return new Map();
  try {
    const response=await callBridge({action:'underwrite',minProfitEur,listings}); if(!response) return new Map();
    if (!response.ok) throw new Error(`Sheets bridge returned HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; results?: UnderwritingResult[]; error?: string };
    if (!body.ok || !Array.isArray(body.results)) throw new Error(body.error || 'Invalid Sheets bridge response');
    return new Map(body.results.map((result) => [result.listingId, result]));
  } catch (error) {
    log.error('Google Sheets underwriting bridge failed', { message: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}
