import { log } from 'apify';
import type { Listing, UnderwritingResult } from './types.js';

const timeoutMs = 30_000;

export async function syncAndUnderwrite(listings: Listing[], minProfitEur: number): Promise<Map<string, UnderwritingResult>> {
  const endpoint = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  const sharedSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!endpoint || !sharedSecret || listings.length === 0) return new Map();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ sharedSecret, minProfitEur, listings }),
    });
    if (!response.ok) throw new Error(`Sheets bridge returned HTTP ${response.status}`);
    const body = await response.json() as { ok?: boolean; results?: UnderwritingResult[]; error?: string };
    if (!body.ok || !Array.isArray(body.results)) throw new Error(body.error || 'Invalid Sheets bridge response');
    return new Map(body.results.map((result) => [result.listingId, result]));
  } catch (error) {
    log.error('Google Sheets underwriting bridge failed', { message: error instanceof Error ? error.message : String(error) });
    return new Map();
  } finally { clearTimeout(timer); }
}
