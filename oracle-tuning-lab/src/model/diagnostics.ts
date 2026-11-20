/**
 * 由目前對局組出各 V$／DBA 檢視切片。
 * 數字來自模擬，不是累計值；註腳會說明和真實檢視的差別。
 */
import { WAITS } from '../data/waits';
import type { ViewKey } from '../data/views';
import { VIEWS } from '../data/views';
import type { GameState } from './types';

/** 左側可以點開的指標（相容舊呼叫） */
export type ProbeId = 'lat' | 'tps' | 'hit' | 'status' | 'wait' | 'mem';

/** 診斷抽屜裡的檢視（與 ViewKey 對齊） */
export type ViewId = ViewKey;

/** 一張給表格用的檢視切片 */
export interface DiagTable {
  /** 欄位標題。進階用中文，專家用 Oracle 欄名。 */
  headers: string[];
  rows: { cells: string[]; hot: boolean }[];
  /** 這張表和真實檢視差在哪，避免把切片當成累計值 */
  footnote: string;
}

/** 等待事件的 WAIT_CLASS。swap 不是 Oracle 等待，歸在作業系統。 */
const WAIT_CLASS: Record<string, { en: string; zh: string }> = {
  cpu: { en: 'CPU', zh: 'CPU' },
  seq: { en: 'User I/O', zh: '使用者 I/O' },
  scat: { en: 'User I/O', zh: '使用者 I/O' },
  temp: { en: 'User I/O', zh: '使用者 I/O' },
  logbuf: { en: 'Configuration', zh: '設定' },
  freebuf: { en: 'Configuration', zh: '設定' },
  latch: { en: 'Concurrency', zh: '並行' },
  par: { en: 'Other', zh: '其他' },
  swap: { en: 'Operating System', zh: '作業系統' },
  gc: { en: 'Cluster', zh: '叢集' },
  archwait: { en: 'Configuration', zh: '設定' },
};

/** 進階與專家抽屜頂端會貼出的查詢。Alert Log 不是檢視，只給檔案路徑。 */
export const PROBE_SQL: Record<ViewId, string> = {
  sysmetric: `SELECT metric_name, value
FROM   v$sysmetric
WHERE  group_id = 2  -- 60 秒區間
  AND  metric_name IN (
         'SQL Service Response Time',
         'User Transaction Per Sec',
         'Buffer Cache Hit Ratio'
       );`,
  resource: `SELECT resource_name,
       current_utilization,
       max_utilization,
       limit_value
FROM   v$resource_limit
WHERE  resource_name IN ('processes', 'sessions');`,
  session: `SELECT sid, serial#, username, status, event, program
FROM   v$session
ORDER BY sid;`,
  event: `SELECT event, wait_class, time_waited_micro
FROM   v$system_event
ORDER BY time_waited_micro DESC;`,
  alert: `-- 這不是 V$ 檢視，是文字檔
-- Linux:
-- $ORACLE_BASE/diag/rdbms/<db>/<inst>/trace/alert_<inst>.log`,
  osstat: `SELECT stat_name, value
FROM   v$osstat
WHERE  stat_name IN ('NUM_CPUS', 'PHYSICAL_MEMORY_BYTES');`,
  sgainfo: `SELECT name, bytes/1024/1024/1024 AS gb
FROM   v$sgainfo
ORDER BY bytes DESC;`,
  pgastat: `SELECT name, value
FROM   v$pgastat
WHERE  name IN (
         'aggregate PGA target parameter',
         'total PGA allocated',
         'bytes processed',
         'extra bytes read/written'
       );`,
  sysstat: `SELECT name, value
FROM   v$sysstat
WHERE  name IN (
         'parse count (hard)',
         'parse count (total)',
         'session cursor cache hits',
         'session cursor cache count'
       );`,
  undostat: `SELECT begin_time, end_time,
       maxquerylen, tuned_undoretention,
       ssolderrcnt, unxpstealcnt, nospaceerrcnt, undoblks
FROM   v$undostat
ORDER BY begin_time DESC;`,
  undots: `SELECT t.tablespace_name, d.file_name,
       d.bytes/1024/1024 AS mb,
       d.autoextensible, d.maxbytes/1024/1024 AS max_mb
FROM   dba_data_files d
JOIN   dba_tablespaces t ON t.tablespace_name = d.tablespace_name
WHERE  t.contents = 'UNDO';`,
  recovery: `SELECT name, space_limit/1024/1024/1024 AS limit_gb,
       space_used/1024/1024/1024 AS used_gb,
       space_reclaimable/1024/1024/1024 AS reclaim_gb
FROM   v$recovery_file_dest;`,
  instance_recovery: `SELECT recovery_estimated_ios,
       estimated_mttr, target_mttr, ckpt_block_writes
FROM   v$instance_recovery;`,
  open_cursor: `SELECT sid, COUNT(*) AS open_cursors
FROM   v$open_cursor
GROUP BY sid
ORDER BY open_cursors DESC;`,
  px_process: `SELECT server_name, status, sid, pid
FROM   v$px_process
ORDER BY server_name;`,
  gv_instance: `SELECT inst_id, instance_name, status, host_name
FROM   gv$instance
ORDER BY inst_id;`,
  parameter: `SELECT name, value, isdefault, issys_modifiable
FROM   v$parameter
WHERE  name IN (
         'processes', 'sessions', 'undo_retention',
         'sga_target', 'pga_aggregate_target'
       );`,
};

