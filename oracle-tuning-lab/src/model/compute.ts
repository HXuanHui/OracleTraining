/**
 * 效能計算與驗證純函式。
 * 對應原始 HTML 中的 compute / validateSga / startupCheck 等模型邏輯。
 */
import { clamp } from '../utils/format';
import type { Config, Metrics, Workload } from './types';

/**
 * 依時間曲線計算當下使用者數。
 * @param w 工作負載
 * @param t 模擬時間（秒）
 */
export function usersAt(w: Workload, t: number): number {
  return Math.round(w.users * (w.curve ? w.curve(t) : 1 + 0.08 * Math.sin(t / 7)));
}

/**
 * 判斷當下是否處於週期性節點故障區間。
 * @param w 工作負載
 * @param t 模擬時間（秒）
 */
export function inFailure(w: Workload, t: number): boolean {
  if (!w.failure) return false;
  const x = ((t % w.failure.every) + w.failure.every) % w.failure.every;
  return x >= w.failure.at && x < w.failure.at + w.failure.dur;
}

/**
 * 計算 FRA 穩定後的目標佔用量（每小時歸檔量 × 保留時數）。
 * @param cfg 參數組態
 * @param w 工作負載
 */
export function fraTargetOf(cfg: Config, w: Workload): number {
  return cfg.archivelog === 'ARCHIVELOG' ? w.redoMBps * 3.6 * Number(cfg.arch_keep) : 0;
}

/**
 * 驗證 SGA 相關參數是否互相矛盾。
 * ASMM 關閉時檢查固定區塊總和；開啟時檢查最小保證值。
 * @param cfg 待驗證組態
 */
/**
 * 是否啟用 ASMM。
 * 真實環境以 SGA_TARGET>0 為準；實驗室的 asmm 開關只是同步顯示。
 */
export function isAsmmOn(cfg: Config): boolean {
  return Number(cfg.sga_target) > 0 && cfg.asmm !== 'OFF';
}

export function validateSga(cfg: Config): { ok: boolean; msg?: string } {
  const large = Number(cfg.large_pool_size) || 0;
  const java = Number(cfg.java_pool_size) || 0;
  // SGA_TARGET=0（或 ASMM 關閉）→ 手動分配各區塊
  if (!isAsmmOn(cfg)) {
    const sum = Number(cfg.shared_pool_size) + Number(cfg.db_cache_size) + large + java + 0.25;
    if (sum > Number(cfg.sga_max_size)) {
      return {
        ok: false,
        msg: `共用池、資料快取、大型池與 Java 池加起來約 ${sum.toFixed(2)} GB，超過 SGA 上限 ${cfg.sga_max_size} GB (ORA-00384)`,
      };
    }
  } else {
    const tgt = Math.min(Number(cfg.sga_target), Number(cfg.sga_max_size));
    const floor = Number(cfg.shared_pool_size) + Number(cfg.db_cache_size);
    if (floor > tgt * 0.92) {
      return {
        ok: false,
        msg: `共用池與資料快取的最小值加起來 ${floor} GB，超過 SGA 目前大小 ${tgt} GB 能分配的 ${(tgt * 0.92).toFixed(1)} GB (ORA-00824)`,
      };
    }
  }
  const memMax = Number(cfg.memory_max_target) || 0;
  const memTgt = Number(cfg.memory_target) || 0;
  if (memTgt > 0 && memMax > 0 && memTgt > memMax) {
    return {
      ok: false,
      msg: `MEMORY_TARGET ${memTgt} GB 不能大於 MEMORY_MAX_TARGET ${memMax} GB`,
    };
  }
  return { ok: true };
}

/**
 * 重啟掛載階段的啟動檢查：記憶體總量與 SGA 一致性。
 * @param cfg 參數檔組態
 * @param w 工作負載（含伺服器 RAM）
 */
