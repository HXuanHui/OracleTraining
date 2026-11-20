/**
 * 診斷檢視註冊表：KPI、記憶體條、參數面板共用同一份來源名稱。
 * 實際表格資料由 diagnostics.ts 依 ViewKey 組出切片。
 */

/** 可打開的診斷檢視鍵名 */
export type ViewKey =
  | 'sysmetric'
  | 'resource'
  | 'session'
  | 'event'
  | 'alert'
  | 'osstat'
  | 'sgainfo'
  | 'pgastat'
  | 'sysstat'
  | 'undostat'
  | 'undots'
  | 'recovery'
  | 'instance_recovery'
  | 'open_cursor'
  | 'px_process'
  | 'gv_instance'
  | 'parameter';

/** 單一檢視的顯示中繼資料 */
export interface ViewMeta {
  /** 內部鍵 */
  key: ViewKey;
  /** Oracle 檢視／對像名稱（徽章顯示） */
  name: string;
  /** 一句話說明用途 */
  zh: string;
}

/**
 * 全部檢視中繼資料（順序即進階抽屜分頁建議順序的一部分）。
 */
export const VIEWS: Record<ViewKey, ViewMeta> = {
  sysmetric: {
    key: 'sysmetric',
    name: 'V$SYSMETRIC',
    zh: '回應時間、每秒交易數、快取命中率等即時指標',
  },
  resource: {
    key: 'resource',
    name: 'V$RESOURCE_LIMIT',
    zh: 'processes／sessions 使用量與上限',
  },
  session: {
    key: 'session',
    name: 'V$SESSION',
    zh: '目前連線與等待事件',
  },
  event: {
    key: 'event',
    name: 'V$SYSTEM_EVENT',
    zh: '等待事件時間組成',
  },
  alert: {
    key: 'alert',
    name: 'Alert Log',
    zh: '啟動、關閉與 ORA 錯誤文字檔',
  },
  osstat: {
    key: 'osstat',
    name: 'V$OSSTAT',
    zh: '核心數與實體記憶體',
  },
  sgainfo: {
    key: 'sgainfo',
    name: 'V$SGAINFO',
    zh: 'SGA 各元件大小',
  },
  pgastat: {
    key: 'pgastat',
    name: 'V$PGASTAT',
    zh: 'PGA 目標與溢寫',
  },
  sysstat: {
    key: 'sysstat',
    name: 'V$SYSSTAT',
    zh: '硬解析、游標快取命中等計數',
  },
  undostat: {
    key: 'undostat',
    name: 'V$UNDOSTAT',
    zh: '最長查詢、調後保留時間與 ORA-01555',
  },
  undots: {
    key: 'undots',
    name: 'DBA_DATA_FILES',
    zh: 'UNDO 表空間容量與 AUTOEXTEND',
  },
  recovery: {
    key: 'recovery',
    name: 'V$RECOVERY_FILE_DEST',
    zh: '快速復原區使用量',
  },
  instance_recovery: {
    key: 'instance_recovery',
    name: 'V$INSTANCE_RECOVERY',
    zh: '崩潰復原預估秒數',
  },
  open_cursor: {
    key: 'open_cursor',
    name: 'V$OPEN_CURSOR',
    zh: '各連線已開游標數',
  },
  px_process: {
    key: 'px_process',
    name: 'V$PX_PROCESS',
    zh: '平行從屬程序使用狀況',
  },
  gv_instance: {
    key: 'gv_instance',
    name: 'GV$INSTANCE',
    zh: '叢集各節點狀態',
  },
  parameter: {
    key: 'parameter',
    name: 'V$PARAMETER',
    zh: '執行中參數值',
  },
};

/**
 * 依鍵名取檢視中繼資料。
 * @param key 檢視鍵
 * @returns 中繼資料；未知鍵時回傳 null
 */
export function viewMeta(key: ViewKey): ViewMeta {
  return VIEWS[key];
}
