/**
 * Returns today's date as YYYY-MM-DD in the user's local timezone.
 * Use this on the CLIENT side and pass the result to server actions,
 * since the server runs in UTC and can't determine the user's timezone.
 *
 * 'en-CA' locale formats as YYYY-MM-DD (ISO format).
 */
export function todayLocalDate(): string {
  return new Date().toLocaleDateString('en-CA')
}
