/**
 * 快速復原區 (FRA) 用量與緊急備份按鈕。
 */
import { fraTargetOf } from '../../model/compute';
import type { GameState } from '../../model/types';

interface FraCardProps {
  state: GameState;
  onBackup: () => void;
}

/** FRA 監控卡片 */
export function FraCard({ state, onBackup }: FraCardProps) {
  if (!(state.sc.extra || []).includes('archivelog')) return null;

  const on = state.mem.archivelog === 'ARCHIVELOG';
  if (!on) {
    return (
      <section className="card">
        <h4>快速復原區 (FRA)</h4>
        <p className="phint">目前是 NOARCHIVELOG，不會保留歸檔日誌。切換成 ARCHIVELOG 需要重啟。</p>
      </section>
    );
  }

  const size = Number(state.mem.fra_size);
  const used = Math.min(state.fraUsed, size);
  const pct = used / size;
  const fraState = pct >= 0.98 ? 'crit' : pct >= 0.8 ? 'warn' : 'ok';
  const w = state.sc.w;

  return (
    <section className="card">
      <h4>快速復原區 (FRA)</h4>
      <div className={`fra ${fraState}`}>
        <div className="fbar">
          <i style={{ width: `${(pct * 100).toFixed(1)}%` }} />
        </div>
        <div className="fl">
          <span>{used.toFixed(0)} / {size} GB</span>
          <span>
            {fraState === 'crit' ? '已滿，寫入被卡住' : fraState === 'warn' ? '快滿了' : '空間充足'}
          </span>
        </div>
      </div>
      <p className="phint" style={{ marginTop: 6 }}>
        每小時產生約 {(w.redoMBps * 3.6).toFixed(0)} GB，保留 {state.mem.arch_keep} 小時，穩定後約佔 {fraTargetOf(state.mem, w).toFixed(0)} GB。
      </p>
      <button
        type="button"
        className="btn fra-btn"
        disabled={!(state.status === 'open' && state.backupCd === 0)}
        onClick={onBackup}
      >
        {state.backupCd > 0 ? `冷卻中 ${state.backupCd} 秒` : '立即備份並清除歸檔'}
      </button>
    </section>
  );
}
