/**
 * 底部黏著套用列：待套用變更、訊息、重啟確認。
 */
import { byKey, KIND } from '../../data/params';
import type { GameState, ParamDef } from '../../model/types';
import { fmt } from '../../utils/format';

interface ApplyBarProps {
  state: GameState;
  baseVal: (p: ParamDef) => string | number;
  onApply: () => void;
  onDiscard: () => void;
  onPersist: (v: boolean) => void;
  onRequestRestart: () => void;
  onCancelRestart: () => void;
  onConfirmRestart: () => void;
}

/** 套用變更與重啟控制列 */
export function ApplyBar({
  state, baseVal, onApply, onDiscard, onPersist,
  onRequestRestart, onCancelRestart, onConfirmRestart,
}: ApplyBarProps) {
  const keys = Object.keys(state.staged);
  const stt = state.status;
  const pend = Object.keys(state.spfile).filter((k) => state.spfile[k] !== state.mem[k]);

  return (
    <section className="bar" aria-label="套用變更">
      {keys.length > 0 ? (
        <div>
          <h4>待套用的變更</h4>
          <ul className="chg">
            {keys.map((k) => {
              const p = byKey[k];
              const kd = KIND[p.kind];
              return (
                <li key={k}>
                  <span className={`badge ${kd.cls}`}>{kd.text}</span>
                  <span>{p.label}</span>
                  <span className="cv">{fmt(p, baseVal(p))} → {fmt(p, state.staged[k])}</span>
                </li>
              );
            })}
          </ul>
          <label className="persist">
            <input
              type="checkbox"
              checked={state.persist}
              onChange={(e) => onPersist(e.target.checked)}
            />
            永久保存（同時寫入參數檔）
          </label>
          <div className="row">
            <button type="button" className="btn primary" onClick={onApply}>套用變更</button>
            <button type="button" className="btn" onClick={onDiscard}>放棄變更</button>
          </div>
        </div>
      ) : (
        !state.msgs.length && (
          <p className="bar-idle">調整上面的參數，變更會先列在這裡，確認後再套用。</p>
        )
      )}

      {state.msgs.length > 0 && (
        <ul className="msgs">
          {state.msgs.map(([c, t], i) => (
            <li key={i} className={c}>{t}</li>
          ))}
        </ul>
      )}

      {pend.length > 0 && stt === 'open' && (
        <>
          <hr className="divider" />
          <div>
            <h4>下次重啟後的差異</h4>
            <ul className="pend">
              {pend.map((k) => {
                const p = byKey[k];
                if (!p) return null;
                return (
                  <li key={k}>
                    {p.name}：{fmt(p, state.mem[k])} → {fmt(p, state.spfile[k])}
                    {p.kind === 'static' ? '（待生效）' : '（會被還原）'}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {state.confirm ? (
        <div className="confirm">
          <p>
            重新啟動會中斷所有連線並清空資料快取。
            {pend.length ? '參數檔的內容會在這時載入。' : '目前參數檔沒有待生效的變更。'}
          </p>
          <div className="row">
            <button type="button" className="btn danger" onClick={onConfirmRestart}>確定重新啟動</button>
            <button type="button" className="btn" onClick={onCancelRestart}>取消</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={stt !== 'open'}
            onClick={onRequestRestart}
          >
            {stt === 'open'
              ? '重新啟動資料庫'
              : stt === 'failed'
                ? '請先處理上方的啟動失敗'
                : '重新啟動中…'}
          </button>
        </div>
      )}
    </section>
  );
}
