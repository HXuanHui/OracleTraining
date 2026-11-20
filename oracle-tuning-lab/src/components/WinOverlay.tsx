/**
 * 過關對話框：星等、教訓、下一關導航。
 */
import { SCENARIOS } from '../data/scenarios';
import { VIEWS } from '../data/views';
import { depthOf, isSilent } from '../model/depth';
import type { GameState } from '../model/types';

interface WinOverlayProps {
  state: GameState;
  scIndex: number;
  need: number;
  stars: Record<string, number>;
  onClose: () => void;
  onReset: () => void;
  onNext: (i: number) => void;
}

/** 過關彈層 */
export function WinOverlay({
  state, scIndex, need, stars, onClose, onReset, onNext,
}: WinOverlayProps) {
  const sc = state.sc;
  const n = stars[sc.id] || 0;
  const keys = Object.keys(state.mem);
  const saved = keys.every((k) => state.mem[k] === state.spfile[k]) && Object.keys(state.pendDef).length === 0;
  const few = state.restarts <= sc.maxRestarts;
  const next = SCENARIOS[scIndex + 1];

  return (
    <div className="overlay" role="presentation">
      <div className="win" role="dialog" aria-modal="true" aria-labelledby="winTitle">
        <h2 id="winTitle">過關：{sc.title}</h2>
        <div className="big" aria-label={`${n} 顆星`}>
          {'★'.repeat(n)}{'☆'.repeat(3 - n)}
        </div>
        <ul>
          <li>
            <span className="mk">✓</span>
            連續 {need} 秒達到目標
          </li>
          <li className={few ? '' : 'no'}>
            <span className="mk">{few ? '✓' : '✗'}</span>
            重啟次數 {state.restarts} 次
            （{sc.maxRestarts === 0 ? '這關不需要重啟' : `最多 ${sc.maxRestarts} 次拿滿星`}）
          </li>
          <li className={saved ? '' : 'no'}>
            <span className="mk">{saved ? '✓' : '✗'}</span>
            {saved
              ? '所有設定都已寫入參數檔，重啟不會跑掉'
              : '還有設定只存在記憶體或尚未重啟，下次重啟會變回去'}
          </li>
        </ul>
        <h4>這一關學到的事</h4>
        <ul>
          {sc.lessons.map((t) => (
            <li key={t}>
              <span className="mk">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        {depthOf(sc.tag) !== 'intro' && !isSilent(sc) && (
          <>
            <h4>這一關查過的表</h4>
            {state.viewed.length === 0 ? (
              <p className="phint">這關還沒打開過診斷檢視。下次可以先看表再調參數。</p>
            ) : (
              <p className="vtag-row">
                {state.viewed.map((v) => (
                  <span key={v} className="vtag">{VIEWS[v]?.name ?? v}</span>
                ))}
              </p>
            )}
          </>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>繼續觀察</button>
          <button type="button" className="btn" onClick={onReset}>重玩</button>
          {next && (
            <button type="button" className="btn primary" onClick={() => onNext(scIndex + 1)}>
              下一關：{next.title}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