export function startupCheck(cfg: Config, w: Workload): { ok: boolean; msg?: string } {
  const need = Number(cfg.sga_max_size) + Number(cfg.pga);
  const room = w.ram - 1;
  if (need > room) {
    const locked = cfg.lock_sga === 'TRUE';
    return {
      ok: false,
      msg: locked
        ? `LOCK_SGA=TRUE 且 SGA 上限 ${cfg.sga_max_size} GB 加 PGA ${cfg.pga} GB 超過可用的 ${room} GB，無法把 SGA 鎖在實體記憶體`
        : `記憶體不足：SGA 上限 ${cfg.sga_max_size} GB 加 PGA ${cfg.pga} GB 超過可用的 ${room} GB，無法建立執行個體`,
    };
  }
  if (Number(cfg.sessions) < Number(cfg.processes)) {
    return {
      ok: false,
      msg: `SESSIONS（${cfg.sessions}）不能小於 PROCESSES（${cfg.processes}）`,
    };
  }
  const v = validateSga({ ...cfg, sga_target: Math.min(Number(cfg.sga_target), Number(cfg.sga_max_size)) });
  if (!v.ok) return { ok: false, msg: '參數檔的 SGA 設定互相矛盾：' + v.msg };
  return { ok: true };
}

/** compute 的延伸輸入（節點數、FRA 實際用量） */
export interface ComputeExt {
  nodes?: number;
  fraUsed?: number;
}

/**
 * 依目前參數、負載與時間計算效能快照。
 * 包含延遲、TPS、等待事件、記憶體分配，以及拒連／ORA 來源強度。
 * @param cfg 執行中參數
 * @param w 工作負載
 * @param t 模擬時間
 * @param warm 快取預熱程度 0–1
 * @param ext 節點數與 FRA 實際用量
 */
