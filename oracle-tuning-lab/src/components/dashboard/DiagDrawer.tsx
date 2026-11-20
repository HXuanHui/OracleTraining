/**
 * 左側指標／參數晶片的診斷抽屜。
 * 入門只講原因；進階開中文欄名的 V$；專家開原始欄名。
 */
import { useEffect, useRef, useState } from 'react';
import { suggestedViewsFor } from '../../data/params';
import { WAITS } from '../../data/waits';
import { VIEWS, type ViewKey } from '../../data/views';
import {
  PROBE_SQL,
  diagAdvice,
  tableOf,
  undoReadCard,
  viewOf,
  type DiagTable,
  type ProbeId,
  type ViewId,
} from '../../model/diagnostics';
import { depthOf, isSilent } from '../../model/depth';
import type { GameState } from '../../model/types';
import { alertStamp, latTxt } from '../../utils/format';

interface DiagDrawerProps {
  /** 目前對局 */
  state: GameState;
  /** 使用者點的左側指標；從參數晶片開時可為 null */
  probe: ProbeId | null;
  /** 直接指定要開的檢視（參數晶片／記憶體條） */
  initialView?: ViewId;
  /** 從某一列等待事件點進來時的鍵名 */
  focusWait?: string;
  /** 關閉抽屜 */
  onClose: () => void;
  /** 記錄已查看的檢視 */
  onViewed?: (key: ViewKey) => void;
}

/** 進階預設分頁（完整清單過長時用捲動） */
const MID_TABS: ViewId[] = [
  'sysmetric', 'resource', 'session', 'event', 'osstat',
  'sgainfo', 'pgastat', 'sysstat', 'undostat', 'undots',
  'recovery', 'instance_recovery', 'open_cursor', 'px_process',
  'gv_instance', 'parameter', 'alert',
];

/**
 * 入門抽屜的標題。
 * @param probe 左側指標
 * @returns 中文標題
 */
function introTitle(probe: ProbeId | null): string {
  switch (probe) {
    case 'lat': return '為什麼回應時間訂在這個數字';
    case 'tps': return '每秒交易數在看什麼';
    case 'hit': return '快取命中率在看什麼';
    case 'status': return '現在資料庫停在哪一步';
    case 'wait': return '這個等待是什麼意思';
    case 'mem': return '伺服器記憶體在看什麼';
    default: return '說明';
  }
}

/**
 * 入門：用現在的狀態說明啟動步驟，並對上終端機會出現的指令。
 * @param state 目前對局
 * @returns 一段說明
 */
function statusText(state: GameState): string {
  switch (state.status) {
    case 'open':
      return state.outage
        ? '服務中斷。單一執行個體沒有別的節點可以接手。'
        : '資料庫在 OPEN，使用者連得進來。若要重啟，終端機會先出現 SHUTDOWN IMMEDIATE，其中 Database dismounted 就是卸載。';
    case 'stopping':
      return '正在關閉。指令是 SHUTDOWN IMMEDIATE。你會先看到 Database closed，接著 Database dismounted（卸載），最後 ORACLE instance shut down。';
    case 'nomount':
      return '執行個體已經起來，還沒掛上資料檔。這一步是 STARTUP NOMOUNT。參數檔在這時候被讀走。';
    case 'mount':
      return '資料庫已掛載，還沒開放給使用者。歸檔模式要在這一步、OPEN 之前切換：先 ALTER DATABASE MOUNT，之後才 ALTER DATABASE OPEN。';
    case 'failed':
      return '執行個體沒有開起來。先看終端機上的 ORA 訊息，再用 PFILE（上次成功的文字備份）啟動，而不是沿用剛才那份 SPFILE。';
    default:
      return '';
  }
}

