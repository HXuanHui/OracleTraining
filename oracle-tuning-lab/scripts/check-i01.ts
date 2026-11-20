import { SCENARIOS } from '../src/data/scenarios';
import { compute } from '../src/model/compute';

const sc = SCENARIOS.find((s) => s.id === 'i01')!;
const cfg = { ...sc.cfg, processes: 300 };
const m = compute(cfg, sc.w, 30, 1);
console.log({
  processes: cfg.processes,
  sessions: cfg.sessions,
  lat: m.lat,
  err: m.err,
  goal: sc.goal,
  pass: m.lat <= sc.goal.lat && m.err <= sc.goal.err,
  connected: m.connected,
  users: m.users,
});
