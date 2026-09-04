# Mockup 決策

## Metadata

- 功能：UI 設計系統 — Sidebar 導覽圖示化
- 畫面：設計師後台 `components/ui/Sidebar.tsx` 導覽項目
- 決策負責人：使用者
- 狀態：已選定

## 變體

| 變體 | 說明 | 優點 | 風險 |
|---|---|---|---|
| A | 延續現況：保留右側 3px primary 邊框＋淺底色的既有 active 語言，只加 20px 前綴圖示、字級 `subtitle2`→`subtitle1`（14→16px） | 改動最小、與 `Nav.tsx` 既有 active 視覺語言一致、風險最低 | 圖示沒有額外強調，使用中狀態的辨識度提升有限 |
| B | 整列圓角底色：拿掉右側邊框，使用中項目整列套用 `primary.50` 圓角底＋圖示文字轉 `primary.700`，比照 shadcn-admin／TailAdmin 常見寫法 | 更像現代 admin dashboard、辨識度較 A 高 | 與既有 Sidebar／Nav 的「右側邊框＝使用中」語言不一致，兩處會不同調；新用到 `primary.50` 色階（既有 token，非新增，但 Sidebar 首次使用） |
| C | 圖示徽章容器＋加大留白：圖示固定包在 32×32 圓角容器，預設弱化底色、使用中整塊轉 `primary.500` 實心底＋白色圖示；item 內距加大到 12/20px | 三者中「使用中」辨識度最高，最貼近 S2 選定參考產品 Fresha／Aesop 的沉穩留白感 | 目前 Sidebar 寬度固定 200px，視覺稍擁擠，可能需一併把寬度調到 220–232px（見下方待釐清問題） |

Mockup 檔案：
- `ai/artifacts/專案設置/mockups/sidebar-nav-variant-a.html`
- `ai/artifacts/專案設置/mockups/sidebar-nav-variant-b.html`
- `ai/artifacts/專案設置/mockups/sidebar-nav-variant-c.html`

## 設計系統對照

- 重用的 token／元件：`grey`/`primary` 10 階（含 dark colorScheme）、`typography.subtitle1`（16px）、既有間距 scale、`radius.sm`；三個變體皆重用 `components/ui/Sidebar.tsx` 既有結構，不新增獨立元件
- 新做並登記回 inventory 的元件：無獨立新元件；圖示為內嵌於 `Sidebar.tsx` 的 6 個手繪 SVG（比照 `ColorModeToggle.tsx` 慣例），完成後更新 `design-system.md` S4 inventory 既有 Sidebar 列的說明文字

## 待釐清問題

- 圖示來源已預先定案為「手繪 SVG（比照 `ColorModeToggle.tsx`，不安裝 `@mui/icons-material`）」，避免為 6 個圖示新增相依套件；若人工希望改用現成 icon library，需另外評估。
- 變體 C 若選定，Sidebar 寬度是否從 200px 調整到 220–232px 需要一併決定（影響 `app/admin` 系列頁面主內容區的可用寬度）。
- 6 個手繪圖示（calendar／scissors／clock／clipboard-check／storefront／user-circle）的具體造型是否符合品牌調性，需人工過目確認，非本階段自動判定範圍。

## 選定的變體

- 變體：A（延續現況＋前綴圖示）
- 為何選這個：改動最小、與 `Nav.tsx` 既有 active 視覺語言一致，符合「優先採用既有專案模式，而非新增抽象層」的專案原則；B／C 改變既有右側邊框 active 語言或需連動調整 Sidebar 寬度，非必要的額外變動。
- 實作前要求的修改（皆取自既有 type scale／spacing scale，非新增 token）：
  - 導覽項目文字：18px（`typeScale.fontSize.lg`），取代 mockup 原提案的 16px（`subtitle1`）。
  - 導覽項目圖示：22px，取代 mockup 原提案的 20px。
  - 導覽項目垂直間距加大：`py` 由現行 5px（`spacing(1.25)`）加大到 16px（`spacing(4)`），讓項目之間視覺上更寬鬆。
  - Sidebar 標題「理髮廳後台」：文字加大到 20px（`typeScale.fontSize.xl`），字重維持既有 700（bold，原本已是粗體，本次沿用不變）。

## 人工核准

- 核准者：使用者
- 日期：2026-09-05
- 備註：核准 Variant A 並套用上述尺寸調整；圖示來源維持手繪 SVG（比照 `ColorModeToggle.tsx`），不安裝 `@mui/icons-material`。

## 後續修訂（v2，同日）

實作完成、人工於 `/admin` 實際看過後，覺得字級與間距偏大，要求再縮小一版：

| 項目 | v1（已核准） | v2（本次修訂） |
|---|---|---|
| 導覽項目文字 | 18px（`typeScale.fontSize.lg`） | 16px（`typeScale.fontSize.md`） |
| 導覽項目圖示 | 22px | 20px |
| 導覽項目垂直間距（`py`） | 16px（`spacing(4)`） | 12px（`spacing(3)`） |
| Sidebar 標題「理髮廳後台」 | 20px（`typeScale.fontSize.xl`） | 18px（`typeScale.fontSize.lg`） |

對照 mockup：`ai/artifacts/專案設置/mockups/sidebar-nav-variant-a-v2.html`（現況 vs 調整後並列對照，亮／暗色皆有）。

- 核准者：使用者
- 日期：2026-09-05
- 備註：先產出對照圖確認 OK 後才動工，符合流程要求；圖示與圖示間距（`gap`）在實作時一併從 12px 收斂到 8px（`spacing(2)`），維持 4 的倍數間距紀律（原提案的 10px 不在 spacing scale 內，實作時已修正，非人工另外要求）。
