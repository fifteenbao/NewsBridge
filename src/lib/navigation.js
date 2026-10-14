export const ROUTES = ['home', 'reading-list', 'settings'];
export function initialRoute(hash, configured) {
  const requested = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  return ROUTES.includes(requested) ? requested : configured ? 'home' : 'settings';
}
