/**
 * 情境切換：可收合的關卡清單，每列固定六關、不使用橫向捲軸。
 */
import { useState } from 'react';
import { SCENARIOS } from '../data/scenarios';

interface ScenarioTabsProps {
  /** 目前關卡索引 */
  scIndex: number;
  /** 各關星等 */
  stars: Record<string, number>;
  /** 切換關卡 */
  onSelect: (i: number) => void;
}

/** 關卡分組標題順序 */
const TAG_ORDER = ['入門', '進階', '專家', '總驗收', '大魔王'];

/** 每一列固定顯示的關卡數 */
const COLS = 6;

/**
 * 將關卡依 tag 分組成有序列表。
 * @returns 各組：標籤與該組在 SCENARIOS 中的索引
 */
function groupsOf(): { tag: string; indices: number[] }[] {
  const map = new Map<string, number[]>();
  SCENARIOS.forEach((sc, i) => {
    const list = map.get(sc.tag) || [];
    list.push(i);
    map.set(sc.tag, list);
  });
  return TAG_ORDER
    .filter((tag) => map.has(tag))
    .map((tag) => ({ tag, indices: map.get(tag)! }));
}

/**
 * 把索引陣列切成每列最多 COLS 個。
 * @param indices 該組關卡索引
 * @returns 列的二維陣列
 */
function chunkRows(indices: number[]): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < indices.length; i += COLS) {
    rows.push(indices.slice(i, i + COLS));
  }
  return rows;
}

/** 可收合的關卡分頁（每列六關） */
export function ScenarioTabs({ scIndex, stars, onSelect }: ScenarioTabsProps) {
  // 預設收合，避免佔掉儀表板空間；需要換關再展開
  const [open, setOpen] = useState(false);
  const groups = groupsOf();
  const cur = SCENARIOS[scIndex];
  const curStars = stars[cur.id] || 0;

  return (
    <nav className="tabs" aria-label="情境">
      <div className="tabs-bar">
        <div className="tabs-current">
          <span className="tag">{cur.tag}</span>
          <strong>{scIndex + 1}. {cur.title}</strong>
          <span className="st" aria-label={`${curStars} 顆星`}>
            {'★'.repeat(curStars)}{'☆'.repeat(3 - curStars)}
          </span>
        </div>
        <button
          type="button"
          className="btn ghost tabs-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起關卡' : '選擇關卡'}
        </button>
      </div>

      {open && (
        <div className="tabs-panel">
          {groups.map((g) => (
            <div key={g.tag} className="tab-group">
              <span className="tab-group-label">{g.tag}</span>
              {chunkRows(g.indices).map((row) => (
                <div
                  key={`${g.tag}-${row[0]}`}
                  className="tab-group-row"
                  style={{ ['--tab-cols' as string]: COLS }}
                >
                  {row.map((i) => {
                    const sc = SCENARIOS[i];
                    const n = stars[sc.id] || 0;
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        className="tab"
                        aria-current={i === scIndex ? 'true' : undefined}
                        onClick={() => {
                          onSelect(i);
                          // 換關後收合，把畫面還給儀表板
                          setOpen(false);
                        }}
                      >
                        <small>{i + 1}</small>
                        <b>{sc.title}</b>
                        <span className="st">{'★'.repeat(n)}{'☆'.repeat(3 - n)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
