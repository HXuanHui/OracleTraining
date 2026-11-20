/**
 * 伺服器記憶體使用條：OS / SGA / PGA / 預留 / 超額。
 * 標題旁固定 V$ 來源徽章，可點開對應診斷表。
 */
import type { ViewKey } from '../../data/views';
import type { GameState } from '../../model/types';

interface MemoryBarProps {
  state: GameState;
  /** 點徽章時打開診斷檢視 */
  onOpenView?: (key: ViewKey) => void;
}

/** 記憶體用量視覺化 */
export function MemoryBar({ state, onOpenView }: MemoryBarProps) {
  const sc = state.sc;
  const ram = sc.w.ram;
  const mem = state.mem;
  const max = Number(mem.sga_max_size);
  // ASMM：用 SGA_TARGET；手動（TARGET=0）：用各區塊加總（或效能快照的實際 SGA）
  const target = Number(mem.sga_target);
  const manual = target <= 0 || mem.asmm === 'OFF';
  const summed = Number(mem.shared_pool_size) + Number(mem.db_cache_size)
    + (Number(mem.large_pool_size) || 0) + (Number(mem.java_pool_size) || 0) + 0.25;
  const sga = Math.min(max, manual
    ? (state.m?.sga ?? summed)
    : target);
  const down = state.status !== 'open';
  const rsv = down ? 0 : Math.max(0, max - sga);
  const pgaV = down ? 0 : Number(mem.pga);
  const sgaV = down ? 0 : sga;
  const os = 1;
  const used = os + sgaV + pgaV;
  const over = Math.max(0, used - ram);
  const scale = Math.max(ram, used + (over ? 0 : rsv));
  const w = (v: number) => (v / scale * 100).toFixed(2) + '%';
  const free = Math.max(0, ram - used - rsv);
  const m = state.m;

  const open = (key: ViewKey) => {
    if (onOpenView) onOpenView(key);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h4>伺服器記憶體</h4>
        <div className="vtag-row" aria-label="來源檢視">
          <button type="button" className="vtag" title="實體記憶體與核心數" onClick={() => open('osstat')}>V$OSSTAT</button>
          <button type="button" className="vtag" title="SGA 各元件" onClick={() => open('sgainfo')}>V$SGAINFO</button>
          <button type="button" className="vtag" title="PGA 目標與溢寫" onClick={() => open('pgastat')}>V$PGASTAT</button>
        </div>
      </div>
      <div className="membar" role="img" aria-label="記憶體使用">
        <i className="m-os" style={{ width: w(os) }} />
        <i className="m-sga" style={{ width: w(sgaV) }} />
        <i className="m-pga" style={{ width: w(pgaV) }} />
        <i className="m-rsv" style={{ width: w(over ? 0 : Math.min(rsv, ram - used)) }} />
        {over > 0 && <i className="m-over" style={{ width: w(over) }} />}
      </div>
      <div className="legend">
        <span style={{ ['--c' as string]: 'var(--ink2)' }}>系統 1 GB</span>
        <span style={{ ['--c' as string]: 'var(--accent)' }}>SGA {sgaV.toFixed(1)} GB</span>
        <span style={{ ['--c' as string]: 'var(--ok)' }}>PGA {pgaV} GB</span>
        <span style={{ ['--c' as string]: 'var(--accent-bg)' }}>SGA 預留空間</span>
        <span style={{ ['--c' as string]: 'var(--line)' }}>剩餘 {free.toFixed(1)} GB / 共 {ram} GB</span>
      </div>
      {over > 0 && (
        <p className="memnote">超出實體記憶體 {over.toFixed(1)} GB，作業系統開始換頁</p>
      )}
      {(sc.extra || []).includes('asmm') && m && (
        <p className="phint">
          SGA 裡面：共用池 {m.sharedG.toFixed(1)} GB，資料快取 {m.cacheG.toFixed(1)} GB
          （{m.asmmOn ? 'ASMM 自動分配' : '手動固定大小（SGA_TARGET=0）'}）
        </p>
      )}
      {mem.cluster_db === 'TRUE' && (
        <p className="phint">叢集模式：每個節點各有一份 SGA 與 PGA。</p>
      )}
    </section>
  );
}
