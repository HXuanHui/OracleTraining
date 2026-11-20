/**
 * 等待事件 Top 5 列表。
 * 每一列可點，依難度打開說明或 V$SYSTEM_EVENT。
 * 標題固定顯示來源徽章（與 KPI 視覺統一）。
 */
import { WAITS } from '../../data/waits';
import type { Metrics } from '../../model/types';

interface WaitsProps {
  m: Metrics | null;
  outage: boolean;
  /** 關卡標籤（保留相容） */
  tag: string;
  /** 點擊某一列等待事件 */
  onProbe: (waitKey: string) => void;
}

/** 「資料庫都在等什麼」區塊 */
export function Waits({ m, outage, onProbe }: WaitsProps) {
  return (
    <section className="card">
      <div className="card-head">
        <h4>資料庫都在等什麼</h4>
        <span className="vtag">V$SYSTEM_EVENT</span>
      </div>
      {!m ? (
        <p className="phint">
          {outage ? '所有節點都停了，沒有任何服務在運作' : '資料庫沒有在運行'}
        </p>
      ) : (
        m.waits.slice(0, 5).map((x) => (
          <button
            key={x.k}
            type="button"
            className="wait"
            onClick={() => onProbe(x.k)}
            title="在 V$SYSTEM_EVENT 裡看這一列"
          >
            <div className="wn">
              <b>{WAITS[x.k]?.zh ?? x.k}</b>
              <code>{WAITS[x.k]?.en ?? ''}</code>
            </div>
            <span className="wp">{Math.round(x.pct * 100)}%</span>
            <div className="wb">
              <i style={{ width: `${Math.max(2, x.pct * 100).toFixed(1)}%` }} />
            </div>
          </button>
        ))
      )}
    </section>
  );
}
