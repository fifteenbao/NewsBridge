// Use local calendar dates so 10:00 stays at 10:00 across timezone/DST changes.
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dueDay(date = new Date()) {
  const today = new Date(date);
  today.setHours(10, 0, 0, 0);
  return date >= today ? localDay(date) : null;
}
export function nextDailySend(date = new Date()) {
  const next = new Date(date);
  next.setHours(10, 0, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  return next.getTime();
}
