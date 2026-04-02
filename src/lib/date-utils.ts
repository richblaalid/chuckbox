/**
 * Returns today's date as YYYY-MM-DD in the America/Chicago timezone.
 * Avoids the UTC offset issue where `new Date().toISOString().split('T')[0]`
 * returns "tomorrow" when called in the evening from US timezones.
 */
export function todayLocalDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}
