export const ROUTES = ['reading-list', 'settings'];
export function initialRoute(hash) {
  const requested = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  return ROUTES.includes(requested) ? requested : 'reading-list';
}
