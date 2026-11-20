/**
 * 參數定義：群組、生效時機標籤、可調參數清單與依難度過濾。
 * 每個參數標註 views，供「先觀察再調參」晶片與建議順序使用。
 * 常見參數參考：https://www.cnblogs.com/xulinforDB/p/17496431.html
 */
import { depthOf } from '../model/depth';
import type { ParamDef, ParamGroup, ParamKind } from '../model/types';

/** 生效時機對應的 CSS class 與顯示文字 */
export const KIND: Record<ParamKind, { cls: string; text: string }> = {
  static: { cls: 'b-static', text: '需重啟' },
  dynamic: { cls: 'b-dyn', text: '即時生效' },
  deferred: { cls: 'b-def', text: '新連線生效' },
};

/** 參數面板群組順序 */
export const GROUPS: ParamGroup[] = [
  { id: 'mem', title: '記憶體' },
  { id: 'conn', title: '連線與游標' },
  { id: 'sql', title: 'SQL 與優化器' },
  { id: 'io', title: '寫入與日誌' },
  { id: 'par', title: '平行與還原' },
  { id: 'arch', title: '歸檔與備份' },
  { id: 'rac', title: '叢集 RAC' },
  { id: 'misc', title: '實例與診斷' },
];

/** 讀出參數層級；未標的一律當基礎參數 */
export function paramTier(p: ParamDef): 'basic' | 'topic' | 'expert' {
  return p.tier ?? 'basic';
}

/**
 * 依關卡難度決定這個參數要不要出現在面板上。
 * 入門：只顯示 focus；進階：基礎 + focus + 本關解鎖的主題參數；
 * 專家／總驗收／大魔王：全部。
 * @param p 參數定義
 * @param tag 情境標籤
 * @param focus 本關重點參數
 * @param extra 本關解鎖的主題參數
 * @returns 是否顯示
 */
export function paramVisible(
  p: ParamDef,
  tag: string,
  focus: string[] = [],
  extra: string[] = [],
): boolean {
  if (focus.includes(p.k) || extra.includes(p.k)) return true;
  const depth = depthOf(tag);
  const tier = paramTier(p);
  if (depth === 'intro') return false;
  if (depth === 'mid') return tier === 'basic';
  return true;
}

