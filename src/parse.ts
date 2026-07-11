import { createHash } from 'node:crypto';
import type { Listing } from './types.js';

// Crawlee currently exposes Cheerio's CJS API while direct ESM imports expose a
// nominally different API type. Keep parser inputs structural at this boundary.
type CheerioRoot = any;

const clean = (v: string) => v.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
export const numberFrom = (v: string): number | null => {
  const normalized = clean(v).replace(/[^\d,.-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = Number(normalized); return Number.isFinite(n) ? n : null;
};
export const listingIdFromUrl = (url: string): string => url.match(/\/([a-z0-9]+)\.html(?:\?|$)/i)?.[1] ?? createHash('sha256').update(url).digest('hex').slice(0, 20);
export const contentHash = (l: Listing): string => createHash('sha256').update(JSON.stringify({ title:l.title,description:l.description,address:l.address,rooms:l.rooms,areaM2:l.areaM2,floor:l.floor,totalFloors:l.totalFloors,series:l.series,priceEur:l.priceEur,imageUrls:l.imageUrls })).digest('hex');

export function parseSearchRows($: CheerioRoot, baseUrl: string, searchName: string, district: string, scrapedAt: string): Listing[] {
  const rows: Listing[] = [];
  $('tr[id^="tr_"]').each((_i: number, el: any) => {
    const row = $(el); const link = row.find('a.am').first(); const href = link.attr('href');
    if (!href || !/\/msg\//.test(href)) return;
    const cells = row.find('td.msga2-o').toArray().map((td: any) => clean($(td).text()));
    if (cells.length < 7) return;
    // SS.com may prepend auxiliary columns, but the final seven apartment
    // columns are stable: address, rooms, area, floor, series, €/m², price.
    const data = cells.slice(-7);
    const url = new URL(href, baseUrl).href; const floorParts = data[3]?.split('/');
    const priceEur = numberFrom(data[6] ?? ''); const areaM2 = numberFrom(data[2] ?? '');
    rows.push({ listingId: listingIdFromUrl(url), source:'SS.com', url, scrapedAt, publishedAt:null,
      searchName, district, address:data[0] ?? '', rooms:numberFrom(data[1] ?? ''), bathrooms:null,
      areaM2, floor:numberFrom(floorParts?.[0] ?? ''), totalFloors:numberFrom(floorParts?.[1] ?? ''),
      series:data[4] || null, priceEur, pricePerM2:areaM2 && priceEur ? Math.round((priceEur/areaM2)*100)/100 : numberFrom(data[5] ?? ''),
      title:clean(link.text()), description:'', imageUrls:[], sellerType:null });
  });
  return rows;
}

export function enrichFromDetail($: CheerioRoot, listing: Listing): Listing {
  const title = clean($('#msg_div_msg').text()) || clean($('h2').first().text()) || listing.title;
  const description = clean($('#msg_div_msg').text()) || title;
  const images = new Set<string>();
  $('a[href*="i.ss.lv/gallery/"], a[id^="im_link_"], img.pic_thumbnail, img[id^="im_"], meta[property="og:image"]').each((_i: number, el: any) => {
    const node = $(el); const raw = node.attr('href') || node.attr('src') || node.attr('content');
    if (raw && !raw.startsWith('data:')) images.add(new URL(raw, listing.url).href);
  });
  let publishedAt: string | null = listing.publishedAt;
  $('td.ads_opt_name').each((_i: number, el: any) => { const label=clean($(el).text()).toLowerCase(); const value=clean($(el).next('td').text()); if (/datums|дата/.test(label)) publishedAt=value || null; });
  const sellerText = clean($('body').text()).toLowerCase();
  const sellerType = /mākler|aģent|агент|broker/.test(sellerText) ? 'agency_or_broker' : null;
  return { ...listing, title, description, imageUrls:[...images], publishedAt, sellerType };
}

export function paginationUrls($: CheerioRoot, baseUrl: string): string[] {
  const out = new Set<string>(); $('a[href*="/page"]').each((_i: number, el: any) => { const href=$(el).attr('href'); if (href) out.add(new URL(href, baseUrl).href); }); return [...out];
}