/**
 * 由左側點到的指標決定先打開哪一張檢視。
 * @param id 左側指標
 * @param state 目前對局
 * @returns 檢視識別
 */
export function viewOf(id: ProbeId, state: GameState): ViewId {
  if (id === 'status') return 'alert';
  if (id === 'mem') return 'sgainfo';
  if (id === 'lat' || id === 'hit') return 'sysmetric';
  if (id === 'tps') {
    if (state.m && state.m.parts.conn > 0.01) return 'resource';
    return 'sysmetric';
  }
  return 'event';
}

/**
 * 用白話點出目前拒連／ORA 的主要來源（給過關說明與 Alert Log 建議）。
 * @param state 目前對局
 * @returns 一句話；沒有明顯失敗時回傳空字串
 */
export function plainCause(state: GameState): string {
  const m = state.m;
  if (!m) return '資料庫沒在服務時，無法完成交易。';
  const p = m.parts;
  if (p.conn > 0.01) return '現在主要是人連不上（PROCESSES 滿了），不是 SQL 寫錯。';
  if (p.cur > 0.01) return '現在主要是游標開太多（ORA-01000）。';
  if (p.shared > 0.01) return '現在主要是共用池不夠（ORA-04031）。';
  if (p.snap > 0.01) return '現在主要是快照太舊（ORA-01555）。';
  if (p.undo > 0.01) return '現在主要是 Undo 空間不夠（ORA-30036）。';
  if (p.arch > 0.01) return '現在主要是快速復原區滿了（ORA-00257）。';
  return '';
}

/**
 * 進階與專家的下一步。指出該先打開哪張檢視。
 * @param state 目前對局
 * @returns 一句建議；沒有明顯瓶頸時回傳 null
 */
export function diagAdvice(state: GameState): string | null {
  const m = state.m;
  if (!m) {
    if (state.status === 'failed') return '啟動失敗先看 Alert Log 的 ORA，再用 PFILE 備份重開，不要沿用剛才那份 SPFILE。';
    if (state.status !== 'open') return '資料庫不在 OPEN。啟動與關閉的原文在 Alert Log，你下的指令在左側終端機。';
    return null;
  }
  const p = m.parts;
  if (p.conn > 0.01) {
    return 'processes 已經頂到上限。先看 V$RESOURCE_LIMIT 的 processes，再看 Alert Log 的 ORA-00020。被拒絕的連線不會出現在 V$SESSION。';
  }
  if (p.cur > 0.01) return '這是每個連線的 OPEN_CURSORS，看 V$OPEN_CURSOR 與 Alert Log 的 ORA-01000。';
  if (p.shared > 0.01) return '共用池不夠。Alert Log 是 ORA-04031；先看 V$SGAINFO 與 V$SYSSTAT 的硬解析。';
  if (p.snap > 0.01) {
    return '快照太舊是 ORA-01555。先開 V$UNDOSTAT：比對 MAXQUERYLEN 與 TUNED_UNDORETENTION，再看 UNDO 表空間（DBA_DATA_FILES）。';
  }
  if (p.undo > 0.01) {
    return 'Undo 空間被撐滿（ORA-30036）。看 V$UNDOSTAT 的 NOSPACEERRCNT，再看 UNDO 表空間容量與 AUTOEXTEND。';
  }
  if (p.arch > 0.01 || m.fraFull) return '快速復原區滿了，Alert Log 是 ORA-00257。先看 V$RECOVERY_FILE_DEST。';
  if (m.swap) return '這不是 Oracle 的等待事件。SGA 加 PGA 超過實體記憶體，作業系統在換頁。先看 V$OSSTAT 與右側記憶體條。';
  const top = m.waits[0];
  if (top && top.pct > 0.45) {
    const en = WAITS[top.k]?.en ?? top.k;
    return `這一秒約 ${Math.round(top.pct * 100)}% 的時間在 ${en}。從 V$SYSTEM_EVENT 這一列開始追。`;
  }
  return null;
}

