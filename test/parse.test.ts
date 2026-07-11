import { describe,expect,it } from 'vitest';
import { load } from 'cheerio';
import { listingIdFromUrl, numberFrom, parseSearchRows } from '../src/parse.js';
describe('SS.com parser',()=>{
 it('parses locale numbers',()=>{ expect(numberFrom('72,900 €')).toBe(72900); expect(numberFrom('62.5 m²')).toBe(62.5); });
 it('extracts stable id',()=>expect(listingIdFromUrl('https://www.ss.com/msg/lv/a/b/abcde.html')).toBe('abcde'));
 it('parses a table row',()=>{ const $=load(`<table><tr id="tr_1"><td><a class="am" href="/msg/lv/real-estate/flats/riga/a/abcde.html">Nice flat</a></td><td class="msga2-o">Today</td><td class="msga2-o">Street 1</td><td class="msga2-o">3</td><td class="msga2-o">62</td><td class="msga2-o">4/5</td><td class="msga2-o">LT proj.</td><td class="msga2-o">1,176 €</td><td class="msga2-o">72,900 €</td></tr></table>`); const [x]=parseSearchRows($,'https://www.ss.com','test','Kengarags','2026-01-01T00:00:00Z'); expect(x).toMatchObject({listingId:'abcde',rooms:3,areaM2:62,floor:4,totalFloors:5,priceEur:72900,searchName:'test'}); });
});
