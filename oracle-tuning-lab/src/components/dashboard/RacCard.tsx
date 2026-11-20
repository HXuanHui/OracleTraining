/**
 * RAC 叢集節點狀態卡片（僅進階關卡顯示）。
 */
import type { GameState } from '../../model/types';

interface RacCardProps {
  state: GameState;
}

/** 叢集節點視覺化 */
export function RacCard({ state }: RacCardProps) {
  if (!(state.sc.extra || []).includes('cluster_db')) return null;

  const racOn = state.mem.cluster_db === 'TRUE';
  const target = racOn ? Number(state.mem.rac_nodes) : 1;
  const whole = Math.floor(state.nodesEff + 1e-9);
  const nodes = [];

  for (let i = 1; i <= target; i++) {
    let cls = 'up';
    let txt = '運作中';
    if (state.status !== 'open') { cls = ''; txt = '停止'; }
    else if (state.outage) { cls = 'fail'; txt = '故障'; }
    else if (i > whole) { cls = 'boot'; txt = '啟動中'; }
    else if (state.failing && i === whole) { cls = 'fail'; txt = '故障'; }
    nodes.push(
      <div key={i} className={`node ${cls}`}>
        <b>{racOn ? `節點 ${i}` : '單一執行個體'}</b>
        <span>{txt}</span>
      </div>,
    );
  }

  const m = state.m;
  const line = !racOn
    ? '目前是單一執行個體，這台壞了整個服務就停。'
    : `每個節點最多 ${Math.max(0, Number(state.mem.processes) - 40)} 個連線。` +
      (m ? `目前每個節點約 ${Math.round(m.users / Math.max(1, m.alive))} 位使用者。` : '');

  return (
    <section className="card">
      <h4>叢集節點</h4>
      <div className="nodes">{nodes}</div>
      <p className="phint" style={{ marginTop: 8 }}>{line}</p>
    </section>
  );
}
