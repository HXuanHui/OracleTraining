/**
 * 入門關「調之前先看」區塊。
 * 列出本關應參考的環境數值與來源檢視，避免憑感覺拉 bar。
 */
import { VIEWS, type ViewKey } from '../../data/views';
import { depthOf, isSilent } from '../../model/depth';
import type { GameState, ObserveItem } from '../../model/types';

interface ObservePanelProps {
  /** 目前對局 */
  state: GameState;
  /** 進階以上可點開對應檢視；入門只顯示數值 */
  onOpenView?: (key: ViewKey) => void;
}

/**
 * 依觀察項目與目前 workload／metrics 填入顯示值。
 * @param item 觀察定義
 * @param state 對局
 * @returns 顯示用字串
 */
function valueOf(item: ObserveItem, state: GameState): string {
  const w = state.sc.w;
  const m = state.m;
  // 以 label 關鍵字對應常見觀察值（關卡資料可寫死 calc，數值仍動態）
  if (item.label.includes('上線') || item.label.includes('使用者')) return `${w.users} 人`;
  if (item.label.includes('核心') || item.label.includes('CPU')) return `${w.cores} 核`;
  if (item.label.includes('RAM') || item.label.includes('實體記憶')) return `${w.ram} GB`;
  if (item.label.includes('熱資料') || item.label.includes('工作集')) return `${w.workingSet} GB`;
  if (item.label.includes('排序')) {
    const concurrent = Math.max(1, Math.round(w.users * (w.sortActive || 0.1)));
    return `約 ${concurrent} 人 × ${w.sortMB} MB`;
  }
  if (item.label.includes('報表') || item.label.includes('最長查詢')) {
    const sec = m?.reportDur ?? 0;
    return sec > 0 ? `${Math.round(sec)} 秒` : '—';
  }
  if (item.label.includes('Undo 產生') || item.label.includes('Undo 速率')) {
    return w.undoMBps ? `${w.undoMBps} MB/s` : '—';
  }
  if (item.label.includes('Undo 表空間') || item.label.includes('Undo 空間')) {
    return w.undoSpace ? `${w.undoSpace} MB` : '—';
  }
  if (item.label.includes('游標')) return `${w.cursorsNeed}`;
  if (item.label.includes('重做') || item.label.includes('Redo')) return `${w.redoMBps} MB/s`;
  if (item.label.includes('寫入')) return `${w.writeMBps} MB/s`;
  if (item.calc) return item.calc;
  return '見右側說明';
}

/**
 * 入門觀察面板。進階／專家／靜默關不顯示。
 * @param state 目前對局
 * @param onOpenView 點來源徽章時回呼（入門可省略）
 */
export function ObservePanel({ state, onOpenView }: ObservePanelProps) {
  if (depthOf(state.sc.tag) !== 'intro' || isSilent(state.sc)) return null;
  const items = state.sc.observe ?? [];
  if (items.length === 0) return null;

  return (
    <section className="observe card" aria-label="調之前先看">
      <h3>調之前先看</h3>
      <p className="phint">不要憑感覺拉 bar。先對照這些數字，再決定參數要設多少。</p>
      <ul className="observe-list">
        {items.map((item) => {
          const meta = item.view ? VIEWS[item.view] : null;
          return (
            <li key={`${item.label}-${item.source}`}>
              <div className="observe-main">
                <span className="observe-label">{item.label}</span>
                <strong className="observe-val">{valueOf(item, state)}</strong>
              </div>
              <div className="observe-src">
                {onOpenView && item.view ? (
                  <button
                    type="button"
                    className="vtag"
                    title={meta?.zh}
                    onClick={() => onOpenView(item.view!)}
                  >
                    {item.source || meta?.name}
                  </button>
                ) : (
                  <span className="vtag">{item.source}</span>
                )}
                {item.calc && <span className="observe-calc">{item.calc}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
