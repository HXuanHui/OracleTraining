/**
 * 頂部品牌列：標題、模擬速度切換、重玩按鈕。
 */
interface HeaderProps {
  /** 目前模擬速度倍率（0 = 暫停） */
  speed: number;
  /** 變更模擬速度 */
  onSpeed: (v: number) => void;
  /** 重玩目前關卡 */
  onReset: () => void;
}

/** 頂部導覽與速度控制 */
export function Header({ speed, onSpeed, onReset }: HeaderProps) {
  return (
    <header className="top">
      <div className="brand">
        <svg width="34" height="34" viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <ellipse cx="17" cy="8" rx="11" ry="4.5" />
          <path d="M6 8v9c0 2.5 4.9 4.5 11 4.5S28 19.5 28 17V8" />
          <path d="M6 17v9c0 2.5 4.9 4.5 11 4.5S28 28.5 28 26v-9" />
        </svg>
        <div>
          <h1>Oracle 調校室</h1>
          <p>調參數、看症狀，分清楚哪些要重啟</p>
        </div>
      </div>
      <div className="top-r">
        <div className="speed" role="group" aria-label="模擬速度">
          {([0, 1, 3] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={speed === v}
              onClick={() => onSpeed(v)}
            >
              {v === 0 ? '暫停' : `${v}×`}
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost" onClick={onReset}>
          重玩此關
        </button>
      </div>
    </header>
  );
}
