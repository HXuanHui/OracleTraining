/**
 * 關卡情境：入門（單參數）→ 進階（複合）→ 專家 → 總驗收 → 大魔王。
 * 入門只放大一個瓶頸；進階起必須同時處理多個病因。
 */
import type { Config, Scenario, Workload } from '../model/types';

/** 工作負載共用預設值（各關會覆寫部分欄位） */
export const baseW: Omit<Workload, 'ram' | 'cores' | 'users' | 'workingSet'> & Partial<Workload> = {
  think: 1, literal: 0.1, hotCursors: 50, cursorsNeed: 200, cpuBase: 3, hardCost: 9, lio: 12,
  sortMB: 1, sortActive: 0.1, scanMB: 0, reportShare: 0.1, redoMBps: 0.5, commitW: 5,
  writeMBps: 4, writeW: 10, batchMs: 0, sharedNeed: 0.6, undoMBps: 0, undoSpace: 0, reportScale: 0,
  shareFrac: 0.3, gcCost: 6, archW: 12,
};

/** 參數組態共用預設值（含專家層才看得到的對照參數） */
export const baseCfg: Config = {
  sga_max_size: 4, sga_target: 2, pga: 1,
  large_pool_size: 0.25, java_pool_size: 0.05,
  memory_target: 0, memory_max_target: 0,
  pre_page_sga: 'FALSE', lock_sga: 'FALSE',
  processes: 150, sessions: 247, open_cursors: 300, session_cached_cursors: 20,
  cursor_sharing: 'EXACT', optimizer_mode: 'ALL_ROWS', mbrc: 16,
  sort_area_size: 512, db_block_size: '8192',
  log_buffer: 8, dbwr: 1, fast_start_mttr_target: 0,
  pms: 8, undo_retention: 900, deferred_segment_creation: 'TRUE',
  asmm: 'ON', shared_pool_size: 0.25, db_cache_size: 0.5,
  archivelog: 'NOARCHIVELOG', fra_size: 50, arch_keep: 8, arch_procs: 4,
  cluster_db: 'FALSE', rac_nodes: 1, svc_route: 'ANY', parallel_force_local: 'FALSE',
  db_files: 200, job_queue_processes: 4, timed_statistics: 'TRUE',
  compatible: '19.0.0', audit_trail: 'DB',
};

/**
 * 入門關用的「其餘資源夠用」組態，避免第二個瓶頸干擾單參數教學。
 * 各關只覆寫本關要教壞的那一項。
 * 共用池／快取維持小的最小保證值，避免 ASMM 下地板總和超過較小的 SGA_TARGET（ORA-00824）。
 */
const roomy: Config = {
  ...baseCfg,
  sga_max_size: 12, sga_target: 8, pga: 4,
  processes: 500, sessions: 772, open_cursors: 500, session_cached_cursors: 50,
  cursor_sharing: 'EXACT', optimizer_mode: 'ALL_ROWS', mbrc: 64,
  log_buffer: 32, dbwr: 2, pms: 16, undo_retention: 1800,
  // 最小保證值須遠小於各關可能設的 SGA_TARGET（例如 i02 的 1.5 GB）
  shared_pool_size: 0.25, db_cache_size: 0.5,
};

