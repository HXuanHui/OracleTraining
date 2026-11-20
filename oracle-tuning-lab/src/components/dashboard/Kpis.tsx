/**
 * KPI 三格：回應時間、TPS、快取命中率。
 * 三層難度皆顯示 V$ 來源徽章；點下去依難度打開說明或真表。
 */
import type { ProbeId } from '../../model/diagnostics';
import type { Goal, Metrics } from '../../model/types';
import { latTxt } from '../../utils/format';

interface KpisProps {
  m: Metrics | null;
  goal: Goal;
  /** 關卡標籤（保留相容；來源徽章一律顯示） */
  tag: string;
  /** 點擊某一格 */
  onProbe: (id: ProbeId) => void;
}

/** 單一 KPI 磁磚。整格可點，右上角固定 V$ 徽章。 */
function Tile({
  label, val, unit, state, sub, source, onClick,
}: {
  label: string;
  val: string;
  unit: string;
  state: string;
  sub: string;
  /** 來源檢視名稱 */
  source: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`kpi vtile k-${state}`}
      onClick={onClick}
      title={`打開 ${source}`}
    >
      <span className="kpi-top">
        <span className="kl">{label}</span>
        <span className="vtag">{source}</span>
      </span>
      <b className="kv">{val}<small>{unit}</small></b>
      <span className="ks">{sub}</span>
    </button>
  );
}

/** KPI 網格 */
export function Kpis({ m, goal, onProbe }: KpisProps) {
  // 連線被拒絕時，交易數先對到 V$RESOURCE_LIMIT
  const tpsView = m && m.parts.conn > 0.01 ? 'V$RESOURCE_LIMIT' : 'V$SYSMETRIC';

  if (!m) {
    return (
      <section className="kpis" aria-label="效能指標">
        <Tile label="回應時間" val="—" unit="" state="none" sub={`目標 ≤ ${goal.lat} ms`} source="V$SYSMETRIC" onClick={() => onProbe('lat')} />
        <Tile label="每秒交易數" val="0" unit="TPS" state="none" sub="" source={tpsView} onClick={() => onProbe('tps')} />
        <Tile label="快取命中率" val="—" unit="" state="none" sub="" source="V$SYSMETRIC" onClick={() => onProbe('hit')} />
      </section>
    );
  }

  const l = latTxt(m.lat);
  const ls = m.lat <= goal.lat ? 'ok' : m.lat <= goal.lat * 2.5 ? 'warn' : 'crit';
  const hs = m.hit >= 0.9 ? 'ok' : m.hit >= 0.7 ? 'warn' : 'crit';

  return (
    <section className="kpis" aria-label="效能指標">
      <Tile label="回應時間" val={l.v} unit={l.u} state={ls} sub={`目標 ≤ ${goal.lat} ms`} source="V$SYSMETRIC" onClick={() => onProbe('lat')} />
      <Tile label="每秒交易數" val={String(Math.round(m.tps))} unit="TPS" state="none" sub={`連線 ${Math.round(m.connected)} / ${m.users}`} source={tpsView} onClick={() => onProbe('tps')} />
      <Tile
        label="快取命中率"
        val={(m.hit * 100).toFixed(1)}
        unit="%"
        state={hs}
        sub={`硬解析 ${Math.round(m.hardPerSec)} 次/秒 · CPU ${Math.round(m.cpuUtil * 100)}%`}
        source="V$SYSMETRIC"
        onClick={() => onProbe('hit')}
      />
    </section>
  );
}
