# Oracle 調校室

互動式 Oracle 參數調校教學模擬器。左側看症狀（KPI、等待事件、記憶體），右側動手調參數，搞清楚哪些變更要重啟才會生效。

由原始單檔 HTML（`Oracle 調校室.html`）移植為 **Vite + React + TypeScript** 專案。

## 功能

- 課綱分層：入門（單參數教室 12 關）→ 進階（複合 6 關）→ 專家（4 關）→ 總驗收 → 大魔王（無票據／靜默診斷）
- 即時 / 新連線 / 需重啟 三種參數生效時機
- 效能模型：延遲、TPS、錯誤率、等待事件、FRA、RAC 節點故障
- 星等評分（達標、少重啟、參數持久化），進度存於 `localStorage`

## 開始使用

```bash
cd oracle-tuning-lab
npm install
npm run dev
```

瀏覽器開啟終端機顯示的本機網址即可。

```bash
npm run build    # 生產建置
npm run preview  # 預覽建置結果
```

## 專案結構

```
src/
  data/          # 參數定義、等待事件、分層關卡情境
  model/         # 型別與效能計算純函式
  hooks/         # useGame：模擬進程與遊戲狀態
  components/    # UI（儀表板、參數面板、過關彈層）
  utils/         # 格式化、localStorage
```

## 技術棧

- React 19 + TypeScript
- Vite 8
- 無額外 UI 函式庫（樣式自原始 HTML 移植）
