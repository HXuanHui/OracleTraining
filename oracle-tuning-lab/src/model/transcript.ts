/**
 * 把實驗室的操作翻成 SQL*Plus／RMAN 逐字稿與 alert log。
 * 註解（note）只給入門與進階；專家只留指令與伺服器回應。
 */
import type { Depth } from './depth';
import type { AlertLine, Config, LogLevel, ParamDef, TermLine } from './types';

/** ALTER SYSTEM 的 SCOPE。null 代表這次沒有寫入。 */
export type Scope = 'MEMORY' | 'SPFILE' | 'BOTH';

/** 尚未蓋上時間戳的一列終端機文字 */
interface TermDraft {
  kind: TermLine['kind'];
  text: string;
  upto?: 'intro' | 'mid';
}

/** 一次操作要追加的終端機與 alert log */
export interface Transcript {
  term: TermDraft[];
  alert: { level: LogLevel; text: string }[];
}

const TERM_CAP = 120;
const ALERT_CAP = 80;

/** 真實 ALTER SYSTEM 用的參數名。實驗室鍵名與 Oracle 名稱不同的列在這裡對上。 */
const SQL_NAME: Record<string, string> = {
  sga_max_size: 'sga_max_size',
  sga_target: 'sga_target',
  shared_pool_size: 'shared_pool_size',
  db_cache_size: 'db_cache_size',
  large_pool_size: 'large_pool_size',
  java_pool_size: 'java_pool_size',
  memory_target: 'memory_target',
  memory_max_target: 'memory_max_target',
  pre_page_sga: 'pre_page_sga',
  lock_sga: 'lock_sga',
  pga: 'pga_aggregate_target',
  processes: 'processes',
  sessions: 'sessions',
  open_cursors: 'open_cursors',
  session_cached_cursors: 'session_cached_cursors',
  cursor_sharing: 'cursor_sharing',
  optimizer_mode: 'optimizer_mode',
  mbrc: 'db_file_multiblock_read_count',
  sort_area_size: 'sort_area_size',
  db_block_size: 'db_block_size',
  dbwr: 'db_writer_processes',
  fast_start_mttr_target: 'fast_start_mttr_target',
  fra_size: 'db_recovery_file_dest_size',
  arch_procs: 'log_archive_max_processes',
  cluster_db: 'cluster_database',
  parallel_force_local: 'parallel_force_local',
  pms: 'parallel_max_servers',
  undo_retention: 'undo_retention',
  deferred_segment_creation: 'deferred_segment_creation',
  db_files: 'db_files',
  job_queue_processes: 'job_queue_processes',
  timed_statistics: 'timed_statistics',
  compatible: 'compatible',
  audit_trail: 'audit_trail',
};