/**
 * Undo／快照問題的判讀小卡（進階顯示；專家不顯示）。
 * @param state 目前對局
 * @returns 判讀文字；無關時 null
 */
export function undoReadCard(state: GameState): string | null {
  const m = state.m;
  if (!m) return null;
  const retention = Number(state.mem.undo_retention);
  const maxQ = Math.round(m.reportDur || 0);
  const tuned = Math.min(retention, maxQ > 0 ? Math.max(60, Math.floor(retention * 0.9)) : retention);
  const parts: string[] = [];
  if (m.parts.snap > 0.01 && maxQ > tuned) {
    parts.push(`MAXQUERYLEN（${maxQ}s）> TUNED_UNDORETENTION（${tuned}s）且有快照太舊 → 保留不夠。`);
  }
  if (m.parts.undo > 0.01) {
    parts.push('NOSPACEERRCNT > 0 → UNDO 表空間不夠，光調 UNDO_RETENTION 不夠。');
  }
  if (m.parts.snap > 0.01 && m.parts.undo < 0.01 && maxQ <= retention) {
    parts.push('參數保留看似夠，但 TUNED 可能因空間被壓低；對照表空間使用量。');
  }
  return parts.length ? parts.join(' ') : null;
}

/** 單一節點上的使用者人數。資料庫沒在 OPEN 時無法換算。 */
function usersPerNode(state: GameState): number | null {
  if (!state.m || state.status !== 'open') return null;
  const alive = Math.max(state.m.alive, 0.01);
  return Math.round(state.m.connected / alive);
}

/**
 * V$SYSMETRIC 切片：回應時間、TPS、命中率。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function sysmetricTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['METRIC_NAME', 'VALUE']
    : ['指標', '數值'];
  if (!state.m || state.status !== 'open') {
    return { headers, rows: [], footnote: '資料庫不在 OPEN，沒有即時指標。' };
  }
  const m = state.m;
  const rows = [
    {
      cells: expert
        ? ['SQL Service Response Time', m.lat.toFixed(2)]
        : ['SQL 服務回應時間（厘秒近似）', `${m.lat.toFixed(1)} ms`],
      hot: m.lat > state.sc.goal.lat,
    },
    {
      cells: expert
        ? ['User Transaction Per Sec', m.tps.toFixed(1)]
        : ['每秒使用者交易', m.tps.toFixed(1)],
      hot: false,
    },
    {
      cells: expert
        ? ['Buffer Cache Hit Ratio', (m.hit * 100).toFixed(1)]
        : ['資料快取命中率 %', (m.hit * 100).toFixed(1)],
      hot: m.hit < 0.9,
    },
  ];
  return {
    headers,
    rows,
    footnote: '真實 V$SYSMETRIC 有多個 GROUP_ID 與區間；這裡是實驗室這一秒的切片。',
  };
}

/**
 * V$RESOURCE_LIMIT 切片：processes 與 sessions。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function resourceTable(state: GameState, expert: boolean): DiagTable {
  const bg = 40;
  const users = usersPerNode(state);
  const procLimit = Number(state.mem.processes);
  const sessLimit = Number(state.mem.sessions) || Math.floor(procLimit * 1.5 + 22);
  const procCur = users == null ? null : Math.min(procLimit, users + bg);
  const sessCur = users == null ? null : Math.min(sessLimit, users + bg);
  const cell = (n: number | null) => (n == null ? '—' : String(n));
  const headers = expert
    ? ['RESOURCE_NAME', 'CURRENT_UTILIZATION', 'MAX_UTILIZATION', 'LIMIT_VALUE']
    : ['資源', '目前使用', '開機後最高', '上限'];
  const row = (name: string, cur: number | null, limit: number) => ({
    cells: [name, cell(cur), cell(cur), String(limit)],
    hot: cur != null && cur >= limit,
  });
  const notes = [
    expert
      ? 'MAX_UTILIZATION 是開機以來的高水位。這裡沒有另記歷史，先等於目前值。'
      : '開機後最高在真實資料庫會一直留著。這裡沒有另記歷史，先等於目前值。',
    '系統大約佔 40 個背景 process，所以連得進來的人數比 PROCESSES 少。',
    'SESSIONS 未手動設定時，預設約為 PROCESSES × 1.5 + 22。只調 PROCESSES 忘了 SESSIONS 仍可能被拒。',
  ];
  if (state.mem.cluster_db === 'TRUE') notes.push('叢集時每個執行個體各看各的，不是把節點加總。');
  return {
    headers,
    rows: [row('processes', procCur, procLimit), row('sessions', sessCur, sessLimit)],
    footnote: notes.join(' '),
  };
}

/** 使用者工作階段該顯示的等待。CPU 不是 V$SESSION.EVENT。 */
function userEvent(state: GameState): string {
  const waits = state.m?.waits ?? [];
  const pick = waits.find((w) => w.k !== 'cpu');
  if (!pick) return 'SQL*Net message from client';
  return WAITS[pick.k]?.en ?? pick.k;
}

