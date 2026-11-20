/**
 * 參數即時推算：只放模型算得出的合理範圍與 Undo 空間公式。
 * 供 ParamRow、ObservePanel 顯示，不影響過關門檻。
 */
import type { GameState } from './types';

/** 單一推算列的顯示結果 */
export interface CalcLine {
  /** 標題（例如「建議 PROCESSES」） */
  label: string;
  /** 目前算出的值 */
  value: string;
  /** 是否偏離合理範圍（用來上色） */
  warn?: boolean;
  /** 補充說明 */
  note?: string;
}

/**
 * 依參數鍵名組出可顯示的推算列。
 * 沒有公式的參數回傳空陣列。
 * @param key 參數鍵
 * @param state 目前對局（含 staged 時用 staged 值）
 * @returns 推算列
 */
export function calcLinesFor(key: string, state: GameState): CalcLine[] {
  const w = state.sc.w;
  const staged = state.staged;
  const mem = state.mem;
  const val = (k: string) => (k in staged ? staged[k] : mem[k]);
  const cores = w.cores;
  const ram = w.ram;
  const users = w.users;
  const lines: CalcLine[] = [];

  if (key === 'processes') {
    // 業務規則：系統背景約佔 40；使用者數 + 40 才是下限
    const need = users + 40;
    const cur = Number(val('processes'));
    lines.push({
      label: '建議下限',
      value: `${need}（使用者 ${users} + 背景 ≈ 40）`,
      warn: cur < need,
      note: cur < need ? '目前低於同時上線需求，會拒連。' : undefined,
    });
  }

  if (key === 'sessions') {
    const proc = Number(val('processes'));
    const def = Math.floor(proc * 1.5 + 22);
    const cur = Number(val('sessions'));
    lines.push({
      label: '常見預設',
      value: `${def}（PROCESSES × 1.5 + 22）`,
      warn: cur < users + 40,
    });
  }

  if (key === 'sga_target' || key === 'sga_max_size' || key === 'pga') {
    const sga = Number(val('sga_target')) || Number(val('sga_max_size'));
    const pga = Number(val('pga'));
    const used = 1 + sga + pga;
    const headroom = ram * 0.8;
    lines.push({
      label: '記憶體總帳',
      value: `系統 1 + SGA ${sga} + PGA ${pga} = ${used.toFixed(1)} GB / RAM ${ram} GB`,
      warn: used > headroom,
      note: used > headroom
        ? '建議合計低於實體 RAM 約 80%，否則容易換頁。'
        : `熱資料約 ${w.workingSet} GB，快取至少要蓋得住。`,
    });
  }

  if (key === 'dbwr') {
    const cur = Number(val('dbwr'));
    const rule = Math.max(1, Math.floor(cores / 8));
    lines.push({
      label: '經驗值',
      value: `MAX(1, TRUNC(CPU/8)) ≈ ${rule}；上限勿超過核心數 ${cores}`,
      warn: cur > cores,
      note: cur > cores ? '超過核心數通常沒好處，還會互搶。' : undefined,
    });
  }

  if (key === 'pms') {
    const cur = Number(val('pms'));
    const sweet = cores * 2;
    lines.push({
      label: '甜蜜點',
      value: `約核心數 × 2 = ${sweet}（目前 ${cores} 核）`,
      warn: cur === 0 || cur > sweet * 1.5,
      note: cur === 0 ? '設成 0 等於關掉平行。' : undefined,
    });
  }

  if (key === 'undo_retention') {
    const retention = Number(val('undo_retention'));
    const reportDur = state.m?.reportDur ?? 0;
    const undoMBps = w.undoMBps || 0;
    const space = w.undoSpace || 0;
    // 業務規則：需要空間 = 保留秒數 × 每秒 Undo；不能只拿平均值當正式配置
    const need = retention * undoMBps;
    const snapRisk = reportDur > 0 && retention < reportDur;
    const spaceRisk = undoMBps > 0 && space > 0 && need > space;
    lines.push({
      label: '最長報表',
      value: reportDur > 0 ? `${Math.round(reportDur)} 秒` : '本關無長報表',
      warn: snapRisk,
      note: snapRisk
        ? 'UNDO_RETENTION 短於報表 → 可能 ORA-01555（快照太舊）。'
        : undefined,
    });
    if (undoMBps > 0) {
      lines.push({
        label: '推算 Undo 空間',
        value: `${retention} 秒 × ${undoMBps} MB/s = ${need.toFixed(0)} MB` +
          (space > 0 ? `（表空間 ${space} MB）` : ''),
        warn: spaceRisk,
        note: spaceRisk
          ? '推算需求超過表空間 → 可能 ORA-30036。實際還要留尖峰餘裕。'
          : 'UNDO_RETENTION 是期望值；TUNED_UNDORETENTION 才是動態調整後的實際保留。',
      });
    }
  }

  if (key === 'open_cursors') {
    const need = w.cursorsNeed || 0;
    const cur = Number(val('open_cursors'));
    if (need > 0) {
      lines.push({
        label: '應用同時開游標',
        value: `約 ${need}；目前上限 ${cur}`,
        warn: cur < need,
      });
    }
  }

  if (key === 'fra_size' || key === 'arch_keep') {
    const redo = w.redoMBps || 0;
    const keep = Number(val('arch_keep'));
    const fra = Number(val('fra_size'));
    // 粗估：每小時歸檔 ≈ redoMBps × 3600 / 1024 GB
    const perHour = (redo * 3600) / 1024;
    const need = perHour * keep;
    lines.push({
      label: 'FRA 粗估',
      value: `≈ ${perHour.toFixed(1)} GB/時 × ${keep} 時 = ${need.toFixed(0)} GB（目前 FRA ${fra} GB）`,
      warn: need > fra * 0.9,
    });
  }

  return lines;
}
