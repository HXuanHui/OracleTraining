/**
 * SVG 折線圖：回應時間 / TPS 走勢。
 */
import { latTxt, niceMax } from '../utils/format';

interface ChartProps {
  /** 時間序列資料；null 表示該點無資料（重啟中斷） */
  data: (number | null)[];
  /** 目標線數值（可選） */
  goal?: number;
  /** 可存取標籤 */
  ariaLabel: string;
  /** Y 軸格式化；省略時使用 latTxt 風格 */
  formatY?: (v: number) => string;
}

/**
 * 繪製歷史走勢圖。
 * 斷點（null）會切開折線區段。
 */
export function Chart({ data, goal, ariaLabel, formatY }: ChartProps) {
  const fy = formatY || ((v: number) => {
    const t = latTxt(v);
    return t.v + t.u;
  });

  const W = 400, H = 120, L = 44, R = 10, T = 10, B = 14;
  const pw = W - L - R, ph = H - T - B;
  const vals = data.filter((v): v is number => v != null);
  const mx = Math.max(1e-9, ...vals, goal || 0);
  const top = niceMax(Math.max(mx * 1.15, goal ? goal * 1.8 : 0));
  const X = (i: number) => L + (i + (60 - data.length)) / 59 * pw;
  const Y = (v: number) => T + ph - Math.min(v, top) / top * ph;

  const grid = [0, 0.5, 1].map((f) => {
    const y = T + ph - f * ph;
    return (
      <g key={f}>
        <line className="gl" x1={L} x2={W - R} y1={y} y2={y} />
        <text className="tx" x={L - 5} y={y + 3} textAnchor="end">{fy(top * f)}</text>
      </g>
    );
  });

  // 依 null 切開折線區段
  const segments: [number, number][][] = [];
  let seg: [number, number][] = [];
  data.forEach((v, i) => {
    if (v == null) {
      if (seg.length) { segments.push(seg); seg = []; }
    } else {
      seg.push([X(i), Y(v)]);
    }
  });
  if (seg.length) segments.push(seg);
  const last = segments.length ? segments[segments.length - 1][segments[segments.length - 1].length - 1] : null;

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {grid}
      {goal != null && (
        <>
          <line className="gd" x1={L} x2={W - R} y1={Y(goal)} y2={Y(goal)} />
          <text className="gt" x={W - R} y={Y(goal) - 4} textAnchor="end">目標</text>
        </>
      )}
      {segments.map((s, i) => {
        const pts = s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        return (
          <g key={i}>
            <polygon
              className="ar"
              points={`${s[0][0].toFixed(1)},${T + ph} ${pts} ${s[s.length - 1][0].toFixed(1)},${T + ph}`}
            />
            <polyline className="ln" points={pts} />
          </g>
        );
      })}
      {last && <circle className="dot" cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="4" />}
    </svg>
  );
}
