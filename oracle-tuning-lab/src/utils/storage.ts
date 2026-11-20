/**
 * localStorage 星等持久化。
 * 鍵名與原始 HTML 相同，便於沿用既有進度。
 */

const STARS_KEY = 'oracle-lab-stars';

/**
 * 讀取各關卡已獲得的最高星等。
 * @returns 情境 id → 星等 (0–3)
 */
export function loadStars(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STARS_KEY) || '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * 寫入星等進度。
 * @param stars 情境 id → 星等
 */
export function saveStars(stars: Record<string, number>): void {
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(stars));
  } catch {
    /* 私密模式或配額滿時略過 */
  }
}