/**
 * V$SESSION 樣本。
 * @param state 目前對局
 * @param expert true 時多 SERIAL# 與 PROGRAM
 */
export function sessionTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['SID', 'SERIAL#', 'USERNAME', 'STATUS', 'EVENT', 'PROGRAM']
    : ['SID', '使用者', '狀態', '等待事件'];
  if (!state.m || state.status !== 'open') {
    return { headers, rows: [], footnote: '資料庫不在 OPEN，沒有可列出的工作階段。' };
  }
  const archOn = state.mem.archivelog === 'ARCHIVELOG';
  const archBusy = state.m.fraFull || state.m.waits.some((w) => w.k === 'archwait' && w.pct > 0.05);
  const event = userEvent(state);
  interface Sess {
    sid: string;
    serial: string;
    user: string;
    status: string;
    event: string;
    program: string;
    hot: boolean;
  }
  const rows: Sess[] = [
    { sid: '1', serial: '1', user: 'SYS', status: 'ACTIVE', event: 'pmon timer', program: 'PMON', hot: false },
    { sid: '2', serial: '1', user: 'SYS', status: 'ACTIVE', event: 'rdbms ipc message', program: 'DBW0', hot: false },
    { sid: '3', serial: '1', user: 'SYS', status: 'ACTIVE', event: 'rdbms ipc message', program: 'LGWR', hot: false },
  ];
  if (archOn) {
    rows.push({
      sid: '4', serial: '1', user: 'SYS', status: 'ACTIVE',
      event: archBusy ? 'ARCH wait on SENDREQ' : 'rdbms ipc message',
      program: 'ARC0', hot: archBusy,
    });
  }
  const n = state.m.connected < 1 ? 0 : Math.min(4, Math.max(1, Math.ceil(state.m.connected / 100)));
  for (let i = 0; i < n; i++) {
    rows.push({
      sid: String(101 + i),
      serial: String(20 + i * 7),
      user: 'APP',
      status: 'ACTIVE',
      event,
      program: 'JDBC Thin Client',
      hot: false,
    });
  }
  const notes = ['只列出背景程序和幾筆代表工作階段，不是全部的 SID。'];
  notes.push(`使用者連線約 ${Math.round(state.m.connected)}。`);
  if (state.m.waits[0]?.k === 'cpu') {
    notes.push('EVENT 欄不會出現 CPU time；那是等待事件。CPU 看 V$SYSTEM_EVENT 或 V$SYS_TIME_MODEL。');
  }
  if (state.m.parts.conn > 0.01) {
    notes.push('被拒絕的新連線不會出現在這張表，只會在 Alert Log 看到 ORA-00020。');
  }
  const cellsOf = (r: Sess) => (expert
    ? [r.sid, r.serial, r.user, r.status, r.event, r.program]
    : [r.sid, r.user, r.status, r.event]);
  return {
    headers,
    rows: rows.map((r) => ({ cells: cellsOf(r), hot: r.hot })),
    footnote: notes.join(' '),
  };
}

/**
 * V$SYSTEM_EVENT 的這一秒切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名與微秒
 * @param focusWait 從左側某一列點進來時要標出的等待鍵
 */