/** 去掉多餘的小數 0，讓 8G、0.5G 讀起來像手打的指令 */
function compact(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Oracle 參數名；沒有對照表時退回實驗室鍵名 */
function oracleName(p: ParamDef): string {
  return SQL_NAME[p.k] ?? p.k;
}

/**
 * 把參數值編成 ALTER SYSTEM 右側的字面值。
 * LOG_BUFFER 走專用分支（單位是 bytes），這裡不處理。
 */
function sqlLiteral(p: ParamDef, v: string | number): string {
  // 布林參數不加引號
  if (p.k === 'cluster_db' || p.k === 'pre_page_sga' || p.k === 'lock_sga'
    || p.k === 'timed_statistics' || p.k === 'deferred_segment_creation'
    || p.k === 'parallel_force_local') {
    return String(v);
  }
  if (p.type === 'seg' || typeof v === 'string') return `'${v}'`;
  if (p.unit === 'GB') return `${compact(Number(v))}G`;
  if (p.k === 'sort_area_size') return String(Math.round(Number(v) * 1024)); // 介面是 KB，指令用 bytes
  return String(v);
}

/**
 * 依難度決定這一列要不要出現。
 * 專家只看指令與伺服器回應，註解全部拿掉。
 * @param line 逐字稿一列
 * @param depth 關卡深度
 * @returns 是否顯示
 */
export function termVisible(line: TermLine, depth: Depth): boolean {
  if (line.kind !== 'note') return true;
  if (depth === 'expert') return false;
  if (line.upto === 'intro') return depth === 'intro';
  return true;
}

/** 追加終端機列，超過上限時丟掉最舊的 */
function withTerm(prev: TermLine[], t: number, lines: TermDraft[]): TermLine[] {
  if (lines.length === 0) return prev;
  const next = prev.concat(lines.map((l) => {
    const row: TermLine = { t, kind: l.kind, text: l.text };
    if (l.upto) row.upto = l.upto;
    return row;
  }));
  return next.length > TERM_CAP ? next.slice(next.length - TERM_CAP) : next;
}

/**
 * 追加一列 alert log。
 * @param prev 既有 alert
 * @param t 模擬秒數
 * @param level 等級
 * @param text 訊息本文
 * @returns 截斷後的新陣列
 */
export function withAlert(prev: AlertLine[], t: number, level: LogLevel, text: string): AlertLine[] {
  const next = prev.concat([{ t, level, text }]);
  return next.length > ALERT_CAP ? next.slice(next.length - ALERT_CAP) : next;
}

/**
 * 把一份逐字稿蓋上時間戳，接在既有紀錄後面。
 * @param prev 目前的終端機與 alert
 * @param t 模擬秒數
 * @param tr 這次要追加的內容
 * @returns 新的終端機與 alert
 */
export function stampTranscript(
  prev: { term: TermLine[]; alert: AlertLine[] },
  t: number,
  tr: Transcript,
): { term: TermLine[]; alert: AlertLine[] } {
  let alert = prev.alert;
  for (const a of tr.alert) alert = withAlert(alert, t, a.level, a.text);
  return { term: withTerm(prev.term, t, tr.term), alert };
}

/** 從指令列抽出要寫進 alert log 的那一行（拿掉 SQL> / RMAN>） */
function alertFrom(term: TermDraft[]): Transcript['alert'] {
  const cmd = term.find((l) => l.kind === 'cmd');
  if (!cmd) return [];
  const text = cmd.text.replace(/^SQL>\s*/, '').replace(/^RMAN>\s*/, 'RMAN: ');
  return [{ level: 'info', text }];
}

/** 依 SCOPE 與參數種類補上給入門、進階看的註解 */
function scopeNotes(p: ParamDef, scope: Scope, v: string | number, mem: Config): TermDraft[] {
  const notes: TermDraft[] = [];
  const overMax = p.k === 'sga_target' && scope === 'SPFILE' && p.kind === 'dynamic';
  if (overMax) {
    notes.push({
      kind: 'note', upto: 'mid',
      text: '目標超過 SGA_MAX_SIZE，這次只寫進 SPFILE，重啟才拉得上去。',
    });
  } else if (scope === 'SPFILE' && p.kind === 'static' && p.k !== 'archivelog' && p.k !== 'cluster_db') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: 'SCOPE=SPFILE 只改參數檔，現在的記憶體要等重啟才變。',
    });
  } else if (scope === 'SPFILE' && p.kind !== 'static') {
    // 資料庫沒在 OPEN，或超過上限：動態參數這次也只進檔案
    notes.push({
      kind: 'note', upto: 'mid',
      text: '資料庫沒在 OPEN，所以這次只寫進 SPFILE。',
    });
  }
  if (p.k === 'cluster_db' && scope === 'SPFILE') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: 'CLUSTER_DATABASE 要重啟才生效。節點數在它變成 TRUE 之後才有作用。',
    });
  }
  if (scope === 'MEMORY') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: 'SCOPE=MEMORY 沒有寫進 SPFILE，重啟後會消失。',
    });
  }
  if (p.kind === 'deferred' && p.k !== 'svc_route') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: '這個參數只對新連線生效，舊連線要重連才看得到新值。',
    });
  }
  if (p.k === 'log_buffer') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: 'LOG_BUFFER 的單位是 bytes。指令後面的註解才是畫面上的 MB。',
    });
  }
  if (p.k === 'undo_retention') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: `畫面上是分鐘，UNDO_RETENTION 的指令要下秒（${v}）。`,
    });
  }
  if (p.k === 'rac_nodes' && mem.cluster_db !== 'TRUE') {
    notes.push({
      kind: 'note', upto: 'mid',
      text: 'CLUSTER_DATABASE 還沒啟用，節點數要等它重啟生效後才有作用。',
    });
  }
  return notes;
}

