/**
 * 遊戲狀態與模擬進程 Hook。
 * 負責一秒一格的 tick、參數套用、重啟流程、過關判定。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { byKey, suggestedViewsFor } from '../data/params';
import { SCENARIOS } from '../data/scenarios';
import { VIEWS } from '../data/views';
import { compute, fraTargetOf, startupCheck, validateSga } from '../model/compute';
import { depthOf, isSilent } from '../model/depth';
import { evaluateGoal } from '../model/goal';
import {
  backupTranscript,
  changeTranscript,
  failTranscript,
  flagAlert,
  fraWarn,
  mountTranscript,
  nodeBackAlert,
  nodeFailAlert,
  nomountTranscript,
  openTranscript,
  pendingTranscript,
  rejectTranscript,
  retryTranscript,
  shutdownTranscript,
  stampTranscript,
  welcomeTranscript,
  withAlert,
  type Scope,
} from '../model/transcript';
import type { ViewKey } from '../data/views';
import type {
  Config, GameState, LogEntry, LogLevel, MsgClass, ParamDef, Scenario,
} from '../model/types';
import { fmt } from '../utils/format';
import { loadStars, saveStars } from '../utils/storage';

/** 連續達標秒數：情境可覆寫，預設 15 */
function needOf(sc: Scenario): number {
  return sc.need || 15;
}

/**
 * 建立一關的初始遊戲狀態。
 * @param sc 情境定義
 */
function newState(sc: Scenario): GameState {
  const cfg0: Config = { ...sc.cfg };
  // 參數檔可含 spfileDiff（例如關卡預先寫入但尚未重啟的變更）
  const spfile: Config = Object.assign({}, cfg0, sc.spfileDiff || {});
  const boot = stampTranscript({ term: [], alert: [] }, 0, welcomeTranscript());
  return {
    sc, t: 0, status: 'open', left: 0,
    mem: { ...cfg0 },
    spfile,
    lastGood: { ...cfg0 },
    staged: {}, pendDef: {}, warm: 1, hist: [], streak: 0, restarts: 0, won: false,
    flags: {}, log: [], hintN: 0, persist: true, failMsg: '', m: null, confirm: false, msgs: [],
    nodesEff: sc.cfg.cluster_db === 'TRUE' ? Number(sc.cfg.rac_nodes) : 1,
    fraUsed: 0, backupCd: 0, failing: false, outage: false,
    viewed: [],
    term: boot.term,
    alert: boot.alert,
  };
}

/**
 * 載入情境並預填歷史圖資料（模擬過去 40 秒）。
 * @param i 情境索引
 */
function initScenario(i: number): GameState {
  const sc = SCENARIOS[i];
  const S = newState(sc);
  for (let t = -40; t < 0; t++) {
    const r = compute(S.mem, sc.w, t, 1);
    S.hist.push({ lat: r.lat, tps: r.tps });
  }
  S.hist = S.hist.slice(-30);
  S.m = compute(S.mem, sc.w, 0, 1);
  // 大魔王不給值班劇透，其餘關維持引導句
  S.log = [{
    t: 0,
    level: 'info',
    text: sc.silent || sc.tag === '大魔王'
      ? '監控已接通。無事故通報。'
      : '值班開始，先看看儀表板哪裡不對勁',
  }];
  // 接手時參數檔已有尚未重啟的變更，先寫進逐字稿，避免使用者以為是自己打的
  let files = { term: S.term, alert: S.alert };
  for (const k of Object.keys(S.spfile)) {
    if (S.spfile[k] === S.mem[k] || !byKey[k]) continue;
    const p = byKey[k];
    files = stampTranscript(files, 0, pendingTranscript(
      `接手時 SPFILE 尚未生效：${p.name} 參數檔 ${fmt(p, S.spfile[k])}，執行中 ${fmt(p, S.mem[k])}`,
      `WARNING: ${p.name} differs, SPFILE=${S.spfile[k]} memory=${S.mem[k]}, restart required`,
    ));
  }
  S.term = files.term;
  S.alert = files.alert;
  return S;
}

