import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone, shouldSendSummary } from '../src/summary-policy.js';

describe('Telegram run summary policy', () => {
  it('sends only once per Riga calendar day', () => {
    expect(shouldSendSummary('DAILY', '2026-07-13')).toBe(true);
    expect(shouldSendSummary('DAILY', '2026-07-13', '2026-07-13')).toBe(false);
    expect(shouldSendSummary('DAILY', '2026-07-14', '2026-07-13')).toBe(true);
  });

  it('supports explicit every-run and never modes', () => {
    expect(shouldSendSummary('EVERY_RUN', '2026-07-13', '2026-07-13')).toBe(true);
    expect(shouldSendSummary('NEVER', '2026-07-13')).toBe(false);
  });

  it('uses the Riga date boundary', () => {
    expect(calendarDateInTimeZone(new Date('2026-07-13T21:30:00Z'))).toBe('2026-07-14');
  });
});
