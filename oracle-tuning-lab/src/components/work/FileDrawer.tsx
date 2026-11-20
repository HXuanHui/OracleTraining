/**
 * SPFILE／PFILE 對照。
 * 三欄分別是執行中的記憶體、重啟會讀的 SPFILE、上次成功啟動的文字備份。
 * 不論關卡難度，一律列出全部參數（可用「只看不一樣的列」縮小範圍）。
 */
import { useEffect, useState } from 'react';
import { PARAMS } from '../../data/params';
import { depthOf } from '../../model/depth';
import type { GameState, ParamDef } from '../../model/types';
import { fmt } from '../../utils/format';

interface FileDrawerProps {
  /** 目前對局，提供 mem／spfile／lastGood */
  state: GameState;
  /** 使用者按的是哪一顆按鈕，用來標出要對的那一欄 */
  mode: 'spfile' | 'pfile';
  /** 在抽屜裡改看另一份檔 */
  onMode: (mode: 'spfile' | 'pfile') => void;
  /** 關閉抽屜 */
  onClose: () => void;
}

interface FileRow {
  p: ParamDef;
  mem: string | number | undefined;
  sp: string | number | undefined;
  pf: string | number | undefined;
}

/** 兩個值是否不同。缺值也算不同，避免靜默漏列。 */
function ne(a: string | number | undefined, b: string | number | undefined): boolean {
  return String(a) !== String(b);
}

/** 這列三份裡是否有任何不一致 */
function dirty(row: FileRow): boolean {
  return ne(row.mem, row.sp) || ne(row.sp, row.pf) || ne(row.mem, row.pf);
}

/**
 * 說明這一列差在哪。專家用欄位代號，入門與進階用中文。
 * @param p 參數定義
 * @param row 三份的值
 * @param expert 是否為專家深度
 * @returns 說明文字，沒有差異時是空字串
 */
function explain(p: ParamDef, row: FileRow, expert: boolean): string {
  const memSp = ne(row.mem, row.sp);
  const spPf = ne(row.sp, row.pf);
  if (!memSp && !spPf && !ne(row.mem, row.pf)) return '';
  if (expert) {
    const bits: string[] = [];
    if (memSp) bits.push('MEM≠SPFILE');
    if (spPf) bits.push('SPFILE≠PFILE');
    return bits.join(' ');
  }
  const bits: string[] = [];
  if (memSp) {
    bits.push(p.kind === 'static'
      ? '已寫入 SPFILE，重啟後記憶體才會變成這份'
      : '記憶體和 SPFILE 不同，重啟會以 SPFILE 為準');
  }
  if (spPf) bits.push('PFILE 備份和現在的 SPFILE 不同，用備份啟動會回到 PFILE');
  return bits.join('。');
}

/** 參數值的顯示。缺值用破折號，避免 fmt 收到 undefined。 */
function show(p: ParamDef, v: string | number | undefined): string {
  if (v === undefined) return '—';
  return fmt(p, v);
}

/**
 * 對照抽屜上方的說明，依難度與目前按鈕改變。
 * @param depth 說明深度
 * @param mode 目前對的是 SPFILE 還是 PFILE
 * @returns 一段說明
 */
function fileBlurb(depth: ReturnType<typeof depthOf>, mode: 'spfile' | 'pfile'): string {
  const base = '記憶體是現在生效的值，SPFILE 是重啟時會讀的參數檔，PFILE 是上次成功啟動留下的文字備份。';
  if (depth === 'intro') {
    return base + (mode === 'spfile'
      ? '有顏色的格子代表這一格跟另一份不一樣。需要重啟的參數常常先寫進 SPFILE。'
      : '有顏色的格子代表文字備份和現在的檔案不一樣。用備份啟動會回到 PFILE。');
  }
  if (depth === 'mid') {
    return base + '左側終端機是剛才的 ALTER SYSTEM。SCOPE=SPFILE 只會改到 SPFILE 這一欄。';
  }
  return 'V$PARAMETER 對記憶體，V$SPPARAMETER 對 SPFILE。PFILE 欄是 init_lastgood.ora。';
}

/**
 * 參數檔對照對話框。
 * @param state 目前對局
 * @param mode 要強調的檔案
 * @param onMode 切換 SPFILE／PFILE
 * @param onClose 關閉
 * @returns 對話框
 */
export function FileDrawer({ state, mode, onMode, onClose }: FileDrawerProps) {
  const depth = depthOf(state.sc.tag);
  // 預設只看差異；取消勾選即可瀏覽全部參數（不受入門 focus 過濾）
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rows: FileRow[] = PARAMS.filter((p) => {
    const mem = state.mem[p.k];
    const sp = state.spfile[p.k];
    const pf = state.lastGood[p.k];
    return mem !== undefined || sp !== undefined || pf !== undefined;
  }).map((p) => ({
    p,
    mem: state.mem[p.k],
    sp: state.spfile[p.k],
    pf: state.lastGood[p.k],
  }));
  const shown = onlyDiff ? rows.filter(dirty) : rows;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="win diag"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="file-title">{mode === 'spfile' ? 'SPFILE' : 'PFILE'}</h2>
        <p className="goal-why">{fileBlurb(depth, mode)}</p>
        <div className="probe-tabs">
          <button type="button" className="btn" aria-pressed={mode === 'spfile'} onClick={() => onMode('spfile')}>
            SPFILE
          </button>
          <button type="button" className="btn" aria-pressed={mode === 'pfile'} onClick={() => onMode('pfile')}>
            PFILE
          </button>
        </div>
        <label className="persist">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          只看不一樣的列（{rows.filter(dirty).length} / {rows.length} 項）
        </label>
        {shown.length === 0 ? (
          <p className="phint">記憶體、SPFILE、PFILE 目前一樣。</p>
        ) : (
          <div className="table-wrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th>參數</th>
                  <th>記憶體</th>
                  <th className={mode === 'spfile' ? 'col-focus' : ''}>SPFILE</th>
                  <th className={mode === 'pfile' ? 'col-focus' : ''}>PFILE</th>
                  <th>{depth === 'expert' ? '差異' : '說明'}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.p.k}>
                    <td>
                      <b>{row.p.label}</b>
                      <code className="pname">{row.p.name}</code>
                    </td>
                    <td className={ne(row.mem, row.sp) || ne(row.mem, row.pf) ? 'cell-diff' : ''}>{show(row.p, row.mem)}</td>
                    <td className={ne(row.mem, row.sp) || ne(row.sp, row.pf) ? 'cell-diff' : ''}>{show(row.p, row.sp)}</td>
                    <td className={ne(row.sp, row.pf) || ne(row.mem, row.pf) ? 'cell-diff' : ''}>{show(row.p, row.pf)}</td>
                    <td>{explain(row.p, row, depth === 'expert')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