/**
 * 靜態參數取參數檔值，其餘取執行中記憶體值（作為「基準」比對 staged）。
 */
function baseVal(S: GameState, p: ParamDef): string | number {
  return p.kind === 'static' ? S.spfile[p.k] : S.mem[p.k];
}

/**
 * Oracle 調校室遊戲主 Hook。
 * @returns 狀態、星等、速度控制與所有操作函式
 */
export function useGame() {
  const [scIndex, setScIndex] = useState(0);
  const [state, setState] = useState<GameState>(() => initScenario(0));
  const [speed, setSpeed] = useState(1);
  const [stars, setStars] = useState<Record<string, number>>(() => loadStars());
  const [winOpen, setWinOpen] = useState(false);

  // 用 ref 持有最新 state，供 interval tick 讀取，避免閉包過期
  const stateRef = useRef(state);
  stateRef.current = state;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const starsRef = useRef(stars);
  starsRef.current = stars;
  const scIndexRef = useRef(scIndex);
  scIndexRef.current = scIndex;

  /** 在目前 state 前方插入一筆事件紀錄（最多保留 40 筆） */
  const pushLog = useCallback((S: GameState, level: LogLevel, text: string): LogEntry[] => {
    const log = [{ t: S.t, level, text }, ...S.log];
    if (log.length > 40) log.length = 40;
    return log;
  }, []);

  /**
   * 切換或重玩情境。
   * @param i 情境索引
   */
  const loadScenario = useCallback((i: number) => {
    setScIndex(i);
    setState(initScenario(i));
    setWinOpen(false);
  }, []);

  // --- 一秒一格的模擬：以 stateRef 推進，避免 setState updater 內做副作用 ---
  useEffect(() => {
    if (speed <= 0) return;
    const id = window.setInterval(() => {
      const result = tick(stateRef.current, pushLog, starsRef.current);
      stateRef.current = result.state;
      setState(result.state);
      if (result.starsUpdate) {
        starsRef.current = result.starsUpdate;
        setStars(result.starsUpdate);
        saveStars(result.starsUpdate);
      }
      if (result.didWin) setWinOpen(true);
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [speed, pushLog]);

  /**
   * 將參數寫入 staged（與基準相同則移除）。
   * SGA_TARGET 與 ASMM 連動：>0 → ASMM 開；=0 → 手動（ASMM 關）。
   */
  const setStaged = useCallback((p: ParamDef, v: string | number) => {
    setState((S) => {
      const staged = { ...S.staged };
      const put = (key: string, val: string | number) => {
        const def = byKey[key];
        if (!def) return;
        if (val === baseVal(S, def)) delete staged[key];
        else staged[key] = val;
      };

      put(p.k, v);

      // --- SGA_TARGET ↔ ASMM：真實 Oracle 就是用 SGA_TARGET=0 關 ASMM ---
      if (p.k === 'sga_target') {
        put('asmm', Number(v) > 0 ? 'ON' : 'OFF');
      } else if (p.k === 'asmm') {
        if (v === 'OFF') {
          put('sga_target', 0);
        } else {
          // 重新開啟時，若目前是 0，依固定區塊加總補一個合理目標
          const effective = Number(
            staged.sga_target !== undefined ? staged.sga_target : S.mem.sga_target,
          );
          if (effective <= 0) {
            const floor = Number(S.mem.shared_pool_size) + Number(S.mem.db_cache_size) + 0.5;
            put('sga_target', Math.min(Math.max(floor, 1), Number(S.mem.sga_max_size)));
          }
        }
      }

      return { ...S, staged, msgs: [] };
    });
  }, []);

  /** 套用所有 staged 變更（依 kind 寫入 mem / spfile / pendDef） */
  const applyChanges = useCallback(() => {
    setState((S) => {
      const msgs: [MsgClass, string][] = [];
      const mem = { ...S.mem };
      const spfile = { ...S.spfile };
      const staged = { ...S.staged };
      const pendDef = { ...S.pendDef };
      const memKeys = ['asmm', 'sga_target', 'shared_pool_size', 'db_cache_size'];
      const blocked = new Set<string>();
      const overMax = (k: string) => k === 'sga_target' && Number(staged[k]) > Number(mem.sga_max_size);

      // SGA 相關變更先做一致性驗證，失敗則整批阻擋
      if (S.status === 'open' && memKeys.some((k) => k in staged)) {
        const cand = { ...mem };
        memKeys.forEach((k) => { if (k in staged && !overMax(k)) cand[k] = staged[k]; });
        const v = validateSga({ ...cand, sga_target: Math.min(Number(cand.sga_target), Number(cand.sga_max_size)) });
        if (!v.ok) {
          memKeys.forEach((k) => { if (k in staged && !overMax(k)) blocked.add(k); });
          msgs.push(['e', v.msg!]);
        }
      }

      let log = S.log;
      let term = S.term;
      let alert = S.alert;
      for (const k of Object.keys(staged)) {
        if (blocked.has(k)) continue;
        const p = byKey[k];
        if (!p) continue;
        const v = staged[k];
        const name = p.label;
        const previous = mem[k];
        let applied: Scope | null = null;
        if (p.kind === 'static') {
          spfile[k] = v;
          applied = 'SPFILE';
          msgs.push(['i', `${name} 已寫入參數檔，重啟後才會生效`]);
          // PROCESSES 調高時，若 SESSIONS 會小於它，依 Oracle 預設公式一併寫入，避免入門關看不到 SESSIONS 卻重啟失敗
          if (k === 'processes' && Number(spfile.sessions) < Number(v)) {
            const autoSess = Math.floor(Number(v) * 1.5 + 22);
            spfile.sessions = autoSess;
            msgs.push(['i', `SESSIONS 已依預設調成 ${autoSess}（約 PROCESSES×1.5+22），同樣需重啟`]);
          }
        } else if (S.status !== 'open') {
          spfile[k] = v;
          applied = 'SPFILE';
          msgs.push(['i', `資料庫沒在運行，${name} 只寫入參數檔`]);
        } else if (k === 'sga_target' && Number(v) > Number(mem.sga_max_size)) {
          if (S.persist) {
            spfile[k] = v;
            applied = 'SPFILE';
            msgs.push(['i', `${name} 超過目前 SGA 上限 ${mem.sga_max_size} GB，已寫入參數檔，重啟後生效`]);
          } else {
            const err = `${name} 不能超過 SGA 上限 ${mem.sga_max_size} GB。要調高上限得先重啟`;
            msgs.push(['e', err]);
            const rejected = stampTranscript({ term, alert }, S.t, rejectTranscript(err));
            term = rejected.term;
            alert = rejected.alert;
            continue;
          }
        } else if (p.kind === 'dynamic') {
          mem[k] = v;
          if (S.persist) spfile[k] = v;
          applied = S.persist ? 'BOTH' : 'MEMORY';
          msgs.push(
            k === 'rac_nodes' && mem.cluster_db !== 'TRUE'
              ? ['i', `${name} 已設定，要等叢集模式啟用（需重啟）後才有作用`]
              : ['o', `${name} 已即時生效` + (S.persist ? '' : '（未保存，重啟會消失）')],
          );
          const entry: LogEntry = { t: S.t, level: 'info', text: `${name} 即時調整為 ${fmt(p, v)}` };
          log = [entry, ...log].slice(0, 40);
        } else {
          // deferred：約 6 秒後才套用到新連線
          pendDef[k] = { v, left: 6 };
          if (S.persist) spfile[k] = v;
          applied = S.persist ? 'BOTH' : 'MEMORY';
          msgs.push(['i', `${name} 只對新連線生效，舊連線陸續換新`]);
        }
        // 成功寫入的項目才留下 ALTER SYSTEM；被拒絕的留在 staged
        if (applied) {
          const stamped = stampTranscript({ term, alert }, S.t, changeTranscript(p, v, applied, mem, previous));
          term = stamped.term;
          alert = stamped.alert;
        }
        delete staged[k];
      }

      if (blocked.size) {
        const err = msgs.find((m) => m[0] === 'e')?.[1];
        if (err) {
          const rejected = stampTranscript({ term, alert }, S.t, rejectTranscript(err));
          term = rejected.term;
          alert = rejected.alert;
        }
      }

      let m = S.m;
      if (S.status === 'open') {
        const r = compute(mem, S.sc.w, S.t, S.warm, { nodes: S.nodesEff, fraUsed: S.fraUsed });
        m = r.outage ? null : r;
      }

      // --- 進階：溫和提醒尚未打開建議檢視（不阻擋套用） ---
      if (depthOf(S.sc.tag) === 'mid' && !isSilent(S.sc)) {
        const suggest = suggestedViewsFor(S.sc.focus || []);
        const missing = suggest.filter((v) => !S.viewed.includes(v));
        if (missing.length > 0) {
          const names = missing.slice(0, 3).map((v) => VIEWS[v].name).join('、');
          msgs.push(['i', `提醒：建議先看 ${names}${missing.length > 3 ? '…' : ''} 再調。這次已套用，不阻擋。`]);
        }
      }

      return { ...S, mem, spfile, staged, pendDef, msgs, log, m, term, alert };
    });
  }, []);

  const discardChanges = useCallback(() => {
    setState((S) => ({ ...S, staged: {}, msgs: [] }));
  }, []);

  const setPersist = useCallback((persist: boolean) => {
    setState((S) => ({ ...S, persist }));
  }, []);

  const requestRestart = useCallback(() => {
    setState((S) => ({ ...S, confirm: true }));
  }, []);

  const cancelRestart = useCallback(() => {
    setState((S) => ({ ...S, confirm: false }));
  }, []);

  /** 開始重啟：關閉 → nomount → mount → open/failed */
  const confirmRestart = useCallback(() => {
    setState((S) => {
      const files = stampTranscript(S, S.t, shutdownTranscript());
      return {
        ...S,
        ...files,
        confirm: false,
        restarts: S.restarts + 1,
        status: 'stopping',
        left: 2,
        streak: 0,
        pendDef: {},
        log: pushLog(S, 'warn', '資料庫正在關閉，所有連線中斷'),
      };
    });
  }, [pushLog]);

  /**
   * 啟動失敗後重試。
   * @param useBackup true 時改用上次成功的參數檔（PFILE）
   */
  const retryStart = useCallback((useBackup: boolean) => {
    setState((S) => {
      const files = stampTranscript(S, S.t, retryTranscript(useBackup));
      let spfile = S.spfile;
      let log = S.log;
      if (useBackup) {
        spfile = { ...S.lastGood };
        log = pushLog(S, 'info', '改用備份參數檔（PFILE）啟動');
      }
      return {
        ...S, ...files, spfile, log,
        restarts: S.restarts + 1,
        status: 'nomount',
        left: 2,
        confirm: false,
      };
    });
  }, [pushLog]);

  const showHint = useCallback(() => {
    setState((S) => {
      if (S.hintN >= S.sc.hints.length) return S;
      return { ...S, hintN: S.hintN + 1 };
    });
  }, []);

  /** 手動備份並清除歸檔（救急，有冷卻） */
  const doBackup = useCallback(() => {
    setState((S) => {
      if (S.status !== 'open' || S.backupCd !== 0 || S.mem.archivelog !== 'ARCHIVELOG') return S;
      const files = stampTranscript(S, S.t, backupTranscript());
      return {
        ...S,
        ...files,
        fraUsed: S.fraUsed * 0.35,
        backupCd: 12,
        log: pushLog(S, 'ok', '已備份並清除歸檔日誌，快速復原區釋出空間（只是暫時）'),
      };
    });
  }, [pushLog]);

  const closeWin = useCallback(() => setWinOpen(false), []);

  /**
   * 記錄本關已打開過的診斷檢視（去重）。
   * @param key 檢視鍵
   */
  const markViewed = useCallback((key: ViewKey) => {
    setState((S) => {
      if (S.viewed.includes(key)) return S;
      return { ...S, viewed: [...S.viewed, key] };
    });
  }, []);

  return {
    state,
    scIndex,
    speed,
    setSpeed,
    stars,
    winOpen,
    closeWin,
    loadScenario,
    reset: () => loadScenario(scIndex),
    setStaged,
    applyChanges,
    discardChanges,
    setPersist,
    requestRestart,
    cancelRestart,
    confirmRestart,
    retryStart,
    showHint,
    doBackup,
    markViewed,
    baseVal: (p: ParamDef) => baseVal(state, p),
    needOf: () => needOf(state.sc),
  };
}

export type UseGameReturn = ReturnType<typeof useGame>;

/** tick 回傳：新狀態，以及可選的星等／過關副作用 */
interface TickResult {
  state: GameState;
  starsUpdate: Record<string, number> | null;
  didWin: boolean;
}

/**
 * 推進一格模擬時間，回傳新狀態（純計算，不觸發 React setState）。
 * 處理啟動流程、deferred 參數、叢集節點、FRA、旗標與過關。
 */
function tick(
  S: GameState,
  pushLog: (S: GameState, level: LogLevel, text: string) => LogEntry[],
  currentStars: Record<string, number>,
): TickResult {
  let next: GameState = {
    ...S,
    t: S.t + 1,
    hist: [...S.hist],
    log: [...S.log],
    term: [...S.term],
    alert: [...S.alert],
    flags: { ...S.flags },
    pendDef: { ...S.pendDef },
  };
  let starsUpdate: Record<string, number> | null = null;
  let didWin = false;

  if (['stopping', 'nomount', 'mount'].includes(next.status)) {
    next.m = null;
    next.hist.push({ lat: null, tps: 0 });
    next = advanceStartup(next, pushLog);
  } else if (next.status === 'failed') {
    next.m = null;
    next.hist.push({ lat: null, tps: 0 });
  } else {
    next.warm = Math.min(1, next.warm + 0.05);

    // deferred 參數倒數套用
    for (const k of Object.keys(next.pendDef)) {
      next.pendDef[k] = { ...next.pendDef[k], left: next.pendDef[k].left - 1 };
      if (next.pendDef[k].left <= 0) {
        next.mem = { ...next.mem, [k]: next.pendDef[k].v };
        delete next.pendDef[k];
        next.log = pushLog(next, 'ok', `${byKey[k].label} 已套用到新連線`);
      }
    }

    next = stepCluster(next, pushLog);

    const r = compute(next.mem, next.sc.w, next.t, next.warm, { nodes: next.nodesEff, fraUsed: next.fraUsed });
    const wasFail = next.failing;
    next.failing = !!r.failing;
    next.outage = !!r.outage;

    if (next.failing && !wasFail) {
      next.log = pushLog(
        next,
        r.outage ? 'crit' : 'warn',
        r.outage
          ? '伺服器故障，單一執行個體整個停擺，服務中斷'
          : `一個節點故障，剩下 ${Math.round(r.alive)} 個節點接手`,
      );
      const down = nodeFailAlert(!!r.outage, Math.round(r.alive));
      next.alert = withAlert(next.alert, next.t, down.level, down.text);
    }
    if (!next.failing && wasFail) {
      next.log = pushLog(next, 'ok', r.outage ? '服務恢復' : '故障的節點已重新加入叢集');
      // 用故障前的 outage 判斷是整站恢復還是節點重新加入
      const back = nodeBackAlert(S.outage);
      next.alert = withAlert(next.alert, next.t, back.level, back.text);
    }

    if (r.outage) {
      next.m = null;
      next.streak = 0;
      next.hist.push({ lat: null, tps: 0 });
    } else {
      next.m = r;
      next.hist.push({ lat: r.lat, tps: r.tps });
      next = watchFlags(next, pushLog);
      const goal = checkGoal(next, currentStars);
      next = goal.state;
      starsUpdate = goal.starsUpdate;
      didWin = goal.didWin;
    }
  }

  if (next.hist.length > 60) next.hist = next.hist.slice(-60);
  return { state: next, starsUpdate, didWin };
}

/** 推進重啟狀態機：stopping → nomount → mount → open/failed */
function advanceStartup(
  S: GameState,
  pushLog: (S: GameState, level: LogLevel, text: string) => LogEntry[],
): GameState {
  const next = { ...S, left: S.left - 1 };
  if (next.left > 0) return next;

  if (next.status === 'stopping') {
    const files = stampTranscript(next, next.t, nomountTranscript());
    return { ...next, ...files, status: 'nomount', left: 2, log: pushLog(next, 'info', '啟動執行個體，讀取參數檔') };
  }
  if (next.status === 'nomount') {
    const files = stampTranscript(next, next.t, mountTranscript());
    return { ...next, ...files, status: 'mount', left: 2, log: pushLog(next, 'info', '掛載資料庫') };
  }
  if (next.status === 'mount') {
    const chk = startupCheck(next.spfile, next.sc.w);
    if (chk.ok) {
      const prev = { ...next.mem };
      const mem = { ...next.spfile } as Config;
      mem.sga_target = Math.min(Number(mem.sga_target), Number(mem.sga_max_size));
      let log = next.log;
      const archive = prev.archivelog !== mem.archivelog ? String(mem.archivelog) : null;
      if (archive) {
        log = pushLog(
          next,
          'ok',
          mem.archivelog === 'ARCHIVELOG' ? '已在掛載階段切換為歸檔模式' : '已在掛載階段切換為非歸檔模式',
        );
      }
      const nodesEff = mem.cluster_db === 'TRUE' ? Number(mem.rac_nodes) : 1;
      const clusterNodes = mem.cluster_db === 'TRUE' ? Number(mem.rac_nodes) : null;
      if (mem.cluster_db === 'TRUE' && prev.cluster_db !== 'TRUE') {
        log = pushLog({ ...next, log }, 'ok', `叢集已啟動，${mem.rac_nodes} 個節點上線`);
      }
      const spfile = { ...next.spfile, sga_target: mem.sga_target };
      log = pushLog({ ...next, log }, 'ok', '資料庫已開放。資料快取是空的，需要預熱');
      const files = stampTranscript(next, next.t, openTranscript({ archive, clusterNodes }));
      return {
        ...next, ...files, mem, spfile, nodesEff, log,
        // PRE_PAGE_SGA=TRUE 時啟動就把 SGA 載入實體記憶體，預熱起點較高
        status: 'open', warm: mem.pre_page_sga === 'TRUE' ? 0.45 : 0.05, lastGood: { ...spfile }, streak: 0,
      };
    }
    const files = stampTranscript(next, next.t, failTranscript(chk.msg || ''));
    return {
      ...next,
      ...files,
      status: 'failed',
      failMsg: chk.msg || '',
      log: pushLog(next, 'crit', chk.msg || ''),
    };
  }
  return next;
}

/** 平滑調整叢集節點數，並推進 FRA 用量 */
function stepCluster(
  S: GameState,
  pushLog: (S: GameState, level: LogLevel, text: string) => LogEntry[],
): GameState {
  const racOn = S.mem.cluster_db === 'TRUE';
  const target = racOn ? Number(S.mem.rac_nodes) : 1;
  const old = S.nodesEff;
  const nodesEff = old < target ? Math.min(target, old + 0.2) : target;
  let log = S.log;
  const a = Math.floor(nodesEff + 1e-9);
  const b = Math.floor(old + 1e-9);
  if (a > b) log = pushLog({ ...S, nodesEff }, 'ok', `節點 ${a} 已加入叢集`);
  if (a < b) log = pushLog({ ...S, nodesEff }, 'warn', `節點數降為 ${a}`);

  let fraUsed = S.fraUsed;
  if (S.mem.archivelog === 'ARCHIVELOG') {
    fraUsed += (fraTargetOf(S.mem, S.sc.w) - fraUsed) * 0.02;
  } else {
    fraUsed = 0;
  }
  const backupCd = S.backupCd > 0 ? S.backupCd - 1 : 0;
  return { ...S, nodesEff, fraUsed, backupCd, log };
}

/** 監控錯誤旗標，進出時寫入事件紀錄 */
function watchFlags(
  S: GameState,
  pushLog: (S: GameState, level: LogLevel, text: string) => LogEntry[],
): GameState {
  if (!S.m) return S;
  const m = S.m;
  const p = m.parts;
  let flags = { ...S.flags };
  let log = S.log;
  let alert = S.alert;

  const flag = (key: string, on: boolean, bad: string, good: string) => {
    if (on && !flags[key]) {
      flags = { ...flags, [key]: 1 };
      log = pushLog({ ...S, log }, 'crit', bad);
      const a = flagAlert(key, S.mem);
      if (a) alert = withAlert(alert, S.t, a.level, a.text);
    } else if (!on && flags[key]) {
      flags = { ...flags, [key]: 0 };
      log = pushLog({ ...S, log }, 'ok', good);
    }
  };

  flag('conn', p.conn > 0.01, '連線被拒絕：已達 PROCESSES 上限 (ORA-00020)', '連線數恢復正常');
  flag('cur', p.cur > 0.01, '游標數超過上限，部分交易失敗 (ORA-01000)', '游標錯誤已消失');
  flag('snap', p.snap > 0.01, '報表因快照太舊而失敗 (ORA-01555)', '報表不再因快照太舊失敗');
  flag('undo', p.undo > 0.01, 'Undo 空間被保留時間塞滿 (ORA-30036)', 'Undo 空間恢復');
  flag('swap', m.swap, '實體記憶體不足，系統開始換頁，所有東西都變慢', '記憶體壓力解除');
  flag('spill', m.spill > 0.3, '大量排序溢出到磁碟', '排序回到記憶體內');
  flag('shared', p.shared > 0.01, '共用池不足，無法配置共用記憶體 (ORA-04031)', '共用池夠用了');
  flag('arch', m.fraFull, '快速復原區已滿，所有寫入被卡住 (ORA-00257)', '快速復原區有空間了，寫入恢復');
  flag(
    'archwait',
    S.mem.archivelog === 'ARCHIVELOG' && m.waits.some((x) => x.k === 'archwait' && x.pct > 0.2),
    '歸檔速度跟不上，交易在等歸檔程序',
    '歸檔速度跟上了',
  );

  const near = S.mem.archivelog === 'ARCHIVELOG' && !m.fraFull && m.fraUsed >= Number(S.mem.fra_size) * 0.8;
  if (near && !flags.fraNear) {
    flags = { ...flags, fraNear: 1 };
    log = pushLog({ ...S, log }, 'warn', '快速復原區已用超過 80%');
    const pct = Number(S.mem.fra_size) > 0 ? (m.fraUsed / Number(S.mem.fra_size)) * 100 : 0;
    const a = fraWarn(pct);
    alert = withAlert(alert, S.t, a.level, a.text);
  } else if (!near) {
    flags = { ...flags, fraNear: 0 };
  }

  return { ...S, flags, log, alert };
}

/** 檢查是否連續達標；回傳新狀態與可選的星等／過關標記 */
function checkGoal(
  S: GameState,
  currentStars: Record<string, number>,
): { state: GameState; starsUpdate: Record<string, number> | null; didWin: boolean } {
  if (!S.m || S.won) {
    return { state: S, starsUpdate: null, didWin: false };
  }
  const ok = evaluateGoal(S).ok;
  const streak = ok ? S.streak + 1 : 0;
  if (streak < needOf(S.sc)) {
    return { state: { ...S, streak }, starsUpdate: null, didWin: false };
  }

  // --- 過關：計算星等（達標 + 少重啟 + 參數已持久化） ---
  const keys = Object.keys(S.mem);
  const saved = keys.every((k) => S.mem[k] === S.spfile[k]) && Object.keys(S.pendDef).length === 0;
  const few = S.restarts <= S.sc.maxRestarts;
  const n = 1 + (few ? 1 : 0) + (saved ? 1 : 0);
  const starsUpdate = { ...currentStars, [S.sc.id]: Math.max(currentStars[S.sc.id] || 0, n) };
  return { state: { ...S, streak, won: true }, starsUpdate, didWin: true };
}
