export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isPastIso(iso: string, now: Date = new Date()): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}
