/**
 * SQL*Plus 逐字稿。
 * 入門與進階看得到註解，專家只留指令與伺服器回應。
 */
import { useEffect, useRef } from 'react';
import { depthOf } from '../../model/depth';
import { termVisible } from '../../model/transcript';
import type { TermLine } from '../../model/types';

interface TerminalLogProps {
  /** 累積的終端機列 */
  term: TermLine[];
  /** 關卡難度標籤 */
  tag: string;
}

/**
 * 左側終端機卡片。新指令進來時捲到最底。
 * @param term 逐字稿
 * @param tag 關卡標籤，用來決定要不要顯示註解
 * @returns 終端機卡片
 */
export function TerminalLog({ term, tag }: TerminalLogProps) {
  const depth = depthOf(tag);
  const lines = term.filter((l) => termVisible(l, depth));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, lines[lines.length - 1]?.text]);

  return (
    <section className="card" aria-label="終端機">
      <h4>{depth === 'expert' ? 'SQL*Plus' : '終端機'}</h4>
      {depth !== 'expert' && (
        <p className="phint">關閉、掛載、卸載和 ALTER SYSTEM 會留在這裡。</p>
      )}
      <div className="term" ref={box} role="log" aria-live="polite" aria-relevant="additions">
        {lines.map((l, i) => (
          <div key={`${l.t}-${i}`} className={l.kind}>{l.text}</div>
        ))}
      </div>
    </section>
  );
}
