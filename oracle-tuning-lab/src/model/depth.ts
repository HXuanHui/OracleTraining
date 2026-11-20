/**
 * 關卡說明深度。
 * 入門講原因，進階帶查詢名稱，專家只留真實檢視；大魔王另開靜默模式。
 */
import type { Scenario } from './types';

/** 說明深度：入門／進階／專家（總驗收、大魔王與專家同一層） */
export type Depth = 'intro' | 'mid' | 'expert';

/**
 * 依關卡標籤決定說明深度。
 * 總驗收、大魔王與專家同一層，直接看 V$ 與 alert log。
 * @param tag 情境標籤（入門、進階、專家、總驗收、大魔王）
 * @returns 說明深度
 */
export function depthOf(tag: string): Depth {
  if (tag === '入門') return 'intro';
  if (tag === '進階') return 'mid';
  return 'expert';
}

/**
 * 是否為靜默關卡（無劇情、無提示、診斷不給白話導引）。
 * @param sc 關卡；可傳整份或僅含 silent／tag 的片段
 * @returns 為 true 時 UI 應隱藏教練文案
 */
export function isSilent(sc: Pick<Scenario, 'silent' | 'tag'>): boolean {
  return !!sc.silent || sc.tag === '大魔王';
}