export function eventTable(state: GameState, expert: boolean, focusWait?: string): DiagTable {
  const headers = expert
    ? ['EVENT', 'WAIT_CLASS', 'TIME_WAITED_MICRO', 'PCT']
    : ['等待事件', '類別', '這一秒（毫秒）', '佔比'];
  const notes = ['這是這一秒的時間組成，不是開機以來的累計。'];
  if (expert) notes.push('真實欄位 TIME_WAITED_MICRO 的單位是微秒，而且會一直累加。');
  notes.push('CPU time 嚴格來說在 V$SYS_TIME_MODEL。這裡仍列出，回應時間才加得總。');
  if (!state.m) {
    return { headers, rows: [], footnote: `資料庫不在 OPEN，沒有等待事件。${notes.join(' ')}` };
  }
  const rows = state.m.waits.map((x, i) => {
    const cls = WAIT_CLASS[x.k] ?? { en: 'Other', zh: '其他' };
    const name = WAITS[x.k]?.en ?? x.k;
    const ms = x.ms >= 100 ? x.ms.toFixed(0) : x.ms.toFixed(1);
    const pct = `${Math.round(x.pct * 100)}%`;
    const cells = expert
      ? [name, cls.en, String(Math.round(x.ms * 1000)), pct]
      : [name, cls.zh, ms, pct];
    const hot = focusWait ? x.k === focusWait : i === 0;
    return { cells, hot };
  });
  return { headers, rows, footnote: notes.join(' ') };
}

