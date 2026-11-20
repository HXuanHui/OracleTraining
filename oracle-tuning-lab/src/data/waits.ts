/**
 * 等待事件中英對照表。
 * 儀表板「資料庫都在等什麼」區塊使用。
 */
export const WAITS: Record<string, { zh: string; en: string }> = {
  cpu: { zh: '處理器運算與解析', en: 'CPU time' },
  seq: { zh: '快取沒命中，讀磁碟', en: 'db file sequential read' },
  scat: { zh: '全表掃描讀取', en: 'db file scattered read' },
  temp: { zh: '排序溢出到磁碟', en: 'direct path read/write temp' },
  logbuf: { zh: '等重做日誌緩衝區', en: 'log buffer space' },
  freebuf: { zh: '等資料寫入程序騰出空間', en: 'free buffer waits' },
  latch: { zh: '硬解析搶共用池', en: 'library cache: mutex X' },
  par: { zh: '平行批次處理', en: 'PX Deq: Execute Reply' },
  swap: { zh: '記憶體不足，系統換頁', en: 'OS swap' },
  gc: { zh: '節點之間傳送資料區塊', en: 'gc buffer busy / gc cr block' },
  archwait: { zh: '等歸檔程序騰出日誌', en: 'log file switch (archiving needed)' },
};
