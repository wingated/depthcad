export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const deepClone = o => JSON.parse(JSON.stringify(o));
