/**
 * Oracle 調校室核心型別定義。
 * 對應原始 HTML 模擬器中的參數、情境、效能結果與遊戲狀態。
 */
import type { ViewKey } from '../data/views';

/** 參數生效時機：需重啟 / 即時 / 新連線 */
export type ParamKind = 'static' | 'dynamic' | 'deferred';

/**
 * 關卡「調之前先看」的一列觀察項目。
 * 入門 ObservePanel 顯示；數值可由 UI 依 workload 動態帶入。
 */
export interface ObserveItem {
  /** 觀察項目名稱（例如「同時上線人數」） */
  label: string;
  /** 來源檢視徽章文字（例如 V$RESOURCE_LIMIT） */
  source: string;
  /**
   * 可選：如何用這個數字推算參數。
   * 純說明文字；實際即時推算另由 ParamCalc 負責。
   */
  calc?: string;
  /** 對應的診斷檢視鍵；有則可點開抽屜 */
  view?: ViewKey;
}

/** 資料庫生命週期狀態 */
export type DbStatus = 'open' | 'stopping' | 'nomount' | 'mount' | 'failed';

/** 事件紀錄等級 */
export type LogLevel = 'info' | 'ok' | 'warn' | 'crit';

/** 套用訊息等級：錯誤 / 成功 / 資訊 */
export type MsgClass = 'e' | 'o' | 'i';

/**
 * 單一可調參數的定義。
 * 依 type 區分為數值滑桿或分段按鈕。
 */
export interface ParamDef {
  /** 內部鍵名，對應 cfg 物件欄位 */
  k: string;
  /** Oracle 參數名稱（顯示用） */
  name: string;
  /** 所屬參數群組 id */
  group: string;
  /** 中文標籤 */
  label: string;
  /** 生效時機 */
  kind: ParamKind;
  /** 數值單位（GB、MB、秒等）；seg 類型可省略 */
  unit?: string;
  /** 說明文字 */
  hint: string;
  /** 控制項類型：省略為 range，seg 為分段選項 */
  type?: 'seg';
  /**
   * 參數顯示層級。
   * basic：進階關卡起一律可見；topic：主題參數（歸檔／RAC／手動 SGA），需關卡 extra 或專家才開；
   * expert：僅專家／總驗收顯示。省略時視為 basic。
   */
  tier?: 'basic' | 'topic' | 'expert';
  /** 分段選項：[值, 顯示文字] */
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  /**
   * 調這個參數前建議先看的診斷檢視。
   * 參數列晶片與進階「建議觀察順序」依此產生。
   */
  views?: ViewKey[];
}

/** 參數群組標題 */
export interface ParamGroup {
  id: string;
  title: string;
}

/**
 * 工作負載描述（情境的 w 物件）。
 * 用於效能計算模型。
 */
export interface Workload {
  ram: number;
  cores: number;
  users: number;
  workingSet: number;
  think: number;
  literal: number;
  hotCursors: number;
  cursorsNeed: number;
  cpuBase: number;
  hardCost: number;
  lio: number;
  sortMB: number;
  sortActive: number;
  scanMB: number;
  reportShare: number;
  redoMBps: number;
  commitW: number;
  writeMBps: number;
  writeW: number;
  batchMs: number;
  sharedNeed: number;
  undoMBps: number;
  undoSpace: number;
  reportScale: number;
  shareFrac: number;
  gcCost: number;
  archW: number;
  /**
   * 完全沒快取熱門游標時，軟解析的毫秒成本。
   * 省略則維持 0.4，避免其他關卡的延遲被放大。
   */
  softMs?: number;
  /** 使用者數隨時間變化的曲線 */
  curve?: (t: number) => number;
  /** 週期性節點故障設定 */
  failure?: { every: number; at: number; dur: number };
}

/**
 * 執行中參數組態（記憶體／參數檔共用欄位）。
 * 以字串鍵動態存取（參數面板與套用流程皆依鍵名操作）。
 */
export type Config = Record<string, string | number>;

/** 過關目標 */
export interface Goal {
  lat: number;
  latUnit?: string;
  archive?: boolean;
  maxNodes?: number;
  minNodes?: number;
}

/**
 * 關卡目標為什麼訂在這個數字。
 * 入門直接放在目標下方；專家改放進對應的診斷檢視。
 */
export interface ScenarioWhy {
  /** 回應時間門檻的業務理由 */
  lat: string;
  /** 必須開啟歸檔時的理由 */
  archive?: string;
  /** 節點數上下限的理由 */
  nodes?: string;
}

