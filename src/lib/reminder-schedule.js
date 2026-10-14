import { SafeError } from './security.js';
export function validateSchedule(reminderTime = '10:00', timeZone = 'Asia/Shanghai') {
  if (typeof reminderTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime) || typeof timeZone !== 'string') throw new SafeError('Use a valid daily time (HH:mm) and IANA timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new SafeError('Use a valid daily time (HH:mm) and IANA timezone.'); }
  return { reminderTime, timeZone };
}
