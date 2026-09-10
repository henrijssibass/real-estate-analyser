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

export interface SheetsSyncResult { analyses: Map<string, UnderwritingResult>; sheetsRowsWritten: number }

export async function syncAndUnderwrite(listings: Listing[], minProfitEur: number): Promise<SheetsSyncResult> {
  if (listings.length === 0) return {analyses:new Map(),sheetsRowsWritten:0};
  try {
    const response=await callBridge({action:'underwrite',minProfitEur,listings}); if(!response) return {analyses:new Map(),sheetsRowsWritten:0};
    if (!response.ok) throw new Error(`Sheets bridge returned HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; results?: UnderwritingResult[]; sheetsRowsWritten?:number; error?: string };
    if (!body.ok || !Array.isArray(body.results)) throw new Error(body.error || 'Invalid Sheets bridge response');
    const analyses=new Map(body.results.map((result) => [result.listingId, result]));
    const inferredWrites=body.results.filter((result)=>result.status==='PASS'||(result.status==='REVIEW'&&result.importantReview)).length;
    return {analyses,sheetsRowsWritten:Number(body.sheetsRowsWritten??inferredWrites)};
  } catch (error) {
    log.error('Google Sheets underwriting bridge failed', { message: error instanceof Error ? error.message : String(error) });
    return {analyses:new Map(),sheetsRowsWritten:0};
  }
}