/** 依難度排序後的情境清單 */
export const SCENARIOS: Scenario[] = (() => {
  const list: Scenario[] = [
    // ========== 入門：單參數教室 ==========
    {
      id: 'i01', tag: '入門', title: '連線被拒', maxRestarts: 1,
      focus: ['processes'],
      story: '早上 220 人同時打卡，系統沿用上線時的連線上限。有人進得去，有人一直連不上。其他資源都夠，問題只出在「能進來幾個人」。',
      goal: { lat: 12, latUnit: 'ms' },
      why: {
        lat: '人進得來之後，這台機器回應本來就不慢；延遲當護欄即可。',
      },
      w: { ...baseW, ram: 16, cores: 4, users: 220, workingSet: 2 } as Workload,
      // sessions 沿用 roomy（夠大），避免只調 PROCESSES 時被 SESSIONS 卡住
      cfg: { ...roomy, sga_max_size: 6, sga_target: 4, pga: 2, processes: 150 },
      observe: [
        { label: '同時上線人數', source: 'V$SESSION', view: 'session', calc: 'PROCESSES ≥ 使用者 + 背景≈40' },
        { label: 'processes 使用量', source: 'V$RESOURCE_LIMIT', view: 'resource', calc: '頂滿就會拒連' },
      ],
      hints: [
        '先看每秒交易數的連線數與 V$RESOURCE_LIMIT：PROCESSES 滿了就會拒連。',
        '220 人連線大約要 PROCESSES ≥ 260（系統背景約佔 40）。寫進參數檔後重啟一次。',
      ],
      lessons: [
        'PROCESSES 是同時能進來的上限，系統自己還要佔大約 40 個。',
        '需重啟的參數只能寫進參數檔，重啟後才生效。',
      ],
    },
    {
      id: 'i02', tag: '入門', title: '快取放不下', maxRestarts: 0,
      focus: ['sga_target'],
      story: '熱資料大約 5 GB，但 SGA 目前只有 1.5 GB。大家都連得上，就是查詢偏慢。上限還有空間，不必重啟。',
      goal: { lat: 8, latUnit: 'ms' },
      why: {
        lat: '熱資料放進快取後，這台機器大約 8 毫秒內做得到；現在慢是因為一直去磁碟。',
      },
      w: { ...baseW, ram: 32, cores: 4, users: 80, workingSet: 5, lio: 40 } as Workload,
      cfg: { ...roomy, sga_max_size: 10, sga_target: 1.5, pga: 2, processes: 300, sessions: 472 },
      observe: [
        { label: '熱資料量', source: '業務／工作集', calc: 'SGA 至少要蓋住熱資料' },
        { label: '實體記憶體 RAM', source: 'V$OSSTAT', view: 'osstat', calc: 'SGA + PGA 勿吃光 RAM' },
        { label: '快取命中率', source: 'V$SYSMETRIC', view: 'sysmetric' },
      ],
      hints: [
        '看命中率與「單區塊讀取」等待：快取太小。',
        'SGA_TARGET 在上限以內可以即時調大，不用重啟。',
      ],
      lessons: [
        'SGA_TARGET 是目前大小，上限內可即時調整。',
        '熱資料放不下時，延遲會先壞在實體讀取，不是連線數。',
      ],
    },
    {
      id: 'i03', tag: '入門', title: '排序溢寫磁碟', maxRestarts: 0,
      focus: ['pga'],
      story: '少數人在跑需要大量排序的查詢。PGA 太小，排序溢寫到磁碟，等待事件裡「臨時段」很大。把 PGA 調夠即可。',
      goal: { lat: 40, latUnit: 'ms' },
      why: {
        lat: '排序還在記憶體裡完成時，大約數十毫秒；溢寫磁碟會拖到很慢。',
      },
      w: {
        ...baseW, ram: 32, cores: 4, users: 30, think: 2, workingSet: 3,
        sortMB: 600, sortActive: 0.7, cpuBase: 8, lio: 20,
      } as Workload,
      cfg: { ...roomy, sga_max_size: 8, sga_target: 4, pga: 0.5, processes: 200, sessions: 322 },
      observe: [
        { label: '同時排序需求', source: 'V$PGASTAT', view: 'pgastat', calc: '人數 × 單次排序量' },
        { label: '實體記憶體 RAM', source: 'V$OSSTAT', view: 'osstat', calc: 'SGA + PGA < RAM × 約 80%' },
        { label: '臨時段等待', source: 'V$SYSTEM_EVENT', view: 'event' },
      ],
      hints: [
        '等待事件裡臨時段／排序溢寫很大 → PGA 不夠。',
        'PGA_AGGREGATE_TARGET 即時生效，調大後溢寫會下降。',
      ],
      lessons: [
        'PGA 不夠時排序會溢寫磁碟，那是很貴的一種慢。',
        '現代環境用 PGA_AGGREGATE_TARGET，不要再依賴舊的 SORT_AREA_SIZE。',
      ],
    },
    {
      id: 'i04', tag: '入門', title: '游標開爆', maxRestarts: 0,
      focus: ['open_cursors'],
      story: '應用一次開很多游標卻沒關。每個連線的游標上限太低，開始出現 ORA-01000。只要把上限調高就能過關。',
      goal: { lat: 15, latUnit: 'ms' },
      why: {
        lat: '延遲不是重點；游標錯誤才是。',
      },
      w: {
        ...baseW, ram: 16, cores: 4, users: 100, workingSet: 2, cursorsNeed: 450,
      } as Workload,
      cfg: { ...roomy, sga_max_size: 6, sga_target: 4, pga: 2, processes: 300, sessions: 472, open_cursors: 100 },
      observe: [
        { label: '應用同時開游標', source: 'V$OPEN_CURSOR', view: 'open_cursor', calc: '上限 ≥ 應用實際同時開的數量' },
        { label: 'Alert 錯誤', source: 'Alert Log', view: 'alert', calc: 'ORA-01000' },
      ],
      hints: [
        '看 Alert Log：ORA-01000 代表 OPEN_CURSORS 不夠。',
        'OPEN_CURSORS 可即時調高；它和 SESSION_CACHED_CURSORS 是兩回事。',
      ],
      lessons: [
        'OPEN_CURSORS 是每個連線同時能開的游標上限。',
        '不夠會直接報錯，不是變慢而已。',
      ],
    },
    {
      id: 'i05', tag: '入門', title: '新連線才變快', maxRestarts: 0,
      focus: ['session_cached_cursors'],
      story: '同一批 SQL 反覆執行，但每個連線幾乎不快取已關閉的游標，軟解析偏多。這個參數只對新連線生效，套用後稍等幾秒讓連線換新。',
      goal: { lat: 10, latUnit: 'ms' },
      why: {
        lat: '熱門游標被快取後，解析成本下降，延遲會跟著下來。',
      },
      w: {
        ...baseW, ram: 16, cores: 4, users: 120, workingSet: 2,
        literal: 0.05, hotCursors: 80, hardCost: 6, cpuBase: 4,
        // 快取為 0 時軟解析約 15ms，蓋過 10ms 目標；調到涵蓋熱門游標後才會掉到門檻下
        softMs: 11,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 6, sga_target: 4, pga: 2,
        processes: 300, sessions: 472, session_cached_cursors: 0,
      },
      observe: [
        { label: '熱門游標數', source: 'V$SYSSTAT', view: 'sysstat', calc: '快取宜涵蓋熱門游標' },
        { label: '硬解析／秒', source: 'V$SYSMETRIC', view: 'sysmetric' },
      ],
      hints: [
        'CPU／解析偏高，但字面值比例不高 → 看連線游標快取。',
        'SESSION_CACHED_CURSORS 是「新連線生效」。套用後等幾秒，舊連線陸續換新才看得到效果。',
      ],
      lessons: [
        'deferred 參數不會立刻改變舊連線，要等新連線。',
        '建議小於 OPEN_CURSORS，並考量共用池大小。',
      ],
    },
    {
      id: 'i06', tag: '入門', title: '字面值 SQL 海', maxRestarts: 0,
      focus: ['cursor_sharing'],
      story: '商品頁把編號寫死在 SQL 裡，每一句都像新語句，CPU 被硬解析吃光。切換 SQL 共用模式就能立刻止血。',
      goal: { lat: 12, latUnit: 'ms' },
      why: {
        lat: '這一關慢是因為硬解析，不是磁碟；切到 FORCE 後延遲應明顯下降。',
      },
      w: {
        ...baseW, ram: 32, cores: 8, users: 400, workingSet: 4,
        // EXACT 時硬解析把延遲頂到約 22–31ms；切成 FORCE 才掉到約 4ms，低於 12ms 目標
        literal: 0.85, hardCost: 16, cpuBase: 2.5, sharedNeed: 1.5,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 10, sga_target: 8, pga: 2,
        processes: 600, sessions: 922, cursor_sharing: 'EXACT',
      },
      observe: [
        { label: '硬解析／秒', source: 'V$SYSSTAT', view: 'sysstat', calc: '字面值比例高 → 考慮 FORCE 止血' },
        { label: 'CPU 等待佔比', source: 'V$SYSTEM_EVENT', view: 'event' },
      ],
      hints: [
        '等待事件：CPU／解析佔大宗。',
        'CURSOR_SHARING 可即時切到 FORCE，不用重啟。',
      ],
      lessons: [
        'FORCE 把常數綁成變數，立刻降低硬解析。',
        '這是止血；長期仍應改用綁定變數。',
      ],
    },
    {
      id: 'i07', tag: '入門', title: '報表還是線上？', maxRestarts: 0,
      focus: ['optimizer_mode'],
      story: '整批報表卻設成「先回前幾筆」。執行計畫偏向線上互動，報表步驟反而變慢。改成整體最快即可。',
      goal: { lat: 80, latUnit: 'ms' },
      why: {
        lat: '報表步驟在 ALL_ROWS 下會快一截；FIRST_ROWS 適合點選畫面，不適合整批。',
      },
      w: {
        ...baseW, ram: 32, cores: 4, users: 20, think: 3, workingSet: 8,
        reportShare: 0.95, cpuBase: 15, lio: 80, scanMB: 100,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 10, sga_target: 6, pga: 3,
        processes: 200, sessions: 322, optimizer_mode: 'FIRST_ROWS_10', mbrc: 64,
      },
      observe: [
        { label: '回應時間（報表步驟）', source: 'V$SYSMETRIC', view: 'sysmetric', calc: '整批報表用 ALL_ROWS' },
        { label: '等待組成', source: 'V$SYSTEM_EVENT', view: 'event' },
      ],
      hints: [
        '報表佔比很高，卻用 FIRST_ROWS_10。',
        '改成 ALL_ROWS 即時生效，整批會比較快。',
      ],
      lessons: [
        '優化器偏好要配合負載：報表用 ALL_ROWS，線上互動才考慮 FIRST_ROWS。',
      ],
    },
    {
      id: 'i08', tag: '入門', title: '全表掃描太碎', maxRestarts: 0,
      focus: ['mbrc'],
      story: '報表在做大表掃描，但一次只讀很少區塊，磁碟讀取被切得很碎。把一次讀取區塊數調高即可。',
      goal: { lat: 60, latUnit: 'ms' },
      why: {
        lat: '掃描 I/O 變有效率後，步驟時間會下來；大約 128 以後效益就變薄。',
      },
      w: {
        ...baseW, ram: 32, cores: 4, users: 15, think: 2, workingSet: 10,
        // 單區塊讀取壓低，避免第二個瓶頸。MBRC=8 約 125ms；調到 112 以上才低於 60ms，128 約 45ms 後不再下降
        scanMB: 220, reportShare: 0.8, cpuBase: 10, lio: 16,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 10, sga_target: 6, pga: 3,
        processes: 200, sessions: 322, mbrc: 8, optimizer_mode: 'ALL_ROWS',
      },
      observe: [
        { label: '分散讀取等待', source: 'V$SYSTEM_EVENT', view: 'event', calc: 'MBRC 約 112～128 即可' },
        { label: '回應時間', source: 'V$SYSMETRIC', view: 'sysmetric' },
      ],
      hints: [
        '等待事件裡「分散讀取／全表掃描」偏大。',
        'DB_FILE_MULTIBLOCK_READ_COUNT 調到 112～128 即可；再高幾乎沒有額外好處。',
      ],
      lessons: [
        '一次讀更多區塊，大表掃描比較不碎。',
        '調太高超過約 128 幾乎沒有額外好處。',
      ],
    },
    {
      id: 'i09', tag: '入門', title: '提交在排隊', maxRestarts: 1,
      focus: ['log_buffer'],
      story: '短交易很多，重做日誌產生很快，但日誌緩衝區太小，提交在排隊。這個參數要重啟才生效。',
      goal: { lat: 15, latUnit: 'ms' },
      why: {
        lat: 'log buffer 等待消掉後，提交不再卡住，延遲會回到可接受範圍。',
      },
      w: {
        ...baseW, ram: 16, cores: 4, users: 150, workingSet: 2,
        redoMBps: 20, commitW: 8, writeMBps: 15,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 6, sga_target: 4, pga: 2,
        processes: 300, sessions: 472, log_buffer: 2, dbwr: 2,
      },
      observe: [
        { label: '重做產生速率', source: '業務負載', calc: '越高越需要夠大的 LOG_BUFFER' },
        { label: 'log buffer 等待', source: 'V$SYSTEM_EVENT', view: 'event' },
      ],
      hints: [
        '等待事件出現 log buffer 相關等待。',
        'LOG_BUFFER 需重啟。改完寫進參數檔再重啟一次。',
      ],
      lessons: [
        '日誌緩衝太小會讓提交排隊。',
        'LOG_BUFFER 是需重啟參數，改完要重啟才看得到。',
      ],
    },
    {
      id: 'i10', tag: '入門', title: '髒塊寫不完', maxRestarts: 1,
      focus: ['dbwr'],
      story: '寫入尖峰時只有一個資料寫入程序，髒塊寫回跟不上，出現 free buffer 壓力。增加寫入程序數（需重啟）。',
      goal: { lat: 18, latUnit: 'ms' },
      why: {
        lat: '寫回能力跟上後，等 free buffer 的時間會下降。',
      },
      w: {
        ...baseW, ram: 16, cores: 8, users: 120, workingSet: 3,
        writeMBps: 120, writeW: 12, redoMBps: 8,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 6, sga_target: 4, pga: 2,
        processes: 300, sessions: 472, log_buffer: 32, dbwr: 1,
      },
      observe: [
        { label: 'CPU 核心數', source: 'V$OSSTAT', view: 'osstat', calc: 'DBWR 勿超過核心數；經驗 ≈ MAX(1, CPU/8)' },
        { label: '寫入速率', source: '業務負載' },
        { label: 'free buffer 等待', source: 'V$SYSTEM_EVENT', view: 'event' },
      ],
      hints: [
        '等待事件裡 free buffer／寫回壓力大。',
        'DB_WRITER_PROCESSES 需重啟；經驗上可加，但不要超過 CPU 數。',
      ],
      lessons: [
        'DBWR 負責把髒塊寫回磁碟，太少會拖住緩衝取得。',
        '這是需重啟參數，和 LOG_BUFFER 一樣要寫進參數檔。',
      ],
    },
    {
      id: 'i11', tag: '入門', title: '快照太舊', maxRestarts: 0,
      focus: ['undo_retention'],
      story: '長報表跑到一半出現「快照太舊」。不要憑感覺把 UNDO_RETENTION 設成 15 分鐘。先看最長查詢要多久、再對照 Undo 產生速率與表空間，最後才決定保留時間。',
      goal: { lat: 200, latUnit: 'ms' },
      why: {
        lat: '報表步驟時間當護欄；真正要消掉的是 ORA-01555（快照太舊）。',
      },
      w: {
        ...baseW, ram: 32, cores: 4, users: 20, think: 4, workingSet: 8,
        // 報表約 9 分鐘。初始保留 180 秒蓋不住，會一直 ORA-01555；調到 600 秒以上才達標
        reportScale: 20000, undoMBps: 0.4, undoSpace: 5000, cpuBase: 12, lio: 60,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 10, sga_target: 6, pga: 3,
        processes: 200, sessions: 322, undo_retention: 180,
      },
      observe: [
        { label: '最長查詢／報表時間', source: 'V$UNDOSTAT', view: 'undostat', calc: '保留秒數 ≥ MAXQUERYLEN' },
        { label: 'Undo 產生速率', source: 'V$UNDOSTAT', view: 'undostat', calc: '需求 ≈ 保留秒數 × MB/s' },
        { label: 'Undo 表空間', source: 'DBA_DATA_FILES', view: 'undots', calc: '空間不夠會 ORA-30036' },
        { label: '快照太舊次數', source: 'Alert Log', view: 'alert', calc: 'SSOLDERRCNT／ORA-01555' },
      ],
      hints: [
        '順序：最長查詢 → V$UNDOSTAT（MAXQUERYLEN、TUNED_UNDORETENTION、SSOLDERRCNT）→ 表空間 → 再調 UNDO_RETENTION。',
        '拉滑桿時看下方推算：保留 × 每秒 Undo 量，不要超過表空間。這一關空間還夠。',
      ],
      lessons: [
        'UNDO_RETENTION 是期望值；TUNED_UNDORETENTION 才是動態調整後的實際保留。',
        '保留要比最長查詢久，又不能久到把 Undo 空間塞滿。',
      ],
    },
    {
      id: 'i12', tag: '入門', title: '平行沒開', maxRestarts: 0,
      focus: ['pms'],
      story: '夜間批次可以平行拆開跑，但 PARALLEL_MAX_SERVERS 是 0，工作全部單線排隊。把上限開到大約 CPU 的兩倍。',
      goal: { lat: 900, latUnit: 'ms' },
      why: {
        lat: '這是批次步驟時間。平行有拆開時大約能壓到一秒內；單線會停在數秒。',
      },
      w: {
        ...baseW, ram: 32, cores: 8, users: 6, think: 2, workingSet: 10,
        batchMs: 5000, cpuBase: 10, lio: 80, redoMBps: 5, writeMBps: 30,
      } as Workload,
      cfg: {
        ...roomy, sga_max_size: 10, sga_target: 6, pga: 3,
        processes: 200, sessions: 322, pms: 0, large_pool_size: 0.5,
      },
      observe: [
        { label: 'CPU 核心數', source: 'V$OSSTAT', view: 'osstat', calc: '甜蜜點 ≈ 核心數 × 2' },
        { label: '平行等待', source: 'V$SYSTEM_EVENT', view: 'event' },
        { label: '平行從屬', source: 'V$PX_PROCESS', view: 'px_process' },
      ],
      hints: [
        '等待「平行批次」佔大半，且 PARALLEL_MAX_SERVERS = 0。',
        '開到大約核心數 × 2（這台約 16）就夠，再多會搶 CPU。',
      ],
      lessons: [
        '平行度有甜蜜點：大約核心數的兩倍。',
        '開太高不但不快，還會互相搶資源。',
      ],
    },

    // ========== 進階：複合參數 ==========
    {
      id: 'm01', tag: '進階', title: '打卡高峰', maxRestarts: 1,
      focus: ['processes', 'sga_target', 'sga_max_size'],
      story: '每天早上 9 點，260 位員工同時打卡。連線上限不夠，熱資料也放不進快取。要同時處理「進得來」和「進來後夠快」，需重啟的變更集中一次做完。',
      goal: { lat: 7.5, latUnit: 'ms' },
      why: {
        lat: '打卡要覺得按下去立刻有反應；7.5 毫秒是這台 4 核心在快取放得下熱資料時做得到的水準。',
      },
      w: { ...baseW, ram: 16, cores: 4, users: 260, workingSet: 3.5, literal: 0.15 } as Workload,
      cfg: { ...baseCfg },
      hints: [
        '先看連線是否被拒：上限由 PROCESSES 決定，需重啟。',
        '回應偏慢是快取不夠。SGA_TARGET 可即時調，但不能超過 SGA_MAX_SIZE。',
        '把需重啟的改完，其他調好，只重啟一次。',
      ],
      lessons: [
        '複合關要分清：先擋錯誤（連線），再修延遲（快取）。',
        '靜態變更適合集中起來一次重啟。',
      ],
    },
    {
      id: 'm02', tag: '進階', title: '雙十一搶購', maxRestarts: 1,
      focus: ['cursor_sharing', 'processes', 'log_buffer', 'dbwr', 'shared_pool_size'],
      extra: ['shared_pool_size'],
      story: '活動開跑，使用者湧入。SQL 把商品編號寫死在字串裡，硬解析爆量；連線與寫入也同時吃緊。先用即時參數止血，再把需重啟的一次打包。',
      goal: { lat: 15, latUnit: 'ms' },
      why: {
        lat: '搶購頁可稍慢，但超過 15 毫秒結帳會頓。時間多半耗在硬解析與提交／寫回。',
      },
      w: {
        ...baseW, ram: 32, cores: 8, users: 900, workingSet: 8, literal: 0.7, hotCursors: 80, cursorsNeed: 250,
        cpuBase: 2.5, hardCost: 10, lio: 14, redoMBps: 14, writeMBps: 90, sharedNeed: 3,
        curve: (t) => 1 + 0.25 * Math.exp(-Math.pow(((t % 90) - 45) / 14, 2)),
      } as Workload,
      cfg: { ...baseCfg, sga_max_size: 12, sga_target: 10, pga: 2, processes: 400, sessions: 622 },
      hints: [
        '先看 CPU／解析：CURSOR_SHARING 可即時切 FORCE。',
        '連線、日誌緩衝、資料寫入程序都要重啟——一起改再重啟一次。',
        '共用池需求也偏高，必要時調 SHARED_POOL_SIZE 或維持夠大的 SGA。',
      ],
      lessons: [
        '即時參數先止血，靜態參數一次重啟打包。',
        '看等待事件找瓶頸，比憑感覺亂調有效。',
      ],
    },
    {
      id: 'm03', tag: '進階', title: '月底財務報表', maxRestarts: 0,
      focus: ['pga', 'optimizer_mode', 'mbrc', 'undo_retention'],
      story: '財務部同時跑 40 份大型報表：排序溢寫、優化器偏好不對、掃描太碎，還會「快照太舊」。數字請自己到 V$PGASTAT、V$SYSTEM_EVENT、V$UNDOSTAT 與表空間裡找，再決定怎麼調。',
      goal: { lat: 250, latUnit: 'ms' },
      why: {
        lat: '250 毫秒代表排序還在記憶體；拖到秒級通常是溢寫磁碟或掃描太碎。',
      },
      w: {
        ...baseW, ram: 64, cores: 8, users: 40, think: 5, workingSet: 30, literal: 0.05, hotCursors: 30, cursorsNeed: 350,
        cpuBase: 25, lio: 250, sortMB: 800, sortActive: 0.6, scanMB: 300, reportShare: 0.9,
        redoMBps: 1, writeMBps: 6, sharedNeed: 1, undoMBps: 1.5, undoSpace: 4000, reportScale: 2400,
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 16, sga_target: 8, pga: 2, processes: 300, sessions: 472,
        optimizer_mode: 'FIRST_ROWS_10', mbrc: 8, dbwr: 2, undo_retention: 300,
      },
      observe: [
        { label: '最長查詢', source: 'V$UNDOSTAT', view: 'undostat' },
        { label: 'Undo 表空間', source: 'DBA_DATA_FILES', view: 'undots' },
        { label: 'PGA 溢寫', source: 'V$PGASTAT', view: 'pgastat' },
        { label: '核心數', source: 'V$OSSTAT', view: 'osstat' },
      ],
      hints: [
        '先開 V$PGASTAT、V$SYSTEM_EVENT，再開 V$UNDOSTAT：比對 MAXQUERYLEN 與 TUNED_UNDORETENTION。',
        '有 SSOLDERRCNT 再調 UNDO_RETENTION；同時看表空間，別把空間塞滿。',
      ],
      lessons: [
        '報表關常是多個 dynamic 參數一起調。',
        'Undo 保留要比最長報表久，又不能久到把空間塞滿。',
      ],
    },
    {
      id: 'm04', tag: '進階', title: '手動分配 SGA', maxRestarts: 1,
      focus: ['asmm', 'shared_pool_size', 'db_cache_size', 'sga_target', 'sga_max_size'],
      extra: ['asmm', 'shared_pool_size', 'db_cache_size'],
      story: '前任關掉 ASMM，共用池與資料快取各自固定。SQL 變多後出現 ORA-04031，快取也偏小。要想清楚：上限、目前大小、最小保證值各代表什麼。',
      goal: { lat: 10 },
      why: {
        lat: '一般查詢 10 毫秒內使用者不會抱怨。池或快取不夠時會先變壞。',
      },
      w: {
        ...baseW, ram: 32, cores: 8, users: 300, workingSet: 9, literal: 0.5, hotCursors: 80, cursorsNeed: 250,
        hardCost: 3, lio: 60, sharedNeed: 2.5, redoMBps: 1, writeMBps: 8,
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 10, sga_target: 0, asmm: 'OFF', shared_pool_size: 0.5, db_cache_size: 6,
        pga: 3, processes: 400, sessions: 622,
      },
      hints: [
        '共用池只有 0.5 GB 且字面值多 → ORA-04031。',
        '最快：打開 ASMM，把 SGA_TARGET 調到夠大（注意最小保證值）。',
        '要超過目前上限得先調 SGA_MAX_SIZE 並重啟。',
      ],
      lessons: [
        'SGA_MAX_SIZE 是天花板；SGA_TARGET 是目前大小。',
        'ASMM 開啟後，SHARED_POOL_SIZE／DB_CACHE_SIZE 變成最小保證值。',
      ],
    },
    {
      id: 'm05', tag: '進階', title: '歸檔日誌塞爆', maxRestarts: 1,
      focus: ['archivelog', 'fra_size', 'arch_keep', 'arch_procs'],
      extra: ['archivelog', 'fra_size', 'arch_keep', 'arch_procs'],
      story: '稽核要求改成 ARCHIVELOG。開啟後 FRA 很快被塞滿，寫入卡住。要在維持歸檔的前提下，把空間、保留與歸檔程序調順。手動清歸檔只能救急。',
      goal: { lat: 8, archive: true },
      why: {
        lat: '開歸檔後日常交易仍約 8 毫秒。超過通常是歸檔程序或 FRA 拖住提交。',
        archive: '必須維持 ARCHIVELOG，不能為了變快關掉。',
      },
      w: { ...baseW, ram: 32, cores: 8, users: 200, workingSet: 5, redoMBps: 6, writeMBps: 20, sharedNeed: 1 } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 10, sga_target: 8, pga: 2, processes: 350, sessions: 547,
        arch_procs: 1, fra_size: 50, arch_keep: 8, log_buffer: 16, dbwr: 2,
      },
      hints: [
        '歸檔模式要在掛載階段切換，先設好再重啟。',
        'FRA 需求 ≈ 每小時歸檔量 × 保留時數。',
        '空間不夠：加大 FRA 或縮短保留；歸檔程序太少交易會等。',
      ],
      lessons: [
        '切換 ARCHIVELOG 一定要重啟。',
        '手動清歸檔只能救急，要靠保留策略與空間大小。',
      ],
    },
    {
      id: 'm06', tag: '進階', title: '線上與批次混跑', maxRestarts: 0,
      focus: ['pga', 'pms', 'sga_target', 'optimizer_mode'],
      story: '白天線上交易與一批報表／輕量批次同時跑。PGA 不夠讓排序溢寫，平行沒開導致批次拖住，快取也偏緊，優化器還停在 FIRST_ROWS。四個都能即時調，但要一起顧到。',
      goal: { lat: 35, latUnit: 'ms' },
      why: {
        lat: '混跑時 35 毫秒代表線上還能接受、批次也有平行拆開；單一瓶頸沒修完會卡在這裡。',
      },
      w: {
        ...baseW, ram: 48, cores: 8, users: 180, think: 1.5, workingSet: 12,
        sortMB: 400, sortActive: 0.4, batchMs: 2500, reportShare: 0.45,
        cpuBase: 8, lio: 50, scanMB: 80,
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 14, sga_target: 5, pga: 1, processes: 400, sessions: 622,
        optimizer_mode: 'FIRST_ROWS_10', pms: 0, mbrc: 32, large_pool_size: 0.4,
      },
      hints: [
        '同時看：臨時段溢寫、平行等待、命中率、優化器偏好。',
        'PGA、PMS、SGA_TARGET、OPTIMIZER_MODE 都是即時；四個都要夠才過關。',
      ],
      lessons: [
        '同一實例混跑時，線上與批次的設定會互相牽制。',
        '只修其中一個瓶頸通常過不了複合關。',
      ],
    },

    // ========== 專家：複雜組合 ==========
    {
      id: 'x01', tag: '專家', title: '夜間批次 ETL', maxRestarts: 1,
      focus: ['pms', 'pga', 'log_buffer', 'dbwr', 'large_pool_size', 'optimizer_mode'],
      story: '每晚 11 點，8 條批次把當天資料搬進倉儲。寫入量大，平行沒開，大型池也可能不夠。目標是壓低每個批次步驟時間，需重啟的寫入參數一次處理。',
      goal: { lat: 800, latUnit: 'ms' },
      why: {
        lat: '800 毫秒代表平行有拆開；停在數秒就是還在單線或 I/O 卡住。',
      },
      w: {
        ...baseW, ram: 64, cores: 16, users: 8, think: 2, workingSet: 40, literal: 0, hotCursors: 20, cursorsNeed: 150,
        cpuBase: 20, lio: 300, sortMB: 1500, sortActive: 1, scanMB: 600, reportShare: 0.8,
        redoMBps: 60, commitW: 3, writeMBps: 240, writeW: 4, batchMs: 6000, sharedNeed: 0.5,
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 16, sga_target: 12, pga: 4, processes: 300, sessions: 472,
        optimizer_mode: 'FIRST_ROWS_10', log_buffer: 16, dbwr: 2, pms: 0, large_pool_size: 0.1,
      },
      hints: [
        '平行是 0；開到約核心×2，並確認 LARGE_POOL 夠訊息緩衝。',
        '寫入量大：LOG_BUFFER 與 DBWR 需重啟，一次改完。',
        '批次偏好 ALL_ROWS；PGA 也要撐住排序。',
      ],
      lessons: [
        '平行度有甜蜜點，且會吃 LARGE_POOL。',
        '批次與線上的優化器方向常常相反。',
      ],
    },
    {
      id: 'x02', tag: '專家', title: '停電前的重啟', maxRestarts: 1,
      focus: ['sga_max_size', 'processes', 'sessions', 'lock_sga', 'pga'],
      story: '機房今晚停電，資料庫必須重啟。同事把 SGA_MAX_SIZE 改成 20 GB 寫進參數檔但還沒重啟；機器只有 16 GB RAM，晚上還有 400 人要連。重啟前先檢查待生效清單。',
      goal: { lat: 10, latUnit: 'ms' },
      why: {
        lat: '維護後約 400 人立刻上線。10 毫秒是健康線上水準；剛啟動要等預熱。',
      },
      w: { ...baseW, ram: 16, cores: 4, users: 400, workingSet: 5, literal: 0.2, redoMBps: 0.8, writeMBps: 10, sharedNeed: 1 } as Workload,
      cfg: { ...baseCfg, sga_max_size: 6, sga_target: 4 },
      spfileDiff: { sga_max_size: 20 },
      hints: [
        '看「重啟後將生效」：參數檔有一項數字不合理。',
        'SGA_MAX_SIZE + PGA 必須小於 RAM。開不起來可用備份參數檔。',
        '連線數也要一次顧到，避免重啟兩次。',
      ],
      lessons: [
        '寫進參數檔的靜態變更會躺到下次重啟才發作。',
        'PFILE 備份是啟動失敗時的退路。',
      ],
    },
    {
      id: 'x03', tag: '專家', title: '節點當機也不能停', maxRestarts: 1, need: 60,
      focus: ['cluster_db', 'rac_nodes', 'svc_route', 'processes', 'parallel_force_local'],
      extra: ['cluster_db', 'rac_nodes', 'svc_route'],
      story: '要求任一伺服器壞掉服務也不能中斷。現在是單實例，每分鐘會有一次節點故障。授權最多三節點。啟用 RAC，並確保 N-1 仍撐得住，連續達標 60 秒。',
      goal: { lat: 18, maxNodes: 3 },
      why: {
        lat: '量的是壞一台之後仍可接受的速度，所以放到 18 毫秒。',
        nodes: '授權最多三節點。容量看少一個之後還剩多少。',
      },
      w: {
        ...baseW, ram: 32, cores: 8, users: 500, workingSet: 6, literal: 0.1, cpuBase: 14, sharedNeed: 1.2, redoMBps: 2, writeMBps: 20,
        shareFrac: 0.35, gcCost: 6, failure: { every: 60, at: 30, dur: 15 },
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 10, sga_target: 8, pga: 2, processes: 200, sessions: 322,
        log_buffer: 16, dbwr: 2,
      },
      hints: [
        'CLUSTER_DATABASE 要重啟；節點數在啟用後才有作用。',
        'PROCESSES 是每節點一份；用 N-1 算容量。',
        '兩節點壞一個剩一個通常撐不住；三節點壞一個剩兩個。服務分流可減少 GC。',
      ],
      lessons: [
        'RAC 容量規劃看 N-1，不是全部健康時。',
        '服務分流能大幅減少節點間傳塊。',
      ],
    },
    {
      id: 'x04', tag: '專家', title: '歸檔尖峰寫入', maxRestarts: 1,
      focus: ['fra_size', 'arch_keep', 'arch_procs', 'log_buffer', 'dbwr', 'processes'],
      extra: ['archivelog', 'fra_size', 'arch_keep', 'arch_procs'],
      story: '歸檔早已開啟，夜間出現寫入尖峰：FRA 空間與保留策略算不過，歸檔程序跟不上，日誌緩衝與 DBWR 也偏緊，連線在尖峰邊緣。不能關歸檔，只能把空間與寫入鏈調順。',
      goal: { lat: 12, archive: true },
      why: {
        lat: '歸檔開啟下的尖峰交易，12 毫秒內應可完成；被 FRA 或 log／DBWR 拖住會超標。',
        archive: '歸檔是既定條件，關掉不算過關。',
      },
      w: {
        ...baseW, ram: 48, cores: 8, users: 450, workingSet: 8,
        redoMBps: 18, writeMBps: 100, sharedNeed: 1.5, commitW: 6, writeW: 8,
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 14, sga_target: 10, pga: 3, processes: 280, sessions: 442,
        archivelog: 'ARCHIVELOG', arch_procs: 1, fra_size: 40, arch_keep: 16,
        log_buffer: 8, dbwr: 1,
      },
      hints: [
        '先算 FRA：量 × 保留。歸檔程序吞吐量約每程序 4 MB/s。',
        'LOG_BUFFER／DBWR／PROCESSES 需重啟的一次改完。',
        '目標要求維持 ARCHIVELOG。',
      ],
      lessons: [
        '歸檔不是開關題，是空間與吞吐的容量題。',
        '寫入鏈：redo → log buffer → archiver → FRA，任一環節都能拖住提交。',
      ],
    },

    // ========== 總驗收 ==========
    {
      id: 'f01', tag: '總驗收', title: '上線前總驗收', maxRestarts: 1, need: 70,
      focus: ['archivelog', 'cluster_db', 'rac_nodes', 'processes', 'asmm', 'fra_size', 'shared_pool_size'],
      extra: ['asmm', 'shared_pool_size', 'db_cache_size', 'archivelog', 'fra_size', 'arch_keep', 'arch_procs', 'cluster_db', 'rac_nodes', 'svc_route'],
      story: '新訂單系統下週上線。需求：必須歸檔、至少兩節點、尖峰不能掛。接手設定有多處問題，多數要重啟。想清楚再動手，一次重啟處理好。連續達標 70 秒，期間會有一次節點故障。',
      goal: { lat: 16, archive: true, minNodes: 2, maxNodes: 3 },
      why: {
        lat: '上線尖峰互動交易上限 16 毫秒，故障當下也要守住。',
        archive: '訂單必須能還原到任意時間點。',
        nodes: '至少兩節點才有切換；授權最多三個。',
      },
      w: {
        ...baseW, ram: 48, cores: 8, users: 700, workingSet: 12, literal: 0.5, hardCost: 8, cpuBase: 10, lio: 30, hotCursors: 80, cursorsNeed: 250,
        sharedNeed: 4, redoMBps: 5, writeMBps: 40, shareFrac: 0.3, gcCost: 6, failure: { every: 70, at: 35, dur: 12 },
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 14, sga_target: 0, asmm: 'OFF', shared_pool_size: 0.75, db_cache_size: 8,
        pga: 3, processes: 200, sessions: 322, arch_procs: 1, fra_size: 60, arch_keep: 12, log_buffer: 8, dbwr: 1,
      },
      hints: [
        '要重啟：歸檔、叢集、連線、日誌緩衝、DBWR。先全部寫好再重啟。',
        '共用池太小：打開 ASMM 或調大它（即時）。',
        '算 FRA；節點壞一個後，剩下的也要撐住 CPU 與連線。',
      ],
      lessons: [
        '變更分成：重啟時一次處理的，以及上線後可微調的。',
        'N-1 容量、空間公式、共用池夠用是三種不同規劃。',
      ],
    },

    // ========== 大魔王：無票據 ==========
    {
      id: 'boss', tag: '大魔王', title: '無票據', maxRestarts: 1, need: 90, silent: true,
      story: '',
      goal: { lat: 14, archive: true, minNodes: 2, maxNodes: 3 },
      why: { lat: '', archive: '', nodes: '' },
      hints: [],
      lessons: [
        '現場常沒有完整事故說明，只能從等待、Alert、參數現況反推。',
        '多瓶頸時先分：連不上、解析／共用池、寫入鏈、FRA 空間、叢集 N-1。',
        '需重啟的變更要在重啟前寫進參數檔，並檢查待生效清單是否會讓實例起不來。',
      ],
      w: {
        ...baseW, ram: 48, cores: 8, users: 720, workingSet: 11,
        literal: 0.55, hardCost: 9, cpuBase: 11, lio: 35, hotCursors: 90, cursorsNeed: 280,
        sharedNeed: 3.5, redoMBps: 12, writeMBps: 80, commitW: 5, writeW: 8,
        shareFrac: 0.32, gcCost: 6, failure: { every: 90, at: 40, dur: 14 },
      } as Workload,
      cfg: {
        ...baseCfg, sga_max_size: 14, sga_target: 0, asmm: 'OFF', shared_pool_size: 0.6, db_cache_size: 7,
        pga: 2.5, processes: 220, sessions: 352, archivelog: 'NOARCHIVELOG',
        arch_procs: 1, fra_size: 50, arch_keep: 14, log_buffer: 6, dbwr: 1,
        cluster_db: 'FALSE', rac_nodes: 1, cursor_sharing: 'EXACT',
      },
      // 參數檔裡躺著會讓重啟失敗的天花板；故事不提，只在待生效清單與啟動失敗時露出
      spfileDiff: { sga_max_size: 64 },
    },
  ];

  // 入門 → 進階 → 專家 → 總驗收 → 大魔王
  const ORDER = [
    'i01', 'i02', 'i03', 'i04', 'i05', 'i06', 'i07', 'i08', 'i09', 'i10', 'i11', 'i12',
    'm01', 'm02', 'm03', 'm04', 'm05', 'm06',
    'x01', 'x02', 'x03', 'x04',
    'f01', 'boss',
  ];
  list.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return list;
})();