/** 單一關卡情境 */
export interface Scenario {
  id: string;
  tag: string;
  title: string;
  maxRestarts: number;
  story: string;
  goal: Goal;
  w: Workload;
  cfg: Config;
  hints: string[];
  lessons: string[];
  /** 目標門檻的業務理由 */
  why: ScenarioWhy;
  /**
   * 本關「重點要調」的參數鍵名。
   * 入門只顯示這些；進階／專家仍會優先出現在清單裡。
   */
  focus?: string[];
  /**
   * 主題參數鍵名（歸檔、RAC、手動 SGA 等）。
   * 進階關卡用來解鎖 tier=topic 的參數；專家則全部可見。
   */
  extra?: string[];
  /** 連續達標秒數（預設 15） */
  need?: number;
  /** 參數檔與執行中初始差異 */
  spfileDiff?: Partial<Config>;
  /**
   * 靜默模式（大魔王）：不描述情節、不給提示與目標理由，
   * 只靠 KPI、等待事件、診斷表與參數現況判斷。
   */
  silent?: boolean;
  /**
   * 調參前應先觀察的項目（入門顯示數值；進階／專家導向對應表）。
   */
  observe?: ObserveItem[];
}

/** 等待事件項目 */
export interface WaitItem {
  k: string;
  ms: number;
  pct: number;
}

/** compute() 回傳的效能快照 */
export interface Metrics {
  users: number;
  connected: number;
  lat: number;
  tps: number;
  hit: number;
  hardPerSec: number;
  cpuUtil: number;
  /** 各類拒連／ORA 來源強度（0–1），供 Alert Log 診斷；不是畫面 KPI */
  parts: {
    conn: number;
    cur: number;
    snap: number;
    undo: number;
    shared: number;
    arch: number;
  };
  swap: boolean;
  resident: number;
  sga: number;
  pga: number;
  sharedG: number;
  cacheG: number;
  asmmOn: boolean;
  waits: WaitItem[];
  reportDur: number;
  undoNeed: number;
  spill: number;
  alive: number;
  nodes: number;
  failing: boolean;
  fraUsed: number;
  fraTarget: number;
  fraFull: boolean;
  util: number;
  outage?: boolean;
}

/** 歷史圖資料點 */
export interface HistPoint {
  lat: number | null;
  tps: number;
}

/** 事件紀錄 */
export interface LogEntry {
  t: number;
  level: LogLevel;
  text: string;
}

/**
 * 終端機逐字稿的一列。
 * cmd 是下的指令，out 是伺服器回應，note 是給入門與進階的白話註解。
 */
export interface TermLine {
  t: number;
  kind: 'cmd' | 'out' | 'note';
  /**
   * 註解最多顯示到這個難度（含）。
   * intro 只給入門；mid 給入門與進階。專家不顯示 note。
   */
  upto?: 'intro' | 'mid';
  text: string;
}

/** Alert log 的一列。訊息以 Oracle 原文為主，時間用實驗室時鐘。 */
export interface AlertLine {
  t: number;
  level: LogLevel;
  text: string;
}

/** 待套用的 deferred 參數 */
export interface PendDef {
  v: string | number;
  left: number;
}

/**
 * 一局遊戲的完整狀態。
 * 由 useGame hook 維護，驅動整頁 UI。
 */
export interface GameState {
  sc: Scenario;
  t: number;
  status: DbStatus;
  left: number;
  mem: Config;
  spfile: Config;
  lastGood: Config;
  staged: Record<string, string | number>;
  pendDef: Record<string, PendDef>;
  warm: number;
  hist: HistPoint[];
  streak: number;
  restarts: number;
  won: boolean;
  flags: Record<string, number>;
  log: LogEntry[];
  /** SQL*Plus／RMAN 逐字稿，用來對照剛才下過的指令 */
  term: TermLine[];
  /** 模擬的 alert log */
  alert: AlertLine[];
  hintN: number;
  persist: boolean;
  failMsg: string;
  m: Metrics | null;
  confirm: boolean;
  msgs: [MsgClass, string][];
  nodesEff: number;
  fraUsed: number;
  backupCd: number;
  failing: boolean;
  outage: boolean;
  /**
   * 本關已打開過的診斷檢視鍵。
   * 進階套用前提醒、過關回顧用；不阻擋套用。
   */
  viewed: ViewKey[];
}