/** 檢視表格。沒有列時改顯示一句話。 */
function Grid({ table }: { table: DiagTable }) {
  if (table.rows.length === 0) {
    return <p className="phint">這一秒沒有資料。</p>;
  }
  return (
    <div className="table-wrap">
      <table className="vgrid">
        <thead>
          <tr>
            {table.headers.map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={r.hot ? 'hot' : ''}>
              {r.cells.map((c, j) => <td key={j}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 診斷對話框。
 * @param state 目前對局
 * @param probe 左側指標
 * @param initialView 直接指定檢視
 * @param focusWait 要標出的等待事件
 * @param onClose 關閉
 * @param onViewed 記錄已查看
 */
export function DiagDrawer({
  state, probe, initialView, focusWait, onClose, onViewed,
}: DiagDrawerProps) {
  const depth = depthOf(state.sc.tag);
  const silent = isSilent(state.sc);
  const suggested = suggestedViewsFor(state.sc.focus || []);
  const [view, setView] = useState<ViewId>(() => {
    if (initialView) return initialView;
    if (probe) return viewOf(probe, state);
    return suggested[0] || 'sysmetric';
  });
  const alertBox = useRef<HTMLUListElement>(null);
  const expert = depth === 'expert';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (view === 'alert' && alertBox.current) {
      alertBox.current.scrollTop = alertBox.current.scrollHeight;
    }
  }, [view, state.alert.length]);

  // 進階以上：打開就記一筆已查看
  useEffect(() => {
    if (depth !== 'intro' && onViewed) onViewed(view);
  }, [view, depth, onViewed]);

  const latNow = state.m
    ? `${latTxt(state.m.lat).v} ${latTxt(state.m.lat).u}`
    : '—';
  const waitRow = focusWait ? state.m?.waits.find((w) => w.k === focusWait) : undefined;
  const waitPct = waitRow ? `這一秒它佔了 ${Math.round(waitRow.pct * 100)}%。` : '';
  const table = view === 'alert' ? null : tableOf(view, state, expert, focusWait);
  const readCard = !silent && depth === 'mid' && (view === 'undostat' || view === 'undots')
    ? undoReadCard(state)
    : null;

  // 分頁：建議的放前面並標亮
  const tabs = MID_TABS.filter((t) => {
    // 精簡：RAC／平行／復原等只在相關關或建議時出現，其餘常駐核心表
    const always = new Set<ViewId>([
      'sysmetric', 'resource', 'session', 'event', 'osstat',
      'sgainfo', 'pgastat', 'sysstat', 'undostat', 'undots', 'alert',
    ]);
    if (always.has(t) || suggested.includes(t)) return true;
    if (t === 'recovery' && (state.mem.archivelog === 'ARCHIVELOG' || suggested.includes('recovery'))) return true;
    if (t === 'gv_instance' && state.mem.cluster_db === 'TRUE') return true;
    if (t === 'px_process' && Number(state.mem.pms) >= 0 && (state.sc.focus || []).includes('pms')) return true;
    if (t === 'open_cursor' && (state.sc.focus || []).includes('open_cursors')) return true;
    if (t === 'instance_recovery' && (state.sc.focus || []).includes('fast_start_mttr_target')) return true;
    if (t === 'parameter' && expert) return true;
    return false;
  });

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="win diag"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diag-title"
        onClick={(e) => e.stopPropagation()}
      >
        {depth === 'intro' ? (
          <>
            <h2 id="diag-title">{introTitle(probe)}</h2>
            {probe === 'lat' && (
              <>
                <p>現在 {latNow}，目標是 {state.sc.goal.lat} ms 以內。</p>
                <p className="goal-why">{state.sc.why.lat}</p>
                <p className="phint">真實環境這個數字來自 <span className="vtag">V$SYSMETRIC</span>（SQL Service Response Time）。進階關會打開真表。</p>
              </>
            )}
            {probe === 'tps' && (
              <>
                <p>這是每秒真正做完的交易。人被 PROCESSES 擋在門外，或每一筆變很慢，這個數字都會掉。它不是過關門檻，是用來確認人進得來、而且每筆沒有卡住。</p>
                <p className="phint">來源 <span className="vtag">V$SYSMETRIC</span>：User Transaction Per Sec。連線被拒時改看 <span className="vtag">V$RESOURCE_LIMIT</span>。</p>
              </>
            )}
            {probe === 'hit' && (
              <>
                <p>快取命中率高，表示資料大多從記憶體讀到，不必去磁碟。偏低時，等待事件裡的 db file sequential read（單區塊讀取）會變多，回應時間就跟著上去。</p>
                <p className="phint">來源 <span className="vtag">V$SYSMETRIC</span>：Buffer Cache Hit Ratio。</p>
              </>
            )}
            {probe === 'status' && <p>{statusText(state)}</p>}
            {probe === 'wait' && (
              <p>
                {focusWait && WAITS[focusWait]
                  ? `「${WAITS[focusWait].zh}」在真實等待事件裡叫做 ${WAITS[focusWait].en}。`
                  : '這些是資料庫這一秒把時間花在哪裡。'}
                {waitPct}
                {' '}來源 <span className="vtag">V$SYSTEM_EVENT</span>。
              </p>
            )}
            {probe === 'mem' && (
              <p>
                這條把實體 RAM、SGA、PGA 畫在一起。調記憶體參數前先看會不會超過機器。
                來源 <span className="vtag">V$OSSTAT</span>、<span className="vtag">V$SGAINFO</span>、<span className="vtag">V$PGASTAT</span>。
              </p>
            )}
            {!probe && initialView && (
              <p>
                入門關先記這些數字的意義。完整表格會在進階以後打開：
                <span className="vtag">{VIEWS[initialView]?.name}</span>
              </p>
            )}
            <p className="footnote">進階以後，點同一個位置會打開對應的 V$ 檢視與 Alert Log。</p>
          </>
        ) : (
          <>
            <h2 id="diag-title">{VIEWS[view]?.name ?? view}</h2>
            {!silent && depth === 'mid' && suggested.length > 0 && (
              <p className="goal-next">
                建議觀察順序：
                {suggested.map((v, i) => (
                  <span key={v}>
                    {i > 0 ? ' → ' : ' '}
                    <button
                      type="button"
                      className={`vtag${view === v ? ' on' : ''}`}
                      onClick={() => setView(v)}
                    >
                      {VIEWS[v].name}
                    </button>
                  </span>
                ))}
              </p>
            )}
            {!silent && probe === 'lat' && view === 'sysmetric' && <p className="goal-why">{state.sc.why.lat}</p>}
            {!silent && probe === 'hit' && view === 'sysmetric' && (
              <p className="goal-why">命中率低的時候，db file sequential read 和 db file scattered read 的佔比會升高。</p>
            )}
            {!silent && probe === 'tps' && (view === 'session' || view === 'resource' || view === 'sysmetric') && (
              <p className="goal-why">交易數上不去時，先確認人有沒有連進來，以及 processes 有沒有頂滿。</p>
            )}
            {!silent && probe === 'status' && view === 'alert' && (
              <p className="goal-why">啟動、關閉和 ORA 錯誤會寫進這份文字檔。你下的指令在左側終端機，不在這裡。</p>
            )}
            {!silent && probe === 'wait' && focusWait && view === 'event' && (
              <p className="goal-why">已標出 {WAITS[focusWait]?.en ?? focusWait}。佔比是這一秒的時間組成。</p>
            )}
            {!silent && diagAdvice(state) && <p className="advice">{diagAdvice(state)}</p>}
            {!silent && readCard && <p className="advice">{readCard}</p>}
            {!silent && (
              <p className="goal-next">
                {expert
                  ? '排查順序：V$SYSMETRIC → V$RESOURCE_LIMIT → V$SESSION → V$SYSTEM_EVENT → V$UNDOSTAT → 表空間 → Alert Log。'
                  : '先看這張結果。上方標籤可以換到下一張檢視。建議的分頁已標亮。'}
              </p>
            )}
            <div className="probe-tabs">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn${suggested.includes(t) ? ' suggest' : ''}`}
                  aria-pressed={view === t}
                  onClick={() => setView(t)}
                >
                  {VIEWS[t].name}
                </button>
              ))}
            </div>
            <p className="footnote">{expert ? 'SQL' : '會下的查詢'}</p>
            <pre className="sql">{PROBE_SQL[view]}</pre>
            {view === 'alert' ? (
              <>
                <ul className="alertlog" ref={alertBox}>
                  {state.alert.map((a, i) => (
                    <li key={`${a.t}-${i}`} className={a.level}>
                      <time>{alertStamp(a.t)}</time>
                      <span>{a.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="footnote">這是 alert log 的摘錄，不是 V$ 檢視。時間用實驗室的時鐘。</p>
              </>
            ) : (
              <>
                {table && <Grid table={table} />}
                {table && <p className="footnote">{table.footnote}</p>}
              </>
            )}
          </>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