/**
 * V$OSSTAT：核心數與實體記憶體。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function osstatTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert ? ['STAT_NAME', 'VALUE'] : ['統計項目', '數值'];
  const w = state.sc.w;
  const rows = [
    {
      cells: expert ? ['NUM_CPUS', String(w.cores)] : ['CPU 核心數', String(w.cores)],
      hot: false,
    },
    {
      cells: expert
        ? ['PHYSICAL_MEMORY_BYTES', String(Math.round(w.ram * 1024 ** 3))]
        : ['實體記憶體', `${w.ram} GB`],
      hot: !!state.m?.swap,
    },
  ];
  return {
    headers,
    rows,
    footnote: '真實 V$OSSTAT 還有負載與忙碌時間等列；這裡只保留調參最常用的兩項。',
  };
}

/**
 * V$SGAINFO 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function sgainfoTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert ? ['NAME', 'BYTES'] : ['元件', '大小'];
  const m = state.m;
  const mem = state.mem;
  const sga = m?.sga ?? Number(mem.sga_target);
  const shared = m?.sharedG ?? Number(mem.shared_pool_size);
  const cache = m?.cacheG ?? Number(mem.db_cache_size);
  const large = Number(mem.large_pool_size) || 0;
  const java = Number(mem.java_pool_size) || 0;
  const toBytes = (gb: number) => String(Math.round(gb * 1024 ** 3));
  const fmt = (gb: number) => `${gb.toFixed(2)} GB`;
  const rows = [
    { name: 'Fixed SGA Size', zh: '固定 SGA', gb: 0.01 },
    { name: 'Redo Buffers', zh: '重做緩衝', gb: Number(mem.log_buffer) / 1024 },
    { name: 'Buffer Cache Size', zh: '資料快取', gb: cache },
    { name: 'Shared Pool Size', zh: '共用池', gb: shared },
    { name: 'Large Pool Size', zh: '大型池', gb: large },
    { name: 'Java Pool Size', zh: 'Java 池', gb: java },
    { name: 'Maximum SGA Size', zh: 'SGA 上限', gb: Number(mem.sga_max_size) },
    { name: 'Free SGA Memory Available', zh: 'SGA 可用預留', gb: Math.max(0, Number(mem.sga_max_size) - sga) },
  ].map((r) => ({
    cells: expert ? [r.name, toBytes(r.gb)] : [r.zh, fmt(r.gb)],
    hot: false,
  }));
  return {
    headers,
    rows,
    footnote: `目前 SGA 約 ${sga.toFixed(2)} GB（${m?.asmmOn ? 'ASMM' : '手動'}）。數字是模擬切片，不是動態採樣。`,
  };
}

/**
 * V$PGASTAT 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function pgastatTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert ? ['NAME', 'VALUE'] : ['項目', '數值'];
  const pgaGb = Number(state.mem.pga);
  const spill = state.m?.spill ?? 0;
  const rows = [
    {
      cells: expert
        ? ['aggregate PGA target parameter', String(Math.round(pgaGb * 1024 ** 3))]
        : ['PGA 目標', `${pgaGb} GB`],
      hot: false,
    },
    {
      cells: expert
        ? ['total PGA allocated', String(Math.round(pgaGb * 0.85 * 1024 ** 3))]
        : ['已配置 PGA', `${(pgaGb * 0.85).toFixed(2)} GB`],
      hot: false,
    },
    {
      cells: expert
        ? ['extra bytes read/written', String(Math.round(spill * 1024 ** 2))]
        : ['溢寫磁碟', `${spill.toFixed(0)} MB`],
      hot: spill > 10,
    },
  ];
  return {
    headers,
    rows,
    footnote: '溢寫變大時，等待事件裡臨時段會升高。現代環境優先調 PGA_AGGREGATE_TARGET。',
  };
}

/**
 * V$SYSSTAT 切片（解析與游標）。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function sysstatTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert ? ['NAME', 'VALUE'] : ['統計項目', '數值'];
  if (!state.m) {
    return { headers, rows: [], footnote: '資料庫不在 OPEN。' };
  }
  const hard = Math.round(state.m.hardPerSec);
  const total = Math.max(hard * 3, Math.round(state.m.tps * 2));
  const cacheHits = Math.round(state.m.tps * Number(state.mem.session_cached_cursors) / 50);
  const rows = [
    {
      cells: expert ? ['parse count (hard)', String(hard)] : ['硬解析／秒', String(hard)],
      hot: hard > 20,
    },
    {
      cells: expert ? ['parse count (total)', String(total)] : ['總解析／秒', String(total)],
      hot: false,
    },
    {
      cells: expert ? ['session cursor cache hits', String(cacheHits)] : ['連線游標快取命中', String(cacheHits)],
      hot: Number(state.mem.session_cached_cursors) === 0,
    },
  ];
  return {
    headers,
    rows,
    footnote: '真實 V$SYSSTAT 是開機累計；這裡改成每秒速率，方便對照儀表板。',
  };
}

/**
 * V$UNDOSTAT 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function undoStatTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['BEGIN_TIME', 'MAXQUERYLEN', 'TUNED_UNDORETENTION', 'SSOLDERRCNT', 'UNXPSTEALCNT', 'NOSPACEERRCNT', 'UNDOBLKS']
    : ['區間起', '最長查詢(秒)', '調後保留(秒)', '快照太舊', '未到期被搶', '空間不足', 'Undo 區塊'];
  const m = state.m;
  const retention = Number(state.mem.undo_retention);
  const maxQ = Math.round(m?.reportDur || 0);
  // 模擬 TUNED：空間壓力時壓低實際保留
  const spacePressure = m && m.parts.undo > 0.01;
  const tuned = spacePressure
    ? Math.max(60, Math.floor(retention * 0.6))
    : Math.min(retention, maxQ > 0 ? Math.max(retention, maxQ) : retention);
  const ssold = m && m.parts.snap > 0.01 ? Math.max(1, Math.round(m.parts.snap * 10)) : 0;
  const nospace = m && m.parts.undo > 0.01 ? Math.max(1, Math.round(m.parts.undo * 8)) : 0;
  const unxp = spacePressure ? Math.max(1, nospace) : 0;
  const undoblks = Math.round((m?.undoNeed || retention * (state.sc.w.undoMBps || 0)) * 128);
  const t = state.t;
  const begin = `T+${Math.max(0, t - 600)}s`;
  const rows = [{
    cells: expert
      ? [begin, String(maxQ), String(tuned), String(ssold), String(unxp), String(nospace), String(undoblks)]
      : [begin, String(maxQ), String(tuned), String(ssold), String(unxp), String(nospace), String(undoblks)],
    hot: ssold > 0 || nospace > 0,
  }];
  return {
    headers,
    rows,
    footnote: '真實 V$UNDOSTAT 約每 10 分鐘一筆、留近 4 天。這裡用實驗室時鐘合成一列代表區間。UNDO_RETENTION 是期望值，TUNED_UNDORETENTION 才是動態調整後的實際保留。',
  };
}

/**
 * UNDO 表空間容量（DBA_DATA_FILES 風格）。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function undoTsTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['TABLESPACE_NAME', 'FILE_NAME', 'MB', 'AUTOEXTENSIBLE', 'MAX_MB']
    : ['表空間', '資料檔', '目前 MB', '自動擴充', '上限 MB'];
  const space = state.sc.w.undoSpace || 2048;
  const used = state.m?.undoNeed ?? 0;
  const rows = [{
    cells: expert
      ? ['UNDOTBS1', '/u01/oradata/UNDOTBS01.dbf', String(space), 'YES', String(Math.max(space, Math.ceil(used * 1.2)))]
      : ['UNDOTBS1', 'UNDOTBS01.dbf', String(space), '是', String(Math.max(space, Math.ceil(used * 1.2)))],
    hot: used > space,
  }];
  return {
    headers,
    rows,
    footnote: `目前推算需求約 ${used.toFixed(0)} MB。AUTOEXTEND 開著也不保證尖峰夠用，要看 MAXSIZE 與磁碟。`,
  };
}

/**
 * V$RECOVERY_FILE_DEST 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function recoveryTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['NAME', 'SPACE_LIMIT', 'SPACE_USED', 'SPACE_RECLAIMABLE']
    : ['路徑', '上限 GB', '已用 GB', '可回收 GB'];
  const limit = Number(state.mem.fra_size);
  const used = state.m?.fraUsed ?? state.fraUsed ?? 0;
  const reclaim = Math.max(0, used * 0.15);
  const rows = [{
    cells: expert
      ? ['+FRA', String(Math.round(limit * 1024 ** 3)), String(Math.round(used * 1024 ** 3)), String(Math.round(reclaim * 1024 ** 3))]
      : ['+FRA', limit.toFixed(0), used.toFixed(1), reclaim.toFixed(1)],
    hot: !!state.m?.fraFull || used >= limit * 0.9,
  }];
  return {
    headers,
    rows,
    footnote: 'FRA 需求粗估 ≈ 每小時歸檔量 × 保留時數。塞滿時寫入會整批卡住。',
  };
}

/**
 * V$INSTANCE_RECOVERY 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function instanceRecoveryTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['ESTIMATED_MTTR', 'TARGET_MTTR', 'CKPT_BLOCK_WRITES']
    : ['預估復原秒數', '目標秒數', '檢查點寫塊'];
  const target = Number(state.mem.fast_start_mttr_target);
  const estimated = target > 0 ? Math.max(target, Math.round(target * 1.1)) : 45;
  const rows = [{
    cells: [String(estimated), String(target), String(Math.round(1200 + (target > 0 && target < 60 ? 800 : 200)))],
    hot: target > 0 && target < 30,
  }];
  return {
    headers,
    rows,
    footnote: '目標設太小會迫使更頻繁的檢查點，寫入負擔上升。',
  };
}

/**
 * V$OPEN_CURSOR 彙總樣本。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function openCursorTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert ? ['SID', 'OPEN_CURSORS'] : ['SID', '已開游標'];
  const need = state.sc.w.cursorsNeed || 50;
  const limit = Number(state.mem.open_cursors);
  const n = Math.min(4, Math.max(1, Math.ceil((state.m?.connected || 1) / 100)));
  const rows = Array.from({ length: n }, (_, i) => {
    const open = Math.min(limit, Math.round(need * (0.7 + i * 0.1)));
    return {
      cells: [String(101 + i), String(open)],
      hot: open >= limit * 0.95,
    };
  });
  return {
    headers,
    rows,
    footnote: `OPEN_CURSORS 上限 ${limit}。真實檢視是每個游標一列；這裡改成依 SID 計數。`,
  };
}

/**
 * V$PX_PROCESS 樣本。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function pxProcessTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['SERVER_NAME', 'STATUS', 'SID', 'PID']
    : ['從屬名稱', '狀態', 'SID', 'PID'];
  const pms = Number(state.mem.pms);
  if (pms <= 0) {
    return {
      headers,
      rows: [],
      footnote: 'PARALLEL_MAX_SERVERS = 0，沒有平行從屬程序。',
    };
  }
  const busy = Math.min(pms, Math.max(1, Math.round(pms * 0.35)));
  const rows = Array.from({ length: Math.min(6, pms) }, (_, i) => ({
    cells: [
      `P00${i}`,
      i < busy ? 'IN USE' : 'AVAILABLE',
      i < busy ? String(200 + i) : '',
      String(3000 + i),
    ],
    hot: false,
  }));
  return {
    headers,
    rows,
    footnote: `上限 ${pms}；建議約核心數 × 2（目前 ${state.sc.w.cores} 核）。只列出前幾筆代表列。`,
  };
}

/**
 * GV$INSTANCE 切片。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function gvInstanceTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['INST_ID', 'INSTANCE_NAME', 'STATUS', 'HOST_NAME']
    : ['節點', '實例名', '狀態', '主機'];
  const nodes = Number(state.mem.rac_nodes) || 1;
  const rac = state.mem.cluster_db === 'TRUE';
  const alive = state.m?.alive ?? (rac ? state.nodesEff : 1);
  const n = rac ? nodes : 1;
  const rows = Array.from({ length: n }, (_, i) => {
    const up = i < alive;
    return {
      cells: [
        String(i + 1),
        `orcl${i + 1}`,
        up ? 'OPEN' : 'DOWN',
        `node${i + 1}.local`,
      ],
      hot: !up,
    };
  });
  return {
    headers,
    rows,
    footnote: rac ? '叢集時每個節點各有一份 SGA／PGA／PROCESSES。' : '目前是單一執行個體。',
  };
}

/**
 * V$PARAMETER 樣本（重點參數）。
 * @param state 目前對局
 * @param expert true 用 Oracle 欄名
 */
