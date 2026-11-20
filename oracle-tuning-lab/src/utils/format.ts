/**
 * 顯示格式與數值範圍輔助函式。
 */
import type { ParamDef } from '../model/types';

/**
 * 將秒數格式化為 mm:ss。
 * @param t 模擬經過的秒數
 * @returns 兩位數分:秒字串
 */
export function mmss(t: number): string {
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/**
 * 依參數定義計算滑桿的 [min, max, step]。
 * 記憶體相關參數會依伺服器 RAM 動態調整上限。
 * @param p 參數定義
 * @param ram 情境伺服器記憶體 (GB)
 */
export function rangeOf(p: ParamDef, ram: number): [number, number, number] {
  if (p.k === 'sga_max_size') return [1, ram + 8, 1];
  // SGA_TARGET 可為 0：真實環境這代表關閉 ASMM、改手動分配各區塊
  if (p.k === 'sga_target') return [0, ram + 8, 1];
  if (p.k === 'pga') return [0.5, ram, 0.5];
  if (p.k === 'shared_pool_size') return [0.25, ram, 0.25];
  if (p.k === 'db_cache_size') return [0.5, ram, 0.5];
  if (p.k === 'large_pool_size' || p.k === 'java_pool_size') return [0, Math.max(2, Math.floor(ram / 4)), 0.05];
  if (p.k === 'memory_target' || p.k === 'memory_max_target') return [0, ram + 8, 1];
  return [p.min!, p.max!, p.step!];
}

/**
 * 將參數值格式化為可讀字串（含單位）。
 * @param p 參數定義
 * @param v 目前值
 */
export function fmt(p: ParamDef, v: string | number): string {
  if (p.type === 'seg') return String(v);
  if (p.k === 'undo_retention') {
    const n = Number(v);
    return (n % 60 === 0 ? n / 60 : (n / 60).toFixed(1)) + ' 分鐘';
  }
  if (p.k === 'sga_target' && Number(v) === 0) return '0 GB（ASMM 關閉／手動）';
  const s = String(Math.round(Number(v) * 100) / 100);
  return p.unit ? s + ' ' + p.unit : s;
}

/**
 * 將延遲毫秒轉為顯示用數值與單位。
 * @param v 延遲 (ms)
 */
export function latTxt(v: number): { v: string; u: string } {
  if (v >= 1000) return { v: (v / 1000).toFixed(2), u: 's' };
  return { v: v >= 100 ? v.toFixed(0) : v.toFixed(1), u: 'ms' };
}

/**
 * 將最大值向上取到 1/2/5 × 10^n，供圖表 Y 軸使用。
 * @param v 原始最大值
 */
export function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/**
 * 將數值限制在 [a, b] 區間。
 * @param x 輸入值
 * @param a 下限
 * @param b 上限
 */
export function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

/**
 * 把模擬秒數編成 alert log 用的時間戳（台灣時間）。
 * 起點固定在 2026-11-20 09:00，方便對照，不是作業系統的現在時間。
 * @param t 模擬經過的秒數
 * @returns ISO 8601 字串，含 +08:00
 */
export function alertStamp(t: number): string {
  const ms = Date.parse('2026-11-20T09:00:00+08:00') + t * 1000;
  // 轉成 +08 的鐘面後再用 UTC 欄位組字，避免執行環境的時區干擾
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const y = shifted.getUTCFullYear();
  const mo = p(shifted.getUTCMonth() + 1);
  const d = p(shifted.getUTCDate());
  const h = p(shifted.getUTCHours());
  const mi = p(shifted.getUTCMinutes());
  const s = p(shifted.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000000+08:00`;
}
