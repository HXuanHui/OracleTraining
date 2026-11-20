/**
 * 掃 i11 在不同 UNDO_RETENTION、reportScale 下是否達標。
 */
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { SCENARIOS } = await server.ssrLoadModule('/src/data/scenarios.ts');
const { compute } = await server.ssrLoadModule('/src/model/compute.ts');
const sc = SCENARIOS.find((s) => s.id === 'i11');

function sweep(label, w, retention) {
  const cfg = { ...sc.cfg, undo_retention: retention };
  let minL = Infinity;
  let maxL = 0;
  let minE = Infinity;
  let maxE = 0;
  let minR = Infinity;
  let maxR = 0;
  for (let t = 0; t < 90; t++) {
    const m = compute(cfg, w, t, 1);
    minL = Math.min(minL, m.lat);
    maxL = Math.max(maxL, m.lat);
    minE = Math.min(minE, m.err);
    maxE = Math.max(maxE, m.err);
    minR = Math.min(minR, m.reportDur);
    maxR = Math.max(maxR, m.reportDur);
  }
  const pass = maxL <= sc.goal.lat && maxE <= sc.goal.err;
  console.log(label, {
    lat: `${minL.toFixed(1)}–${maxL.toFixed(1)}`,
    err: `${(minE * 100).toFixed(1)}–${(maxE * 100).toFixed(1)}%`,
    report: `${minR.toFixed(0)}–${maxR.toFixed(0)}s`,
    pass,
  });
}

console.log('goal', sc.goal, 'scale', sc.w.reportScale, 'undo', sc.cfg.undo_retention);
sweep('now/180', sc.w, 180);
sweep('now/900', sc.w, 900);

for (const scale of [8000, 12000, 20000, 30000]) {
  const w = { ...sc.w, reportScale: scale };
  console.log('--- scale', scale);
  for (const r of [180, 600, 900, 1200, 1800]) sweep(`r${r}`, w, r);
}

await server.close();
