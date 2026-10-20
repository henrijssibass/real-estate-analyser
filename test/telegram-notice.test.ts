import {afterEach,describe,it,expect,vi} from 'vitest';
import {sendTelegramNotice} from '../src/telegram.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('private Telegram result corrections',()=>{
  it('sends one plain-text correction only to the configured destination',async()=>{
    vi.stubEnv('TELEGRAM_BOT_TOKEN','test-only');vi.stubEnv('TELEGRAM_CHAT_ID','test-chat');
    const fetch=vi.fn(async()=>({ok:true,json:async()=>({ok:true})}));vi.stubGlobal('fetch',fetch);
    expect(await sendTelegramNotice('Correction: listing advertises a basement floor.')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({chat_id:'test-chat',text:'Correction: listing advertises a basement floor.',disable_web_page_preview:true});
  });
  it('refuses oversized text before contacting Telegram',async()=>{
    vi.stubEnv('TELEGRAM_BOT_TOKEN','test-only');vi.stubEnv('TELEGRAM_CHAT_ID','test-chat');
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect(await sendTelegramNotice('x'.repeat(4001))).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
});