/**
 * 連線進 SQL*Plus 的開場。每個關卡開始時呼叫一次。
 * @returns 連線橫幅
 */
export function welcomeTranscript(): Transcript {
  return {
    term: [
      { kind: 'out', text: 'SQL*Plus: Release 19.0.0.0.0' },
      { kind: 'cmd', text: 'SQL> CONNECT / AS SYSDBA' },
      { kind: 'out', text: 'Connected.' },
    ],
    alert: [
      { level: 'info', text: 'Starting ORACLE instance (normal)' },
      { level: 'info', text: 'Completed: ALTER DATABASE OPEN' },
    ],
  };
}

/**
 * 關卡一開始參數檔就和記憶體不一樣（接手時已寫入、尚未重啟）。
 * @param comment 終端機上的中文註解
 * @param alertText alert log 的英文警告
 * @returns 一列註解與一列警告
 */
export function pendingTranscript(comment: string, alertText: string): Transcript {
  return {
    term: [{ kind: 'cmd', text: `SQL> -- ${comment}` }],
    alert: [{ level: 'warn', text: alertText }],
  };
}

/**
 * 參數被 Oracle 拒絕、沒有寫入時的回應。
 * @param err 畫面上的錯誤原文（通常已含 ORA 代號）
 * @returns 終端機與 alert 各一列
 */
export function rejectTranscript(err: string): Transcript {
  return {
    term: [{ kind: 'out', text: err }],
    alert: [{ level: 'crit', text: err }],
  };
}

/**
 * 一次成功的參數變更。
 * 實驗室才有的開關（ASMM、節點數、服務分流、保留小時）改寫成最接近的真實指令。
 * @param p 參數定義
 * @param v 新值
 * @param scope 這次實際寫入的範圍
 * @param mem 寫入後的執行中組態（ASMM 註解要讀 SGA_TARGET）
 * @param previous 這個鍵寫入前的值（節點數用來判斷啟動或停止）
 * @returns 指令、回應與 alert
 */
