export const event = () => {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.forEach(fn => fn(...args)), listeners };
};
export const area = values => ({
  get: async key => key === null ? structuredClone(values) : Array.isArray(key) ? Object.fromEntries(key.map(name => [name, structuredClone(values[name])])) : ({ [key]: structuredClone(values[key]) }),
  set: async entries => Object.assign(values, structuredClone(entries)),
  remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  setAccessLevel: async () => {},
});
