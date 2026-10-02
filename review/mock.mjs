// Run every effect through draw() on a do-nothing canvas: catches exceptions and NaN geometry fast.
globalThis.window = {}; await import('../actionfx.js'); const A = window.ActionFX;
let bad = 0;
const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (...a) => { if (a.some(v => typeof v === 'number' && !isFinite(v))) { bad++; if (bad < 5) console.log('NaN in', k, a); } }, set: (t, k, v) => (t[k] = v, true) });
for (const fx of Object.keys(A.effects)) for (const [w, h] of [[120, 40], [0, 0], [300, 30], [40, 200]]) for (const extra of [{}, { loop: true }, { still: true }, { shape: 'corners' }, { from: 'left' }, { dir: 'up' }])
  for (let t = 0; t < 4; t += 0.05) A.draw(ctx, t, { effect: fx, x: 10, y: 50, w, h, seed: 3, ...extra });
console.log('effects', Object.keys(A.effects).length, 'bad', bad);
