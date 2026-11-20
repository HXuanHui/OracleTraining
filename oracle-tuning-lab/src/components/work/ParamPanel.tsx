/**
 * 參數調整面板：依群組顯示滑桿／分段按鈕。
 * 記憶體群組上方固定伺服器記憶體條；入門顯示觀察區與推算。
 */
import { GROUPS, KIND, PARAMS, paramVisible } from '../../data/params';
import { VIEWS, type ViewKey } from '../../data/views';
import { depthOf } from '../../model/depth';
import { calcLinesFor } from '../../model/paramCalc';
import type { GameState, ParamDef } from '../../model/types';
import { fmt, rangeOf } from '../../utils/format';
import { MemoryBar } from '../dashboard/MemoryBar';
import { ObservePanel } from './ObservePanel';

interface ParamPanelProps {
  state: GameState;
  onStage: (p: ParamDef, v: string | number) => void;
  /** 打開診斷檢視（進階以上從晶片點入） */
  onOpenView?: (key: ViewKey) => void;
}

/**
 * 單一參數列：顯示目前值、參考檢視晶片、推算、生效時機。
 */
function ParamRow({
  p, state, onStage, onOpenView,
}: {
  p: ParamDef;
  state: GameState;
  onStage: (p: ParamDef, v: string | number) => void;
  onOpenView?: (key: ViewKey) => void;
}) {
  const kd = KIND[p.kind];
  const depth = depthOf(state.sc.tag);
  const base = p.kind === 'static' ? state.spfile[p.k] : state.mem[p.k];
  const cur = p.k in state.staged ? state.staged[p.k] : base;
  const staged = p.k in state.staged;
  const mem = state.mem[p.k];
  const sp = state.spfile[p.k];
  const calcs = calcLinesFor(p.k, state);

  // 狀態註記：deferred 倒數 / 參數檔差異 / 執行中值
  let note = '';
  let noteCls = '';
  if (p.k in state.pendDef) {
    note = `新連線陸續套用中，約 ${state.pendDef[p.k].left} 秒`;
    noteCls = 'warn';
  } else if (p.kind === 'static' && mem !== sp) {
    note = `執行中 ${fmt(p, mem)} → 參數檔已是 ${fmt(p, sp)}，重啟後生效`;
    noteCls = 'pend';
  } else if (p.kind !== 'static' && mem !== sp) {
    note = `執行中 ${fmt(p, mem)}，參數檔是 ${fmt(p, sp)}，重啟後會變回 ${fmt(p, sp)}`;
    noteCls = 'warn';
  } else {
    note = `執行中 ${fmt(p, mem)}`;
  }

  const [mn, mx, st] = p.type === 'seg' ? [0, 0, 0] : rangeOf(p, state.sc.w.ram);

  return (
    <div className={`prow${staged ? ' staged' : ''}`}>
      <div className="ptop">
        <label className="plabel" htmlFor={`in-${p.k}`}>
          {p.label}
          {staged && <span className="chip">已修改</span>}
        </label>
        <span className={`badge ${kd.cls}`}>{kd.text}</span>
      </div>
      <code className="pname">{p.name}</code>
      {(p.views?.length ?? 0) > 0 && (
        <div className="vtag-row" aria-label="參考檢視">
          {p.views!.map((v) => (
            <button
              key={v}
              type="button"
              className="vtag"
              title={VIEWS[v].zh}
              onClick={() => {
                // 入門：晶片僅提示來源，不開真表；進階以上打開抽屜
                if (depth === 'intro') return;
                onOpenView?.(v);
              }}
            >
              {VIEWS[v].name}
            </button>
          ))}
          {depth === 'intro' && (
            <span className="phint">進階關點這些徽章會打開對應的表</span>
          )}
        </div>
      )}
      <div className="pctl">
        {p.type === 'seg' ? (
          <div className="seg" role="group" aria-label={p.label}>
            {p.options!.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={String(cur) === v}
                onClick={() => onStage(p, v)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <input
              type="range"
              id={`in-${p.k}`}
              min={mn}
              max={mx}
              step={st}
              value={Number(cur)}
              aria-label={p.label}
              onChange={(e) => onStage(p, Number(e.target.value))}
            />
            <output htmlFor={`in-${p.k}`}>{fmt(p, cur)}</output>
          </>
        )}
      </div>
      {calcs.length > 0 && (
        <ul className="pcalc">
          {calcs.map((c) => (
            <li key={c.label} className={c.warn ? 'warn' : ''}>
              <span className="pcalc-label">{c.label}</span>
              <span className="pcalc-val">{c.value}</span>
              {c.note && <span className="pcalc-note">{c.note}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="phint">{p.hint}</p>
      <p className={`pnote ${noteCls}`}>{note}</p>
    </div>
  );
}

/** 畫出一個參數群組，不含記憶體儀表板 */
function GroupBlock({
  title, params, state, onStage, onOpenView,
}: {
  title: string;
  params: ParamDef[];
  state: GameState;
  onStage: (p: ParamDef, v: string | number) => void;
  onOpenView?: (key: ViewKey) => void;
}) {
  return (
    <section className="pgroup">
      <h3>{title}</h3>
      {params.map((p) => (
        <ParamRow key={p.k} p={p} state={state} onStage={onStage} onOpenView={onOpenView} />
      ))}
    </section>
  );
}

/** 依群組渲染可見參數（入門 focus／進階 basic+topic／專家全部） */
export function ParamPanel({ state, onStage, onOpenView }: ParamPanelProps) {
  const focus = state.sc.focus || [];
  const extra = state.sc.extra || [];
  return (
    <div className="params-wrap">
      <ObservePanel state={state} />
      {GROUPS.map((g) => {
        const params = PARAMS.filter(
          (p) => p.group === g.id && paramVisible(p, state.sc.tag, focus, extra),
        );
        if (params.length === 0) return null;
        const group = (
          <GroupBlock
            title={g.title}
            params={params}
            state={state}
            onStage={onStage}
            onOpenView={onOpenView}
          />
        );
        // 記憶體儀表板跟這組參數綁在一起，捲動時黏在這個區塊的上方
        if (g.id === 'mem') {
          return (
            <div key={g.id} className="mem-section">
              <div className="mem-sticky">
                <MemoryBar state={state} onOpenView={onOpenView} />
              </div>
              {group}
            </div>
          );
        }
        return <div key={g.id}>{group}</div>;
      })}
    </div>
  );
}
