/**
 * Oracle 調校室主應用：左側看症狀與終端機，右側調參數。
 * 伺服器記憶體黏在右側「記憶體」參數區塊的上方。
 */
import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ScenarioTabs } from './components/ScenarioTabs';
import { Chart } from './components/Chart';
import { StatusCard } from './components/dashboard/StatusCard';
import { Kpis } from './components/dashboard/Kpis';
import { RacCard } from './components/dashboard/RacCard';
import { FraCard } from './components/dashboard/FraCard';
import { Waits } from './components/dashboard/Waits';
import { EventLog } from './components/dashboard/EventLog';
import { TerminalLog } from './components/dashboard/TerminalLog';
import { DiagDrawer } from './components/dashboard/DiagDrawer';
import { Story } from './components/work/Story';
import { ParamPanel } from './components/work/ParamPanel';
import { ApplyBar } from './components/work/ApplyBar';
import { FileDrawer } from './components/work/FileDrawer';
import { WinOverlay } from './components/WinOverlay';
import { useGame } from './hooks/useGame';
import type { ViewKey } from './data/views';
import type { ProbeId } from './model/diagnostics';

/** 診斷抽屜開啟狀態：指標或直接指定檢視 */
type DiagOpen =
  | { kind: 'probe'; probe: ProbeId; focusWait?: string }
  | { kind: 'view'; view: ViewKey };

/** 應用根元件 */
export default function App() {
  const game = useGame();
  const { state } = game;
  const [diag, setDiag] = useState<DiagOpen | null>(null);
  const [file, setFile] = useState<'spfile' | 'pfile' | null>(null);

  // 換關時關掉對照與診斷，避免上一關的表還開著
  useEffect(() => {
    setDiag(null);
    setFile(null);
  }, [game.scIndex]);

  const openProbe = (id: ProbeId) => {
    setFile(null);
    setDiag({ kind: 'probe', probe: id });
  };

  const openView = (view: ViewKey) => {
    setFile(null);
    setDiag({ kind: 'view', view });
  };

  return (
    <div className="app">
      <Header
        speed={game.speed}
        onSpeed={game.setSpeed}
        onReset={game.reset}
      />
      <ScenarioTabs
        scIndex={game.scIndex}
        stars={game.stars}
        onSelect={game.loadScenario}
      />

      <div className="layout">
        {/* --- 左側：看症狀 --- */}
        <aside className="dash" aria-label="資料庫儀表板">
          <StatusCard
            state={state}
            speed={game.speed}
            onRetry={game.retryStart}
            onProbe={() => openProbe('status')}
          />
          <TerminalLog term={state.term} tag={state.sc.tag} />
          <Kpis
            m={state.m}
            goal={state.sc.goal}
            tag={state.sc.tag}
            onProbe={openProbe}
          />
          <section className="card">
            <h4>回應時間</h4>
            <Chart
              data={state.hist.map((h) => h.lat)}
              goal={state.sc.goal.lat}
              ariaLabel="回應時間走勢圖"
            />
          </section>
          <section className="card">
            <h4>每秒交易數</h4>
            <Chart
              data={state.hist.map((h) => h.tps)}
              ariaLabel="每秒交易數走勢圖"
              formatY={(v) => String(Math.round(v))}
            />
          </section>
          <RacCard state={state} />
          <FraCard state={state} onBackup={game.doBackup} />
          <Waits
            m={state.m}
            outage={state.outage}
            tag={state.sc.tag}
            onProbe={(k) => {
              setFile(null);
              setDiag({ kind: 'probe', probe: 'wait', focusWait: k });
            }}
          />
          <EventLog log={state.log} />
        </aside>

        {/* --- 右側：動手調 --- */}
        <main className="work">
          <Story
            state={state}
            need={game.needOf()}
            speed={game.speed}
            onHint={game.showHint}
          />
          <div className="guide" aria-label="標籤說明">
            <span>參數生效時機：</span>
            <span><span className="badge b-dyn">即時生效</span> 套用後馬上改變</span>
            <span><span className="badge b-def">新連線生效</span> 舊連線不受影響</span>
            <span><span className="badge b-static">需重啟</span> 重啟資料庫才會改變</span>
          </div>
          <div className="filebar" aria-label="參數檔">
            <button
              type="button"
              className="btn"
              aria-haspopup="dialog"
              onClick={() => { setDiag(null); setFile('spfile'); }}
            >
              SPFILE
            </button>
            <button
              type="button"
              className="btn"
              aria-haspopup="dialog"
              onClick={() => { setDiag(null); setFile('pfile'); }}
            >
              PFILE
            </button>
            <span>對照記憶體、參數檔、文字備份改了哪裡</span>
          </div>
          <ParamPanel state={state} onStage={game.setStaged} onOpenView={openView} />
          <ApplyBar
            state={state}
            baseVal={game.baseVal}
            onApply={game.applyChanges}
            onDiscard={game.discardChanges}
            onPersist={game.setPersist}
            onRequestRestart={game.requestRestart}
            onCancelRestart={game.cancelRestart}
            onConfirmRestart={game.confirmRestart}
          />
        </main>
      </div>

      {diag && (
        <DiagDrawer
          key={diag.kind === 'probe'
            ? `${diag.probe}:${diag.focusWait ?? ''}`
            : `view:${diag.view}`}
          state={state}
          probe={diag.kind === 'probe' ? diag.probe : null}
          initialView={diag.kind === 'view' ? diag.view : undefined}
          focusWait={diag.kind === 'probe' ? diag.focusWait : undefined}
          onClose={() => setDiag(null)}
          onViewed={game.markViewed}
        />
      )}
      {file && (
        <FileDrawer
          state={state}
          mode={file}
          onMode={setFile}
          onClose={() => setFile(null)}
        />
      )}

      {game.winOpen && (
        <WinOverlay
          state={state}
          scIndex={game.scIndex}
          need={game.needOf()}
          stars={game.stars}
          onClose={game.closeWin}
          onReset={game.reset}
          onNext={game.loadScenario}
        />
      )}
    </div>
  );
}