export function changeTranscript(
  p: ParamDef,
  v: string | number,
  scope: Scope,
  mem: Config,
  previous: string | number,
): Transcript {
  const term: TermDraft[] = [];
  if (p.k === 'asmm') {
    // 真實環境沒有獨立 ASMM 參數；開關只是同步顯示，真正指令是 SGA_TARGET
    const size = `${compact(Math.max(Number(mem.sga_target), 0))}G`;
    term.push(
      {
        kind: 'cmd',
        text: v === 'ON'
          ? `SQL> -- 開啟 ASMM ≡ ALTER SYSTEM SET sga_target=${size}（>0）`
          : 'SQL> -- 關閉 ASMM ≡ ALTER SYSTEM SET sga_target=0（改手動分配各區塊）',
      },
      { kind: 'out', text: 'System altered.' },
      {
        kind: 'note',
        upto: 'mid',
        text: '實驗室會自動同步 ASMM 開關與 SGA_TARGET，避免兩個值互相打架。',
      },
    );
  } else if (p.k === 'sga_target') {
    const bytesOrG = Number(v) === 0 ? '0' : `${compact(Number(v))}G`;
    term.push(
      { kind: 'cmd', text: `SQL> ALTER SYSTEM SET sga_target=${bytesOrG} SCOPE=${scope};` },
      { kind: 'out', text: 'System altered.' },
      {
        kind: 'note',
        upto: 'mid',
        text: Number(v) > 0
          ? 'SGA_TARGET>0 會啟用 ASMM，系統自動分配共用池與資料快取。'
          : 'SGA_TARGET=0 會關閉 ASMM，改成你手動指定 SHARED_POOL_SIZE、DB_CACHE_SIZE 等。',
      },
    );
  } else if (p.k === 'archivelog') {
    const stmt = v === 'ARCHIVELOG' ? 'ALTER DATABASE ARCHIVELOG' : 'ALTER DATABASE NOARCHIVELOG';
    term.push(
      { kind: 'cmd', text: `SQL> -- 先寫入 SPFILE，MOUNT 之後才執行 ${stmt}` },
      { kind: 'out', text: 'System altered.' },
      { kind: 'note', upto: 'mid', text: 'OPEN 狀態不能切換歸檔模式，所以現在只記入參數檔。' },
    );
  } else if (p.k === 'rac_nodes') {
    const rising = Number(v) >= Number(previous);
    term.push(
      { kind: 'cmd', text: `SQL> -- srvctl ${rising ? 'start' : 'stop'} instance -db orcl （節點數改為 ${v}）` },
      { kind: 'out', text: rising ? 'Instance start requested.' : 'Instance stop requested.' },
      { kind: 'note', upto: 'mid', text: '節點數不是 init 參數。真實環境用 srvctl 啟動或停止執行個體。' },
    );
  } else if (p.k === 'svc_route') {
    term.push(
      { kind: 'cmd', text: `SQL> -- service APP routing = ${v}（新連線才套用）` },
      { kind: 'out', text: 'Service modified.' },
      { kind: 'note', upto: 'mid', text: '連線分流是服務的屬性。只有新建立的連線會改走新的節點。' },
    );
  } else if (p.k === 'arch_keep') {
    term.push(
      { kind: 'cmd', text: `RMAN> CONFIGURE ARCHIVELOG DELETION POLICY TO BACKED UP 1 TIMES TO DISK; -- 保留 ${v} 小時` },
      { kind: 'out', text: 'new RMAN configuration parameters are successfully stored' },
      { kind: 'note', upto: 'mid', text: '真實的刪除策略是依備份次數或時間，不是一個 init 參數。實驗室用小時代表它有多緊。' },
    );
  } else if (p.k === 'log_buffer') {
    const bytes = Math.round(Number(v) * 1048576);
    term.push(
      { kind: 'cmd', text: `SQL> ALTER SYSTEM SET log_buffer=${bytes} SCOPE=${scope}; -- ${compact(Number(v))} MB` },
      { kind: 'out', text: 'System altered.' },
    );
  } else if (p.k === 'sort_area_size') {
    const bytes = Math.round(Number(v) * 1024);
    term.push(
      { kind: 'cmd', text: `SQL> ALTER SYSTEM SET sort_area_size=${bytes} SCOPE=${scope}; -- ${compact(Number(v))} KB` },
      { kind: 'out', text: 'System altered.' },
      { kind: 'note', upto: 'mid', text: '現代環境多半改 PGA_AGGREGATE_TARGET。SORT_AREA_SIZE 是舊的手動 PGA 參數。' },
    );
  } else if (p.k === 'db_block_size') {
    term.push(
      { kind: 'cmd', text: `SQL> -- DB_BLOCK_SIZE=${v} 在建庫時決定，無法用 ALTER SYSTEM 修改` },
      { kind: 'out', text: 'ORA-02095: specified initialization parameter cannot be modified' },
    );
  } else {
    term.push(
      { kind: 'cmd', text: `SQL> ALTER SYSTEM SET ${oracleName(p)}=${sqlLiteral(p, v)} SCOPE=${scope};` },
      { kind: 'out', text: 'System altered.' },
    );
  }
  term.push(...scopeNotes(p, scope, v, mem));
  return { term, alert: alertFrom(term) };
}

/**
 * SHUTDOWN IMMEDIATE。dismounted 就是卸載（unmount）。
 * @returns 關閉指令與 alert
 */
export function shutdownTranscript(): Transcript {
  return {
    term: [
      { kind: 'cmd', text: 'SQL> SHUTDOWN IMMEDIATE' },
      { kind: 'out', text: 'Database closed.' },
      { kind: 'out', text: 'Database dismounted.' },
      { kind: 'note', upto: 'mid', text: 'Database dismounted 就是卸載（unmount）。等一下的 ALTER DATABASE MOUNT 會再把資料庫掛上。' },
      { kind: 'out', text: 'ORACLE instance shut down.' },
    ],
    alert: [
      { level: 'info', text: 'Shutting down instance (immediate)' },
      { level: 'info', text: 'Database closed' },
      { level: 'info', text: 'Database dismounted' },
      { level: 'info', text: 'Instance shutdown complete' },
    ],
  };
}

