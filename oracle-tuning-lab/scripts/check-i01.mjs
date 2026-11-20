/**
 * 快速檢查 i01 在 PROCESSES=300 時是否達標。
 * 因無法直接 import TS，改以複製關鍵公式驗證。
 */
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

const w = { ram: 16, cores: 4, users: 220, workingSet: 2, think: 1, literal: 0.1, hotCursors: 50, cursorsNeed: 200, cpuBase: 3, hardCost: 9, lio: 12, sortMB: 1, sortActive: 0.1, scanMB: 0, reportShare: 0.1, redoMBps: 0.5, commitW: 5, writeMBps: 4, writeW: 10, batchMs: 0, sharedNeed: 0.6, undoMBps: 0, undoSpace: 0, reportScale: 0, shareFrac: 0.3, gcCost: 6, archW: 12 };
const cfg = { sga_max_size: 6, sga_target: 4, pga: 2, processes: 300, sessions: 772, open_cursors: 500, session_cached_cursors: 50, cursor_sharing: 'EXACT', optimizer_mode: 'ALL_ROWS', mbrc: 64, log_buffer: 32, dbwr: 2, pms: 16, undo_retention: 1800, shared_pool_size: 0.25, db_cache_size: 0.5, asmm: 'ON', large_pool_size: 0.25, java_pool_size: 0.05, archivelog: 'NOARCHIVELOG', cluster_db: 'FALSE', rac_nodes: 1, svc_route: 'ANY', fra_size: 50, arch_keep: 8, arch_procs: 4 };

function run(warm) {
  const alive = 1;
  const sNeed = w.sharedNeed;
  const sga = Math.min(Number(cfg.sga_target), Number(cfg.sga_max_size));
  const shared = Math.max(Number(cfg.shared_pool_size), Math.min(sNeed * 1.3, sga * 0.4));
  const cache = Math.max(Number(cfg.db_cache_size), sga * 0.92 - shared);
  const hitRaw = clamp(1 - Math.exp(-2 * cache / w.workingSet), 0.3, 0.9995);
  const hit = hitRaw * warm + 0.3 * (1 - warm);
  const users = w.users;
  const procCap = Math.max(0, (Number(cfg.processes) - 40) * alive);
  const connected = Math.min(users, procCap);
  const connErr = users > 0 ? 1 - connected / users : 0;
  const hard = cfg.cursor_sharing === 'FORCE' ? w.literal * 0.04 : w.literal;
  const scc = clamp(Number(cfg.session_cached_cursors) / w.hotCursors, 0, 1);
  const parse = hard * w.hardCost + (1 - hard) * 0.4 * (1 - 0.6 * scc);
  const latch = hard * Math.max(0, 1 - shared / sNeed) * 12;
  const cpuC = w.cpuBase + parse + 0 + w.sortMB * 0.02;
  const io = w.lio * (1 - hit) * 0.8;
  const comps = { cpu: cpuC, seq: io, latch };
  const base = Object.values(comps).reduce((a, b) => a + b, 0);
  const lat0 = base;
  const tps0 = connected / (w.think + lat0 / 1000);
  const util0 = tps0 * cpuC / 1000 / (w.cores * alive);
  const queueF = 1 + Math.max(0, util0 - 0.65) * 4;
  const lat = lat0 * queueF;
  const err = connErr;
  console.log({ warm, lat: +lat.toFixed(2), err: +(err * 100).toFixed(2), hit: +hit.toFixed(3), connected, goalLat: 12, pass: lat <= 12 && err <= 0.01 });
}
run(1);
run(0.9);
run(0.5);