export function compute(
  cfg: Config,
  w: Workload,
  t: number,
  warm: number,
  ext: ComputeExt = {},
): Metrics {
  const racOn = cfg.cluster_db === 'TRUE';
  const nodesCfg = racOn ? (ext.nodes != null ? ext.nodes : Number(cfg.rac_nodes)) : 1;
  const failing = inFailure(w, t);
  let alive = nodesCfg;

  // 單一執行個體故障 → 整站中斷
  if (failing) {
    if (nodesCfg < 1.99) {
      return {
        outage: true, failing, alive: 0, nodes: nodesCfg,
        users: 0, connected: 0, lat: 0, tps: 0, hit: 0, hardPerSec: 0, cpuUtil: 0,
        parts: { conn: 0, cur: 0, snap: 0, undo: 0, shared: 0, arch: 0 },
        swap: false, resident: 0, sga: 0, pga: 0, sharedG: 0, cacheG: 0, asmmOn: true,
        waits: [], reportDur: 0, undoNeed: 0, spill: 0, fraUsed: 0, fraTarget: 0, fraFull: false, util: 0,
      };
    }
    alive = nodesCfg - 1;
  }

  const part = cfg.svc_route === 'PARTITIONED';
  const sNeed = w.sharedNeed * (cfg.cursor_sharing === 'FORCE' ? 0.5 : 1);

  // --- 記憶體：SGA_TARGET>0 為 ASMM；=0 為手動固定各區塊 ---
  const asmmOn = isAsmmOn(cfg);
  let sga: number, shared: number, cache: number;
  if (asmmOn) {
    sga = Math.min(Number(cfg.sga_target), Number(cfg.sga_max_size));
    shared = Math.max(Number(cfg.shared_pool_size), Math.min(sNeed * 1.3, sga * 0.4));
    cache = Math.max(Number(cfg.db_cache_size), sga * 0.92 - shared);
  } else {
    shared = Number(cfg.shared_pool_size);
    cache = Number(cfg.db_cache_size);
    const large = Number(cfg.large_pool_size) || 0;
    const java = Number(cfg.java_pool_size) || 0;
    sga = Math.min(shared + cache + large + java + 0.25, Number(cfg.sga_max_size));
  }
  const pga = Number(cfg.pga);
  const resident = sga + pga + 1;
  const swapMul = 1 + Math.max(0, (resident - w.ram) / w.ram) * 14;
  const wsEff = racOn && part ? w.workingSet / Math.max(1, alive) : w.workingSet;
  const hitRaw = clamp(1 - Math.exp(-2 * cache / wsEff), 0.3, 0.9995);
  const hit = hitRaw * warm + 0.3 * (1 - warm);
  const shErr = w.literal > 0.2 && shared < sNeed * 0.7
    ? clamp((sNeed * 0.7 - shared) / (sNeed * 0.7), 0, 1) * 0.4
    : 0;

  const users = usersAt(w, t);
  // processes 與 sessions 各卡一道門；背景約佔 40 個
  const procCap = Math.max(0, (Number(cfg.processes) - 40) * alive);
  const sessCap = Math.max(0, (Number(cfg.sessions || Math.floor(Number(cfg.processes) * 1.5 + 22)) - 40) * alive);
  const connected = Math.min(users, procCap, sessCap);
  const connErr = users > 0 ? 1 - connected / users : 0;
  const curErr = Number(cfg.open_cursors) < w.cursorsNeed
    ? clamp((w.cursorsNeed - Number(cfg.open_cursors)) / w.cursorsNeed, 0, 1) * 0.6
    : 0;
  const coresTot = w.cores * alive;

  const hard = cfg.cursor_sharing === 'FORCE' ? w.literal * 0.04 : w.literal;
  const scc = clamp(Number(cfg.session_cached_cursors) / w.hotCursors, 0, 1);
  // 軟解析：快取覆蓋熱門游標越多越便宜。softMs 只讓指定關卡放大「完全沒快取」的懲罰，預設 0.4。
  const softMs = w.softMs ?? 0.4;
  const parse = hard * w.hardCost + (1 - hard) * softMs * (1 - 0.6 * scc);
  const latch = hard * Math.max(0, 1 - shared / sNeed) * 12;
  const dbwrCpu = Math.max(0, Number(cfg.dbwr) - w.cores / 2) * 0.5;
  const sortCpu = w.sortMB * 0.02;
  const racMul = racOn && alive > 1.01 ? 1 + 0.04 * (alive - 1) : 1;
  const cpuC = (w.cpuBase + parse + dbwrCpu + sortCpu) * racMul;

  const io = w.lio * (1 - hit) * 0.8;
  const active = Math.max(1, connected / Math.max(1, alive) * w.sortActive);
  const spill = w.sortMB > 0 ? clamp(1 - (pga * 1024 / active) / w.sortMB, 0, 1) : 0;
  const temp = spill * w.sortMB * 0.5;
  const scan = w.scanMB * 0.12 * (1 + 3 * (1 - Math.min(1, Number(cfg.mbrc) / 128))) * (1 + (1 - hit) * 0.2);
  const first = cfg.optimizer_mode !== 'ALL_ROWS';
  const optMul = 1 + w.reportShare * (first ? 0.3 : 0) - (1 - w.reportShare) * (first ? 0.1 : 0);
  const needLB = Math.max(1, w.redoMBps * 1.5);
  const logb = Number(cfg.log_buffer) < needLB
    ? clamp((needLB / Number(cfg.log_buffer) - 1) * w.commitW, 0, 60)
    : 0;
  const cap = Number(cfg.dbwr) * 30;
  const fb = cap < w.writeMBps ? clamp((w.writeMBps / cap - 1) * w.writeW, 0, 80) : 0;
  const parEff = Math.min(Number(cfg.pms), w.cores * 2);
  let par = w.batchMs > 0
    ? w.batchMs / (1 + parEff * 0.4) * (Number(cfg.pms) > w.cores * 4
      ? 1 + (Number(cfg.pms) - w.cores * 4) / (w.cores * 4) * 0.5
      : 1)
    : 0;
  // 平行開著但大型池太小：訊息緩衝擠壓，步驟變慢
  if (par > 0 && Number(cfg.pms) > 0) {
    const needLp = Math.max(0.05, Number(cfg.pms) * 0.008);
    const lp = Number(cfg.large_pool_size) || 0;
    if (lp < needLp) par *= 1 + (needLp - lp) / needLp * 0.35;
  }
  // RAC 上允許跨節點平行時，多一點協調成本
  if (par > 0 && racOn && alive > 1.01 && cfg.parallel_force_local !== 'TRUE') {
    par *= 1.08;
  }

  // --- 歸檔 ---
  const archOn = cfg.archivelog === 'ARCHIVELOG';
  const archCap = Number(cfg.arch_procs) * 4;
  const archWait = archOn && w.redoMBps > archCap * 0.9
    ? clamp((w.redoMBps / (archCap * 0.9) - 1) * w.archW, 0, 70)
    : 0;
  const fraTarget = fraTargetOf(cfg, w);
  const fraUsed = ext.fraUsed != null ? ext.fraUsed : fraTarget;
  const fraFull = archOn && fraUsed >= Number(cfg.fra_size) * 0.98;
  const archErr = fraFull ? 0.85 : 0;

  // --- RAC：節點之間傳送資料區塊 ---
  const gc = racOn && alive > 1.01
    ? w.shareFrac * (1 - 1 / alive) * w.gcCost * (part ? 0.2 : 1)
    : 0;

  const comps: Record<string, number> = {
    cpu: cpuC, seq: io, scat: scan, temp, logbuf: logb, freebuf: fb, latch, par, gc, archwait: archWait,
  };
  const base = Object.values(comps).reduce((a, b) => a + b, 0);
  const pre = base * optMul;
  const lat0 = pre * swapMul;
  const tps0 = connected / (w.think + lat0 / 1000);
  const cpuMs = cpuC * optMul * swapMul;
  const util0 = tps0 * cpuMs / 1000 / coresTot;
  const queueF = 1 + Math.max(0, util0 - 0.65) * 4;
  const lat = lat0 * queueF;
  const tps = connected / (w.think + lat / 1000);
  const cpuUtil = clamp(tps * cpuMs / 1000 / coresTot, 0, 1);

  const reportDur = lat / 1000 * (w.reportScale || 0);
  const snapErr = w.reportScale && Number(cfg.undo_retention) < reportDur
    ? clamp(0.04 + 0.1 * (reportDur / Number(cfg.undo_retention) - 1), 0, 0.3)
    : 0;
  const undoNeed = Number(cfg.undo_retention) * (w.undoMBps || 0);
  const undoErr = w.undoMBps && undoNeed > w.undoSpace
    ? clamp(undoNeed / w.undoSpace - 1, 0, 1) * 0.3
    : 0;
  const waits: Record<string, number> = {};
  for (const k in comps) waits[k] = comps[k] * optMul;
  waits.cpu += lat - lat0;
  waits.swap = pre * (swapMul - 1);
  const wsum = Object.values(waits).reduce((a, b) => a + b, 0) || 1;
  const waitList = Object.keys(waits)
    .map((k) => ({ k, ms: waits[k], pct: waits[k] / wsum }))
    .filter((x) => x.ms > 0.01)
    .sort((a, b) => b.ms - a.ms);

  return {
    users, connected, lat, tps, hit, hardPerSec: tps * hard, cpuUtil,
    parts: { conn: connErr, cur: curErr, snap: snapErr, undo: undoErr, shared: shErr, arch: archErr },
    swap: swapMul > 1.02, resident, sga, pga, sharedG: shared, cacheG: cache, asmmOn,
    waits: waitList, reportDur, undoNeed, spill,
    alive, nodes: nodesCfg, failing, fraUsed, fraTarget, fraFull, util: util0,
  };
}
