/**
 * 資料庫狀態卡片：運行燈號、啟動步驟、啟動失敗重試。
 * 點燈號列會依難度說明這一步，或打開 Alert Log。
 */
import type { GameState } from '../../model/types';
import { mmss } from '../../utils/format';

interface StatusCardProps {
  state: GameState;
  speed: number;
  onRetry: (useBackup: boolean) => void;
  /** 點擊狀態列 */
  onProbe: () => void;
}

/** 左側儀表板頂部狀態區 */
export function StatusCard({ state, speed, onRetry, onProbe }: StatusCardProps) {
  const st = state.status;
  const idx = ({ stopping: 0, nomount: 1, mount: 2, open: 3, failed: -1 } as const)[st];
  const lamp = st === 'open'
    ? (state.outage ? 'crit' : state.failing ? 'warn' : '')
    : st === 'failed' ? 'crit' : 'warn';
  const names = ['關閉', '啟動執行個體', '掛載資料庫', '開放使用'];
  const label = {
    open: state.outage ? '服務中斷（伺服器故障）' : state.failing ? '運行中（一個節點故障）' : '運行中',
    stopping: '正在關閉',
    nomount: '正在啟動',
    mount: '正在掛載',
    failed: '無法啟動',
  }[st];
  const extra = st === 'open'
    ? (state.warm < 1 ? `快取預熱 ${Math.round(state.warm * 100)}%` : `已執行 ${mmss(state.t)}`)
    : '';

  return (
    <section className="card">
      <button
        type="button"
        className="stat-top stat-hit"
        onClick={onProbe}
        title="打開 Alert Log／啟動步驟說明"
      >
        <i className={`lamp ${lamp}`} />
        <b>{label}</b>
        <span>{extra}</span>
        {speed === 0 && <span>（模擬已暫停）</span>}
        <span className="vtag">Alert Log</span>
      </button>
      <ol className="steps" style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
        {names.map((n, i) => (
          <li
            key={n}
            className={
              st === 'open' ? 'on' : i < idx ? 'on' : i === idx ? 'cur' : ''
            }
          >
            {n}
          </li>
        ))}
      </ol>
      {st === 'failed' && (
        <div className="failbox">
          <p>{state.failMsg}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => onRetry(false)}>
              用目前參數檔再試
            </button>
            <button type="button" className="btn primary" onClick={() => onRetry(true)}>
              用備份參數檔啟動
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