/**
 * STARTUP NOMOUNT。真實的 STARTUP 會一路做到 OPEN，這裡拆開是為了對照步驟。
 * @returns 啟動到 NOMOUNT
 */
export function nomountTranscript(): Transcript {
  return {
    term: [
      { kind: 'cmd', text: 'SQL> STARTUP NOMOUNT' },
      { kind: 'note', upto: 'mid', text: '真實環境打 STARTUP 會一路做到 OPEN。這裡拆開，是為了讓你看到 NOMOUNT、MOUNT、OPEN。' },
      { kind: 'out', text: 'ORACLE instance started.' },
    ],
    alert: [{ level: 'info', text: 'Starting ORACLE instance (normal)' }],
  };
}

/**
 * ALTER DATABASE MOUNT。
 * @returns 掛載指令
 */
export function mountTranscript(): Transcript {
  return {
    term: [
      { kind: 'cmd', text: 'SQL> ALTER DATABASE MOUNT;' },
      { kind: 'out', text: 'Database mounted.' },
    ],
    alert: [
      { level: 'info', text: 'ALTER DATABASE MOUNT' },
      { level: 'info', text: 'Completed: ALTER DATABASE MOUNT' },
    ],
  };
}

/**
 * 從 MOUNT 到 OPEN。歸檔模式若有切換，會插在 OPEN 之前。
 * @param opts.archive 這次要切換的新模式；沒有切換則為 null
 * @param opts.clusterNodes 叢集節點數；單一執行個體為 null
 * @returns OPEN（以及必要的 ALTER DATABASE ARCHIVELOG）
 */
export function openTranscript(opts: { archive: string | null; clusterNodes: number | null }): Transcript {
  const term: TermDraft[] = [];
  const alert: Transcript['alert'] = [];
  if (opts.archive) {
    const stmt = opts.archive === 'ARCHIVELOG' ? 'ALTER DATABASE ARCHIVELOG' : 'ALTER DATABASE NOARCHIVELOG';
    term.push(
      { kind: 'cmd', text: `SQL> ${stmt};` },
      { kind: 'out', text: 'Database altered.' },
      { kind: 'note', upto: 'mid', text: '歸檔模式只能在已經 MOUNT、還沒 OPEN 的時候切換。' },
    );
    alert.push({ level: 'info', text: stmt }, { level: 'info', text: `Completed: ${stmt}` });
  }
  term.push(
    { kind: 'cmd', text: 'SQL> ALTER DATABASE OPEN;' },
    { kind: 'out', text: 'Database opened.' },
  );
  alert.push(
    { level: 'info', text: 'ALTER DATABASE OPEN' },
    { level: 'info', text: 'Completed: ALTER DATABASE OPEN' },
  );
  if (opts.clusterNodes) {
    term.push({ kind: 'out', text: `Cluster started, ${opts.clusterNodes} instances.` });
    alert.push({ level: 'info', text: `Cluster started, ${opts.clusterNodes} instances` });
  }
  return { term, alert };
}

/**
 * 啟動檢查失敗。訊息裡若已有 ORA 代號就沿用，否則補上 ORA-27102。
 * @param msg 啟動檢查的說明
 * @returns 失敗輸出
 */
export function failTranscript(msg: string): Transcript {
  const hasOra = /ORA-\d{5}/.test(msg);
  const lines = hasOra ? [msg] : ['ORA-27102: out of memory', msg];
  return {
    term: lines.map((text) => ({ kind: 'out' as const, text })),
    alert: lines.map((text) => ({ level: 'crit' as const, text })),
  };
}

/**
 * 啟動失敗後再試。useBackup 時改讀文字檔，不讀目前的 SPFILE。
 * @param useBackup true 表示 STARTUP PFILE
 * @returns 啟動指令
 */
