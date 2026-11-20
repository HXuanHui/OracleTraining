/**
 * 過關條件判定（故事卡與 checkGoal 共用，避免兩邊不一致）。
 */
import { plainCause } from './diagnostics';
import type { GameState, Metrics } from './types';

/** 單一條件的通過與否與說明 */
export interface GoalPart {
  /** 條件識別 */
  id: string;
  /** 是否通過 */
  ok: boolean;
  /** 未通過時給使用者看的短原因 */
  reason: string;
}

/** 整體達標結果 */
export interface GoalEval {
  /** 是否全部通過（可開始／繼續讀秒） */
  ok: boolean;
  /** 各條件明細 */
  parts: GoalPart[];
  /** 第一個未通過條件的原因；全過則為 null */
  blockedBy: string | null;
}

/**
 * 是否已無拒連／ORA 類失敗（對照 Alert Log，不是虛構的錯誤率百分比）。
 * @param m 目前效能快照
 * @returns 各失敗來源皆接近零時為 true
 */
function oraClear(m: Metrics): boolean {
  return Object.values(m.parts).every((v) => v <= 0.01);
}

/**
 * 依目前對局評估是否達標（與連續讀秒使用同一套規則）。
 * @param S 目前遊戲狀態
 * @returns 達標評估
 */
export function evaluateGoal(S: GameState): GoalEval {
  const g = S.sc.goal;
  const m = S.m;
  const nn = S.mem.cluster_db === 'TRUE' ? Number(S.mem.rac_nodes) : 1;

  if (!m || S.status !== 'open') {
    const part: GoalPart = {
      id: 'open',
      ok: false,
      reason: S.status === 'failed' ? '資料庫啟動失敗' : '資料庫尚未開放（重啟中）',
    };
    return { ok: false, parts: [part], blockedBy: part.reason };
  }

  const cause = plainCause(S);
  const parts: GoalPart[] = [
    {
      id: 'lat',
      ok: m.lat <= g.lat,
      reason: `回應時間 ${m.lat.toFixed(1)} ms，目標 ≤ ${g.lat} ms`,
    },
    {
      id: 'ora',
      ok: oraClear(m),
      reason: cause || '仍有拒連或 ORA 失敗，請對照 Alert Log',
    },
    {
      id: 'warm',
      ok: S.warm >= 0.9,
      reason: `快取預熱 ${Math.round(S.warm * 100)}%，需 ≥ 90% 才開始讀秒`,
    },
  ];

  if (g.archive) {
    parts.push({
      id: 'archive',
      ok: S.mem.archivelog === 'ARCHIVELOG',
      reason: '尚未開啟 ARCHIVELOG',
    });
  }
  if (g.minNodes || g.maxNodes) {
    const nodeOk = (!g.minNodes || nn >= g.minNodes) && (!g.maxNodes || nn <= g.maxNodes);
    parts.push({
      id: 'nodes',
      ok: nodeOk,
      reason: `叢集節點數目前 ${nn}，需要 ${g.minNodes || 1}–${g.maxNodes} 個`,
    });
  }
  // 節點數還在平滑加入時，nodesEff 可能暫時小於目標
  parts.push({
    id: 'nodesEff',
    ok: S.nodesEff >= nn - 0.01,
    reason: `節點尚未就緒（有效 ${S.nodesEff.toFixed(1)} / ${nn}）`,
  });

  const bad = parts.find((p) => !p.ok);
  return { ok: !bad, parts, blockedBy: bad ? bad.reason : null };
}