/** 所有可調參數定義 */
export const PARAMS: ParamDef[] = [
  // --- 記憶體（基礎） ---
  {
    k: 'sga_max_size', name: 'SGA_MAX_SIZE', group: 'mem', label: 'SGA 記憶體上限', kind: 'static', unit: 'GB',
    views: ['sgainfo', 'osstat'],
    hint: 'SGA 的天花板。調高或調低都要重啟才會生效。真實環境常與 MEMORY_MAX_TARGET 一起規劃。',
  },
  {
    k: 'sga_target', name: 'SGA_TARGET', group: 'mem', label: 'SGA 目前大小', kind: 'dynamic', unit: 'GB',
    views: ['sgainfo', 'osstat', 'sysmetric'],
    hint: '大於 0 啟用 ASMM（自動分配共用池與快取）；設成 0 等於關閉 ASMM、改手動分配。在上限以內可以即時增減。',
  },
  {
    k: 'pga', name: 'PGA_AGGREGATE_TARGET', group: 'mem', label: 'PGA 工作記憶體', kind: 'dynamic', unit: 'GB',
    views: ['pgastat', 'osstat', 'event'],
    hint: '排序與雜湊用的工作記憶體總額，不夠時會溢出到磁碟。現代環境請用這個，而不是舊的 SORT_AREA_SIZE。',
  },
  // --- 記憶體（主題：ASMM／手動；與 SGA_TARGET 連動） ---
  {
    k: 'asmm', name: 'SGA_TARGET（0 = 關閉 ASMM）', group: 'mem', label: 'SGA 自動管理 (ASMM)', kind: 'dynamic', type: 'seg', tier: 'topic',
    views: ['sgainfo', 'parameter'],
    options: [['ON', '開啟 ASMM：SGA_TARGET > 0'], ['OFF', '手動分配：SGA_TARGET = 0']],
    hint: '真實環境沒有獨立的 ASMM 開關：SGA_TARGET>0 就是 ASMM，=0 就是手動。實驗室會自動幫你同步這兩個值。',
  },
  {
    k: 'shared_pool_size', name: 'SHARED_POOL_SIZE', group: 'mem', label: '共用池大小', kind: 'dynamic', unit: 'GB', tier: 'topic',
    views: ['sgainfo', 'sysstat', 'alert'],
    hint: '存放解析過的 SQL。ASMM 開啟時只是「最小保證值」，關閉時是固定大小。太小會出現 ORA-04031。',
  },
  {
    k: 'db_cache_size', name: 'DB_CACHE_SIZE', group: 'mem', label: '資料快取大小', kind: 'dynamic', unit: 'GB', tier: 'topic',
    views: ['sgainfo', 'sysmetric', 'event'],
    hint: '存放資料區塊。ASMM 開啟時是最小保證值，關閉時是固定大小。共用池加快取不能超過 SGA 上限。',
  },
  // --- 記憶體（專家） ---
  {
    k: 'large_pool_size', name: 'LARGE_POOL_SIZE', group: 'mem', label: '大型池', kind: 'dynamic', unit: 'GB', tier: 'expert',
    views: ['sgainfo', 'px_process'],
    hint: '給平行執行訊息、RMAN I/O、共用伺服器工作階段用。平行度開高卻把大型池設太小，訊息會改擠共用池。',
  },
  {
    k: 'java_pool_size', name: 'JAVA_POOL_SIZE', group: 'mem', label: 'Java 池', kind: 'dynamic', unit: 'GB', tier: 'expert',
    views: ['sgainfo'],
    hint: '存放 Java 方法與類別在共用記憶體中的表示。不用 JVM 時可維持很小，但仍佔 SGA 空間。',
  },
  {
    k: 'memory_target', name: 'MEMORY_TARGET', group: 'mem', label: 'AMM 目標記憶體', kind: 'dynamic', unit: 'GB', tier: 'expert',
    views: ['osstat', 'sgainfo', 'pgastat', 'parameter'],
    hint: '大於 0 會啟用自動記憶體管理（AMM），讓 Oracle 在 SGA 與 PGA 之間自動挪移。本實驗室的效能仍以 SGA_TARGET／PGA 為準，這裡用來對照真實參數檔。',
  },
  {
    k: 'memory_max_target', name: 'MEMORY_MAX_TARGET', group: 'mem', label: 'AMM 記憶體上限', kind: 'static', unit: 'GB', tier: 'expert',
    views: ['osstat', 'parameter'],
    hint: 'AMM 的天花板，需 ≥ MEMORY_TARGET。關係大致是 MEMORY_MAX_TARGET ≥ MEMORY_TARGET，且常覆蓋 SGA_MAX_SIZE。',
  },
  {
    k: 'pre_page_sga', name: 'PRE_PAGE_SGA', group: 'mem', label: '啟動時預載入 SGA', kind: 'static', type: 'seg', tier: 'expert',
    views: ['sgainfo', 'osstat', 'parameter'],
    options: [['FALSE', 'FALSE 用到再載入'], ['TRUE', 'TRUE 啟動時載入全部']],
    hint: 'TRUE 時實例啟動會把 SGA 頁面都載入實體記憶體，啟動較慢，但剛 OPEN 時快取命中較高。每個新連線也會多花一點時間。',
  },
  {
    k: 'lock_sga', name: 'LOCK_SGA', group: 'mem', label: '鎖定 SGA 不換頁', kind: 'static', type: 'seg', tier: 'expert',
    views: ['osstat', 'sgainfo', 'parameter'],
    options: [['FALSE', 'FALSE 允許換出'], ['TRUE', 'TRUE 鎖定在實體記憶體']],
    hint: 'TRUE 時要求作業系統把 SGA 鎖在 RAM，避免被換出。記憶體不夠時啟動會失敗，而不是邊跑邊變慢。',
  },

  // --- 連線與游標 ---
  {
    k: 'processes', name: 'PROCESSES', group: 'conn', label: '最大連線處理程序', kind: 'static', unit: '',
    min: 50, max: 2000, step: 10,
    views: ['resource', 'session', 'alert'],
    hint: '同時能連進來的處理程序上限，系統自己還要佔用約 40 個。SESSIONS 預設約為 PROCESSES × 1.5 + 22。',
  },
  {
    k: 'sessions', name: 'SESSIONS', group: 'conn', label: '工作階段上限', kind: 'static', unit: '', tier: 'expert',
    min: 50, max: 4000, step: 10,
    views: ['resource', 'session'],
    hint: '包含背景與使用者工作階段的總上限。預設約 PROCESSES × 1.5 + 22。只調大 PROCESSES 卻忘了 SESSIONS，仍可能被拒連。',
  },
  {
    k: 'open_cursors', name: 'OPEN_CURSORS', group: 'conn', label: '每個連線游標上限', kind: 'dynamic', unit: '',
    min: 50, max: 1000, step: 25,
    views: ['open_cursor', 'alert', 'parameter'],
    hint: '每個連線同時能開的游標數，不夠會直接報 ORA-01000。與 SESSION_CACHED_CURSORS 無關，兩者要分開設。',
  },

  // --- SQL 與優化器 ---
  {
    k: 'session_cached_cursors', name: 'SESSION_CACHED_CURSORS', group: 'sql', label: '連線游標快取', kind: 'deferred', unit: '',
    min: 0, max: 200, step: 10,
    views: ['sysstat', 'parameter'],
    hint: '每個連線快取的已關閉游標數，只有新建立的連線才會用到新值。建議小於 OPEN_CURSORS，並考量共用池大小。',
  },
  {
    k: 'cursor_sharing', name: 'CURSOR_SHARING', group: 'sql', label: 'SQL 共用模式', kind: 'dynamic', type: 'seg',
    views: ['sysstat', 'sysmetric', 'parameter'],
    options: [['EXACT', 'EXACT 逐字比對'], ['FORCE', 'FORCE 強制共用']],
    hint: 'EXACT 只共用字面完全相同的 SQL。FORCE 會把常數換成變數再共用，能立刻降低硬解析。',
  },
  {
    k: 'optimizer_mode', name: 'OPTIMIZER_MODE', group: 'sql', label: '優化器偏好', kind: 'dynamic', type: 'seg',
    views: ['sysmetric', 'event', 'parameter'],
    options: [['ALL_ROWS', 'ALL_ROWS 整體最快'], ['FIRST_ROWS_10', 'FIRST_ROWS_10 先回前幾筆']],
    hint: '決定執行計畫偏向先回第一批資料，還是整批跑完最快。',
  },
  {
    k: 'mbrc', name: 'DB_FILE_MULTIBLOCK_READ_COUNT', group: 'sql', label: '全表掃描一次讀取區塊數', kind: 'dynamic', unit: '',
    min: 8, max: 256, step: 8,
    views: ['event', 'parameter'],
    hint: '一次實體讀取的區塊數。倉儲／報表可調高；大約 128 以後幾乎沒有額外好處。',
  },
  {
    k: 'sort_area_size', name: 'SORT_AREA_SIZE', group: 'sql', label: '舊版排序區（已少用）', kind: 'deferred', unit: 'KB', tier: 'expert',
    min: 64, max: 1048576, step: 64,
    views: ['pgastat', 'parameter'],
    hint: '手動 PGA 時代每個排序可用的記憶體。現在請優先調 PGA_AGGREGATE_TARGET；此參數留給對照舊文件。',
  },
  {
    k: 'db_block_size', name: 'DB_BLOCK_SIZE', group: 'sql', label: '資料庫區塊大小', kind: 'static', type: 'seg', tier: 'expert',
    views: ['parameter'],
    options: [['8192', '8192（8 KB，建庫後不可改）']],
    hint: '建庫時決定，之後無法用 ALTER SYSTEM 更改。OLTP 常用 8 KB；倉庫有時用 16／32 KB。本關固定 8 KB 供對照。',
  },

  // --- 寫入與日誌 ---
  {
    k: 'log_buffer', name: 'LOG_BUFFER', group: 'io', label: '重做日誌緩衝區', kind: 'static', unit: 'MB',
    min: 1, max: 256, step: 1,
    views: ['event', 'sgainfo', 'parameter'],
    hint: '交易寫入日誌前的暫存區，太小會讓提交排隊等待。長期大量交易時可適當加大。',
  },
  {
    k: 'dbwr', name: 'DB_WRITER_PROCESSES', group: 'io', label: '資料寫入程序數', kind: 'static', unit: '',
    min: 1, max: 8, step: 1,
    views: ['osstat', 'event', 'parameter'],
    hint: '負責把已修改的資料寫回磁碟。經驗值約 MAX(1, TRUNC(CPU/8))；寫入量大時可加，但不要超過 CPU 數。',
  },
  {
    k: 'fast_start_mttr_target', name: 'FAST_START_MTTR_TARGET', group: 'io', label: '崩潰復原目標秒數', kind: 'dynamic', unit: '秒', tier: 'expert',
    min: 0, max: 3600, step: 30,
    views: ['instance_recovery', 'parameter'],
    hint: '希望實例復原在幾秒內完成。設太小會迫使更頻繁的檢查點，寫入負擔上升；0 表示交由系統自己決定。',
  },

  // --- 平行與還原 ---
  {
    k: 'pms', name: 'PARALLEL_MAX_SERVERS', group: 'par', label: '平行處理程序上限', kind: 'dynamic', unit: '',
    min: 0, max: 128, step: 4,
    views: ['osstat', 'px_process', 'event'],
    hint: '平行查詢與批次可用的程序數。太多會把 CPU 搶光，也會吃 LARGE_POOL。',
  },
  {
    k: 'undo_retention', name: 'UNDO_RETENTION', group: 'par', label: 'Undo 保留時間', kind: 'dynamic', unit: '秒',
    min: 60, max: 7200, step: 60,
    views: ['undostat', 'undots', 'alert'],
    hint: '舊版資料保留多久。報表跑得比這久就會「快照太舊」，但保留越久越吃空間。',
  },
  {
    k: 'deferred_segment_creation', name: 'DEFERRED_SEGMENT_CREATION', group: 'par', label: '延遲建立區段', kind: 'static', type: 'seg', tier: 'expert',
    views: ['parameter'],
    options: [['TRUE', 'TRUE 建表時不立刻佔空間'], ['FALSE', 'FALSE 立刻建立區段']],
    hint: 'TRUE 時空表不立刻佔用資料檔空間。匯入／大量建表環境有時會關掉，避免之後第一筆插入才建區段造成意外。',
  },

  // --- 歸檔與備份（主題） ---
  {
    k: 'archivelog', name: 'ARCHIVELOG 模式', group: 'arch', label: '歸檔模式', kind: 'static', type: 'seg', tier: 'topic',
    views: ['parameter', 'alert', 'recovery'],
    options: [['NOARCHIVELOG', 'NOARCHIVELOG 不保留歸檔'], ['ARCHIVELOG', 'ARCHIVELOG 保留歸檔']],
    hint: '要在掛載階段才能切換，所以得重啟。開啟後才能還原到任意時間點，也才能在不停機的情況下備份。',
  },
  {
    k: 'fra_size', name: 'DB_RECOVERY_FILE_DEST_SIZE', group: 'arch', label: '快速復原區大小 (FRA)', kind: 'dynamic', unit: 'GB', tier: 'topic',
    min: 10, max: 600, step: 10,
    views: ['recovery', 'alert'],
    hint: '歸檔日誌存放的空間。塞滿時，所有會產生日誌的操作都會卡住 (ORA-00257)。',
  },
  {
    k: 'arch_keep', name: 'RMAN ARCHIVELOG DELETION POLICY', group: 'arch', label: '歸檔日誌保留時間', kind: 'dynamic', unit: '小時', tier: 'topic',
    min: 1, max: 48, step: 1,
    views: ['recovery', 'parameter'],
    hint: '備份之後歸檔日誌還要留多久才能刪。留越久越安全，也越吃空間。',
  },
  {
    k: 'arch_procs', name: 'LOG_ARCHIVE_MAX_PROCESSES', group: 'arch', label: '歸檔程序數', kind: 'dynamic', unit: '', tier: 'topic',
    min: 1, max: 10, step: 1,
    views: ['event', 'session', 'parameter'],
    hint: '負責把寫滿的重做日誌複製出去。大約每個程序每秒處理 4 MB，跟不上時交易會等歸檔。',
  },

  // --- 叢集 RAC（主題） ---
  {
    k: 'cluster_db', name: 'CLUSTER_DATABASE', group: 'rac', label: '叢集模式 (RAC)', kind: 'static', type: 'seg', tier: 'topic',
    views: ['gv_instance', 'parameter'],
    options: [['FALSE', 'FALSE 單一執行個體'], ['TRUE', 'TRUE 啟用 RAC']],
    hint: '把資料庫改成多個節點共用同一份資料。這是啟動時就要決定的參數，所以要重啟。',
  },
  {
    k: 'rac_nodes', name: '運作中的節點數（啟停執行個體）', group: 'rac', label: '運作節點數', kind: 'dynamic', unit: '', tier: 'topic',
    min: 1, max: 4, step: 1,
    views: ['gv_instance', 'osstat'],
    hint: '叢集模式啟用後才有作用。新節點約 5 秒後加入。每個節點都有自己的 CPU、記憶體與連線上限。',
  },
  {
    k: 'svc_route', name: 'SERVICE 連線分流', group: 'rac', label: '服務連線分流', kind: 'deferred', type: 'seg', tier: 'topic',
    views: ['gv_instance', 'session', 'event'],
    options: [['ANY', 'ANY 任意節點'], ['PARTITIONED', 'PARTITIONED 依業務固定節點']],
    hint: '固定分流後，同一批資料大多只在一個節點被用到，節點之間傳資料區塊的次數會大減。',
  },
  {
    k: 'parallel_force_local', name: 'PARALLEL_FORCE_LOCAL', group: 'rac', label: '平行強制本機', kind: 'dynamic', type: 'seg', tier: 'expert',
    views: ['px_process', 'gv_instance', 'parameter'],
    options: [['FALSE', 'FALSE 可跨節點平行'], ['TRUE', 'TRUE 只在本節點平行']],
    hint: 'TRUE 時平行從屬程序只在發起查詢的那個節點啟動，減少 RAC 節點間協調。單機時幾乎無感。',
  },

  // --- 實例與診斷（專家，對照部落格常見參數） ---
  {
    k: 'db_files', name: 'DB_FILES', group: 'misc', label: '資料檔案上限', kind: 'static', unit: '', tier: 'expert',
    min: 50, max: 2000, step: 50,
    views: ['parameter', 'alert'],
    hint: '這個資料庫最多能開多少個資料檔。達到上限會 ORA-00059，需改參數並重啟。與控制檔裡的 MAXDATAFILES 不同。',
  },
  {
    k: 'job_queue_processes', name: 'JOB_QUEUE_PROCESSES', group: 'misc', label: '工作佇列程序數', kind: 'dynamic', unit: '', tier: 'expert',
    min: 0, max: 1000, step: 1,
    views: ['resource', 'parameter'],
    hint: '執行 DBMS_JOB／部分排程工作的背景程序數。0 等於關掉自動工作。設太高會和一般連線搶 PROCESSES。',
  },
  {
    k: 'timed_statistics', name: 'TIMED_STATISTICS', group: 'misc', label: '收集計時統計', kind: 'dynamic', type: 'seg', tier: 'expert',
    views: ['parameter', 'event'],
    options: [['TRUE', 'TRUE 收集'], ['FALSE', 'FALSE 關閉']],
    hint: '為 TRUE 時才有可靠的時間統計（等待事件毫秒等）。調校時幾乎都開著；極少數環境為省一點點開銷才關掉。',
  },
  {
    k: 'compatible', name: 'COMPATIBLE', group: 'misc', label: '相容性版本', kind: 'static', type: 'seg', tier: 'expert',
    views: ['parameter'],
    options: [['19.0.0', '19.0.0'], ['12.2.0', '12.2.0'], ['11.2.0', '11.2.0']],
    hint: '允許新版軟體以舊版行為運作。只能往上調、且需重啟；亂降會讓已用的新特性失效。',
  },
  {
    k: 'audit_trail', name: 'AUDIT_TRAIL', group: 'misc', label: '稽核軌跡', kind: 'static', type: 'seg', tier: 'expert',
    views: ['parameter'],
    options: [['NONE', 'NONE 關閉'], ['DB', 'DB 寫入資料庫'], ['OS', 'OS 寫入作業系統']],
    hint: '決定稽核紀錄寫到哪裡。開啟後有安全與合規價值，但會增加寫入量；變更需重啟。',
  },
];

/** 以參數鍵名快速查詢定義 */
export const byKey: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.k, p]));

/**
 * 依關卡 focus／staged 參數彙總建議先看的檢視（去重、保序）。
 * @param keys 參數鍵名清單
 * @returns 建議檢視鍵
 */
export function suggestedViewsFor(keys: string[]): import('./views').ViewKey[] {
  const seen = new Set<string>();
  const out: import('./views').ViewKey[] = [];
  for (const k of keys) {
    const views = byKey[k]?.views ?? [];
    for (const v of views) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
