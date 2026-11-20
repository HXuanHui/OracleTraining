/**
 * 事件紀錄列表（最近 7 筆）。
 */
import type { LogEntry } from '../../model/types';
import { mmss } from '../../utils/format';

interface EventLogProps {
  log: LogEntry[];
}

/** 事件紀錄卡片 */
export function EventLog({ log }: EventLogProps) {
  return (
    <section className="card">
      <h4>事件紀錄</h4>
      <ul className="log">
        {log.slice(0, 7).map((l, i) => (
          <li key={`${l.t}-${i}`}>
            <time>{mmss(l.t)}</time>
            <span className={l.level}>{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
