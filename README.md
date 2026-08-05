# 理髮廳線上預約系統

技術棧：Next.js（App Router + TypeScript）、Supabase、部署於 Vercel。

專案的治理流程（Epic/User Story/Task 拆解、審查關卡）見 [`AGENTS.md`](AGENTS.md) 與 `ai/`；看板見 [`tools/kanban/README.md`](tools/kanban/README.md)。

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm install` | 安裝相依套件 |
| `npm run dev` | 啟動本機開發伺服器（<http://localhost:3000>） |
| `npm run build` | 建置正式環境版本 |
| `npm start` | 啟動已建置版本 |
| `npm run lint` | 執行 ESLint |
| `npx tsc --noEmit` | TypeScript 型別檢查 |
| `npm test` | 執行單元測試（Vitest） |
| `npm run kanban` | 啟動治理看板（<http://127.0.0.1:4420>） |

## 環境變數

複製 `.env.example` 為 `.env.local` 並填入真實值；**真實金鑰只存放在 Vercel 專案的環境變數設定，絕不提交進版控**（`.gitignore` 已排除 `.env` 與 `.env.*`）。

| 變數 | 用途 | 是否可暴露於前端 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案網址 | 是 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名金鑰，受 RLS 規則限制 | 是 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 具完整權限的服務金鑰，僅限伺服器端程式碼使用 | **否，絕不可** |
| `EMAIL_API_KEY` | 寄送預約確認信／提醒信的服務金鑰（服務商待「Email 通知與提醒」Epic 選定） | 否 |
| `EMAIL_FROM_ADDRESS` | 通知信寄件人地址 | 否 |
| `NEXT_PUBLIC_SITE_URL` | 對外基底網址，用於組出 email 中的預約連結 | 是 |

## 部署

部署目標為 Vercel，將此 repo 連接到 Vercel 專案即可，build 指令為 `npm run build`。