export function parameterTable(state: GameState, expert: boolean): DiagTable {
  const headers = expert
    ? ['NAME', 'VALUE', 'ISDEFAULT', 'ISSYS_MODIFIABLE']
    : ['參數', '值', '預設？', '可否動態改'];
  const keys = [
    ['processes', 'processes', 'FALSE', 'FALSE'],
    ['sessions', 'sessions', 'FALSE', 'FALSE'],
    ['undo_retention', 'undo_retention', 'FALSE', 'IMMEDIATE'],
    ['sga_target', 'sga_target', 'FALSE', 'IMMEDIATE'],
    ['pga_aggregate_target', 'pga', 'FALSE', 'IMMEDIATE'],
    ['open_cursors', 'open_cursors', 'FALSE', 'IMMEDIATE'],
    ['db_writer_processes', 'dbwr', 'FALSE', 'FALSE'],
    ['parallel_max_servers', 'pms', 'FALSE', 'IMMEDIATE'],
  ] as const;
  const rows = keys.map(([name, k, def, mod]) => ({
    cells: [name, String(state.mem[k] ?? ''), def, mod],
    hot: false,
  }));
  return {
    headers,
    rows,
    footnote: expert
      ? '只列出本實驗室常用參數，不是完整 v$parameter。'
      : '只列出本實驗室常用參數。',
  };
}