export function retryTranscript(useBackup: boolean): Transcript {
  if (useBackup) {
    return {
      term: [
        { kind: 'cmd', text: "SQL> STARTUP PFILE='init_lastgood.ora'" },
        { kind: 'note', upto: 'mid', text: 'PFILE 是文字備份。這行不讀目前的 SPFILE，所以剛才寫壞的參數不會被帶起來。' },
        { kind: 'out', text: 'ORACLE instance started.' },
      ],
      alert: [{ level: 'info', text: 'Starting ORACLE instance (PFILE=init_lastgood.ora)' }],
    };
  }
  return {
    term: [
      { kind: 'cmd', text: 'SQL> STARTUP' },
      { kind: 'note', upto: 'mid', text: '接著仍會看到 MOUNT 和 OPEN，用來對照啟動步驟。' },
      { kind: 'out', text: 'ORACLE instance started.' },
    ],
    alert: [{ level: 'info', text: 'Starting ORACLE instance (normal)' }],
  };
}

/**
 * 手動備份並刪除歸檔。只是暫時清空間。
 * @returns RMAN 指令
 */
export function backupTranscript(): Transcript {
  return {
    term: [
      { kind: 'cmd', text: 'RMAN> BACKUP ARCHIVELOG ALL DELETE INPUT;' },
      { kind: 'out', text: 'backup piece complete, archived logs deleted' },
      { kind: 'note', upto: 'mid', text: '這只是暫時把快速復原區清出來。保留策略沒變，日誌還是會再堆滿。' },
    ],
    alert: [{ level: 'info', text: 'RMAN: archived logs backed up and deleted' }],
  };
}

/**
 * 症狀旗標變成錯誤時要寫進 alert log 的一行。
 * 沒有對應 ORA 的項目用 WARNING，不捏造代號。
 * @param key 旗標鍵
 * @param mem 執行中組態（ORA-00020 要帶 processes 上限）
 * @returns 一列 alert；沒有對應訊息時回傳 null
 */
export function flagAlert(key: string, mem: Config): { level: LogLevel; text: string } | null {
  switch (key) {
    case 'conn':
      return { level: 'crit', text: `ORA-00020: maximum number of processes (${mem.processes}) exceeded` };
    case 'cur':
      return { level: 'crit', text: 'ORA-01000: maximum open cursors exceeded' };
    case 'snap':
      return { level: 'crit', text: 'ORA-01555: snapshot too old: rollback segment number too small' };
    case 'undo':
      return { level: 'crit', text: "ORA-30036: unable to extend segment by 8 in undo tablespace 'UNDOTBS1'" };
    case 'shared':
      return { level: 'crit', text: 'ORA-04031: unable to allocate bytes in the shared pool' };
    case 'arch':
      return { level: 'crit', text: 'ORA-00257: archiver error. Connect internal only, until freed.' };
    case 'swap':
      return { level: 'warn', text: 'WARNING: heavy swapping detected, SGA and PGA exceed physical memory' };
    case 'spill':
      return { level: 'warn', text: 'WARNING: sort operations spilling to temporary tablespace' };
    case 'archwait':
      return { level: 'warn', text: 'WARNING: log file switch (archiving needed), archiver is behind' };
    default:
      return null;
  }
}

/**
 * 快速復原區使用率超過八成。
 * @param pct 使用百分比（0–100）
 * @returns 警告一列
 */
export function fraWarn(pct: number): { level: LogLevel; text: string } {
  return { level: 'warn', text: `WARNING: db_recovery_file_dest_size is ${Math.round(pct)}% used` };
}

/**
 * 節點故障的 alert。單一執行個體直接中斷服務。
 * @param outage 是否整站中斷
 * @param alive 還活著的節點數
 * @returns 一列 alert
 */
export function nodeFailAlert(outage: boolean, alive: number): { level: LogLevel; text: string } {
  if (outage) return { level: 'crit', text: 'Instance down: single-instance outage, service unavailable' };
  return { level: 'warn', text: `Node failure: ${alive} instance(s) still accepting connections` };
}

/**
 * 節點恢復的 alert。
 * @param outage 恢復前是否為整站中斷
 * @returns 一列 alert
 */
export function nodeBackAlert(outage: boolean): { level: LogLevel; text: string } {
  if (outage) return { level: 'ok', text: 'Instance recovered, service available' };
  return { level: 'ok', text: 'Failed node rejoined the cluster' };
}
