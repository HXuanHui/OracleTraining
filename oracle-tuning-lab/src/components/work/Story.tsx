/**
 * 關卡故事、過關目標、連續達標進度與提示。
 * 大魔王（silent）不渲染情節、目標理由與提示列。
 */
import { depthOf, isSilent } from '../../model/depth';
import { evaluateGoal } from '../../model/goal';
import type { GameState } from '../../model/types';
import { latTxt } from '../../utils/format';

interface StoryProps {
  state: GameState;
  need: number;
  onHint: () => void;
  /** 模擬速度；0 表示暫停，讀秒不會前進 */
  speed: number;
}

/** 右側故事與目標面板 */
export function Story({ state, need, onHint, speed }: StoryProps) {
  const sc = state.sc;
  const g = sc.goal;
  const m = state.m;
  const silent = isSilent(sc);
  const depth = depthOf(sc.tag);
  const goalEval = evaluateGoal(state);

  /** 設定目標列的通過／失敗樣式與目前值 */
  const goalItem = (
    id: string,
    ok: boolean | null,
    label: string,
    cur: string,
    why?: string,
  ) => (
    <li key={id} className={ok === null ? '' : ok ? 'pass' : 'fail'}>
      <span className="mk">{ok === null ? '·' : ok ? '✓' : '✗'}</span>
      <span>
        {label}
        {why && <small className="goal-why">{why}</small>}
      </span>
      <span className="cur">{cur}</span>
    </li>
  );

  // 專家／靜默：故事卡不重複長篇理由；靜默連 SLA 附註也不給
  const latWhy = silent || depth === 'expert'
    ? undefined
    : sc.why.lat + (depth === 'mid' ? ' 現場先查 V$SYSTEM_EVENT，看時間花在哪個等待。' : '');
  const oraWhy = silent || depth === 'expert'
    ? undefined
    : '拒連與 ORA 會寫在 Alert Log；人連不上時接著看 V$RESOURCE_LIMIT。';
  const warmWhy = silent || depth === 'expert'
    ? undefined
    : '重啟後資料快取是空的，前幾秒的延遲不算數，要等預熱完再看回應時間。';
  const archWhy = silent ? undefined : sc.why.archive;
  const nodesWhy = silent ? undefined : sc.why.nodes;

  // 與 evaluateGoal 相同：各失敗來源皆接近零才算通過
  const oraOk = m ? Object.values(m.parts).every((v) => v <= 0.01) : null;

  const goals = [];
  if (m) {
    goals.push(goalItem('lat', m.lat <= g.lat, `回應時間 ≤ ${g.lat} ms`, `目前 ${latTxt(m.lat).v} ${latTxt(m.lat).u}`, latWhy));
    goals.push(goalItem('ora', oraOk, '沒有拒連與 ORA 失敗', oraOk ? '正常' : '仍有失敗', oraWhy));
    goals.push(goalItem('warm', state.warm >= 0.9, '資料庫開放，且資料快取預熱完成', `${Math.round(state.warm * 100)}%`, warmWhy));
  } else {
    goals.push(goalItem('lat', null, `回應時間 ≤ ${g.lat} ms`, '—', latWhy));
    goals.push(goalItem('ora', null, '沒有拒連與 ORA 失敗', '—', oraWhy));
    goals.push(goalItem('warm', false, '資料庫開放，且資料快取預熱完成', '重啟中', warmWhy));
  }
  if (g.archive) {
    goals.push(goalItem(
      'arch',
      state.mem.archivelog === 'ARCHIVELOG',
      '必須是歸檔模式 (ARCHIVELOG)',
      state.mem.archivelog === 'ARCHIVELOG' ? '已開啟' : '尚未開啟',
      archWhy,
    ));
  }
  if (g.minNodes || g.maxNodes) {
    const nn = state.mem.cluster_db === 'TRUE' ? Number(state.mem.rac_nodes) : 1;
    goals.push(goalItem(
      'nodes',
      (!g.minNodes || nn >= g.minNodes) && (!g.maxNodes || nn <= g.maxNodes),
      `叢集節點數 ${g.minNodes || 1} 到 ${g.maxNodes} 個（授權預算）`,
      `目前 ${nn} 個`,
      nodesWhy,
    ));
  }

  return (
    <section className="card story">
      <span className="tag">{sc.tag}</span>
      <h2>{sc.title}</h2>
      {!silent && sc.story && <p>{sc.story}</p>}
      {silent && <p className="story-silent">無事故通報。請依左側指標、等待事件、診斷表與參數現況判斷。</p>}
      <ul className="goals">{goals}</ul>
      {silent && (
        <p className="goal-next">這一關沒有提示。從 V$RESOURCE_LIMIT、V$SESSION、V$SYSTEM_EVENT 與 Alert Log 下手。</p>
      )}
      {!silent && depth === 'intro' && (
        <p className="goal-next">每個目標下面寫了為什麼是這個數字。點左側的指標也可以看白話說明。</p>
      )}
      {!silent && depth === 'mid' && (
        <p className="goal-next">點左側指標會打開簡化過的查詢結果，欄位對得上真實的檢視。</p>
      )}
      {!silent && depth === 'expert' && (
        <p className="goal-next">點左側指標會打開對應的檢視。建議從 V$RESOURCE_LIMIT、V$SESSION、V$SYSTEM_EVENT 再到 Alert Log。</p>
      )}
      <div className="streak">
        <div className="sbar">
          <i style={{ width: `${(Math.min(state.streak, need) / need) * 100}%` }} />
        </div>
        <span>連續達標 {Math.min(state.streak, need)} / {need} 秒</span>
      </div>
      {speed <= 0 && (
        <p className="streak-note">模擬已暫停，請按上方「1×」或「3×」才會開始讀秒。</p>
      )}
      {speed > 0 && !state.won && !goalEval.ok && goalEval.blockedBy && (
        <p className="streak-note">讀秒尚未開始：{goalEval.blockedBy}</p>
      )}
      {speed > 0 && !state.won && goalEval.ok && state.streak === 0 && (
        <p className="streak-note">條件已齊，下一秒起開始累計。</p>
      )}
      {!silent && sc.hints.length > 0 && (
        <div className="hintrow">
          <button
            type="button"
            className="btn ghost"
            disabled={state.hintN >= sc.hints.length}
            onClick={onHint}
          >
            {state.hintN >= sc.hints.length
              ? '提示用完了'
              : `給我提示（${state.hintN}/${sc.hints.length}）`}
          </button>
          <ul className="hints">
            {sc.hints.slice(0, state.hintN).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