/**
 * 依 ViewId 組出對應表格。
 * @param view 檢視
 * @param state 目前對局
 * @param expert 是否專家欄名
 * @param focusWait 等待事件焦點
 */
export function tableOf(
  view: ViewId,
  state: GameState,
  expert: boolean,
  focusWait?: string,
): DiagTable {
  switch (view) {
    case 'sysmetric': return sysmetricTable(state, expert);
    case 'resource': return resourceTable(state, expert);
    case 'session': return sessionTable(state, expert);
    case 'event': return eventTable(state, expert, focusWait);
    case 'osstat': return osstatTable(state, expert);
    case 'sgainfo': return sgainfoTable(state, expert);
    case 'pgastat': return pgastatTable(state, expert);
    case 'sysstat': return sysstatTable(state, expert);
    case 'undostat': return undoStatTable(state, expert);
    case 'undots': return undoTsTable(state, expert);
    case 'recovery': return recoveryTable(state, expert);
    case 'instance_recovery': return instanceRecoveryTable(state, expert);
    case 'open_cursor': return openCursorTable(state, expert);
    case 'px_process': return pxProcessTable(state, expert);
    case 'gv_instance': return gvInstanceTable(state, expert);
    case 'parameter': return parameterTable(state, expert);
    case 'alert':
      return { headers: [], rows: [], footnote: '' };
    default: {
      const key = view as ViewKey;
      return { headers: [], rows: [], footnote: `尚未實作 ${VIEWS[key]?.name ?? key}` };
    }
  }
}

/**
 * 進階抽屜預設顯示的分頁清單（依目前瓶頸調整順序）。
 * @param state 目前對局
 * @param suggested 關卡／參數建議的檢視
 */
export function tabOrder(state: GameState, suggested: ViewId[] = []): ViewId[] {
  const base: ViewId[] = [
    'sysmetric', 'resource', 'session', 'event', 'osstat',
    'sgainfo', 'pgastat', 'sysstat', 'undostat', 'undots',
    'recovery', 'alert',
  ];
  // 建議的放前面，其餘接在後面並去重
  const seen = new Set<ViewId>();
  const out: ViewId[] = [];
  for (const v of [...suggested, ...base]) {
    if (seen.has(v)) continue;
    // 瓶頸導向：snap／undo 時把 undostat 提前
    seen.add(v);
    out.push(v);
  }
  if (state.m?.parts.snap || state.m?.parts.undo) {
    // 已在 suggested／base 中；保持即可
  }
  return out;
}
