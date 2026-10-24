import { SafeError } from './security.js';
export function validateSchedule(reminderTime = '10:00', timeZone = 'Asia/Shanghai') {
  if (typeof reminderTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime) || typeof timeZone !== 'string') throw new SafeError('Use a valid daily time (HH:mm) and IANA timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new SafeError('Use a valid daily time (HH:mm) and IANA timezone.'); }
  return { reminderTime, timeZone };
}

export function dueDate(time, timeZone, reminderTime = '10:00') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}` >= validateSchedule(reminderTime, timeZone).reminderTime ? `${values.year}-${values.month}-${values.day}` : null;
}
