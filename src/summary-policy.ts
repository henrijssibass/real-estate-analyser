export type SummaryFrequency = 'EVERY_RUN' | 'DAILY' | 'NEVER';

export function calendarDateInTimeZone(date: Date, timeZone = 'Europe/Riga'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shouldSendSummary(frequency: SummaryFrequency, currentDate: string, lastSentDate?: string): boolean {
  if (frequency === 'NEVER') return false;
  if (frequency === 'EVERY_RUN') return true;
  return lastSentDate !== currentDate;
}
