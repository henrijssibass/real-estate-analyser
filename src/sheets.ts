import { log } from 'apify';
import type { Listing, SearchInput, UnderwritingResult } from './types.js';

const timeoutMs = 30_000;
export const UNDERWRITING_VERSION = 'arv-per-m2-2026-10-20';
const batchSize = 50;

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

export interface SheetsSyncResult { analyses: Map<string, UnderwritingResult>; sheetsRowsWritten: number; requests: number }

export async function syncAndUnderwrite(listings: Listing[], minProfitEur: number, dryRun = false): Promise<SheetsSyncResult> {
  const result: SheetsSyncResult = {analyses:new Map(),sheetsRowsWritten:0,requests:0};
  // Bounded sequential batches avoid the Apps Script deadline hit by full scans.
  // A failed batch leaves the corresponding history entries pending for retry.
  for (let offset=0; offset<listings.length; offset+=batchSize) {
   try {
    result.requests++;
    const batch=listings.slice(offset,offset+batchSize);
    const response=await callBridge({action:'underwrite',minProfitEur,listings:batch,dryRun}); if(!response) break;
    if (!response.ok) throw new Error(`Sheets bridge returned HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; underwritingVersion?:string; results?: UnderwritingResult[]; sheetsRowsWritten?:number; error?: string };
    if (!body.ok || !Array.isArray(body.results)) throw new Error(body.error || 'Invalid Sheets bridge response');
    if (body.underwritingVersion!==UNDERWRITING_VERSION) throw new Error('Deploy the ARV_Summary per-m² Sheets bridge before using this Actor build');
    for(const analysis of body.results) result.analyses.set(analysis.listingId,analysis);
    result.sheetsRowsWritten+=Number(body.sheetsRowsWritten??0);
   } catch (error) {
    log.error('Google Sheets underwriting batch failed', {batch:Math.floor(offset/batchSize)+1,message:error instanceof Error?error.message:String(error)});
    break;
   }
  }
  return result;
}
