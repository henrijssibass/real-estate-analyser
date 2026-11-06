import { load } from 'cheerio';
import { enrichFromDetail, numberFrom } from './parse.js';
import type { Listing } from './types.js';

export function verifyDealHtml(html:string, listing:Listing):{listing?:Listing;reason?:string;note?:string}{
  const $=load(html);
  const description=$('#msg_div_msg').text().trim();
  const priceText=$('.ads_price').first().text().split('(')[0];
  const priceEur=numberFrom(priceText);
  const heading=$('#msg_div_msg').prevAll().first().text();
  if(!description||!priceEur||!priceText.includes('€')||/sludinājums nav aktīvs|объявление не активно/i.test(heading))return {reason:'DETAIL_UNVERIFIED'};
  const text=`${listing.title} ${description}`.toLocaleLowerCase('lv-LV');
  // Basement storage offered with a normal flat is not itself a basement flat.
  if(/cokol|pagrabstāv|puspagrab|цоколь|полуподвал|(?:dzīvoklis|квартира).{0,28}(?:pagrabā|в подвале)/iu.test(text))return {reason:'BASEMENT'};
  if(/(?:pārdod\S*|tiek pārdot\S*)\s+(?:tikai\s+)?(?:\d+\s*\/\s*\d+\s+|domājam\S*\s+)?(?:daļu|daļas)\s+(?:no\s+)?dzīvok[lļ]|(?:pārdod\S*|tiek pārdot\S*)\s+\d+\s*\/\s*\d+\s+(?:no\s+)?dzīvok[lļ]|(?:доля|долю)\s+(?:в\s+)?квартир|izsol[eē]|аукцион/iu.test(text))return {reason:'SHARE_OR_AUCTION'};
  if(/(?:pārdots|rezervēts|продано|забронировано)(?:\s*[.!]|\s*$)/iu.test(description.trim()))return {reason:'UNAVAILABLE'};
  const areaM2=numberFrom($('#tdo_3').text().replace(/m²/ig,'').trim())||listing.areaM2;
  const rooms=numberFrom($('#tdo_1').text())||listing.rooms;
  const floorParts=$('#tdo_4').text().split('/');
  const floor=floorParts[0]?.trim()?numberFrom(floorParts[0]):listing.floor;
  const totalFloors=floorParts[1]?.trim()?numberFrom(floorParts[1]):listing.totalFloors;
  const series=$('#tdo_6').text().trim()||listing.series;
  const note=/zeme nav īpašumā|zemes noma|земля не в собственности|аренда земли/iu.test(text)?'Sludinājumā minēta zemes noma; pārbaudi izmaksas.':undefined;
  return {listing:{...enrichFromDetail($,listing),priceEur,areaM2,rooms,floor,totalFloors,series,pricePerM2:areaM2?priceEur/areaM2:null},note};
}
