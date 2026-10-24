"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { createClient } from "@/lib/supabase/client";
import {
  describeAuditEntry,
  listAuditLog,
  type AuditCategory,
  type AuditLogPage,
  type AuditLogRow,
} from "@/lib/admin/audit-log";

// 稽核紀錄列表（TASK-086，mockup Variant A：四欄表格＋Chip 篩選）。唯讀，一律以純文字渲染。
// 競態：每次發出請求就遞增 requestRef，回來時序號不符（已被較新的請求或切換類別取代）就丟棄。

const CATEGORIES: Array<{ value: AuditCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "appointment", label: "預約" },
  { value: "settings", label: "設定" },
];

const SKELETON_ROWS = 5;

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; rows: AuditLogRow[]; nextCursor: string | null; more: "idle" | "loading" | "error" };

type LogTime = { short: string; full: string };

// 一律以 Asia/Taipei 顯示，不依賴瀏覽器時區；解析不出來就原樣顯示（不丟例外）。
function formatLogTime(iso: string): LogTime {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { short: iso, full: iso };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const time = `${get("hour")}:${get("minute")}`;
  return {
    short: `${get("month")}/${get("day")} ${time}`,
    full: `${get("year")}/${get("month")}/${get("day")} ${time}`,
  };
}

function firstPageState(res: Awaited<ReturnType<typeof listAuditLog>>): ListState {
  return res.ok
    ? { status: "loaded", rows: res.data.rows, nextCursor: res.data.nextCursor, more: "idle" }
    : { status: "error" };
}

export function AuditLogView() {
  const supabase = React.useMemo(() => createClient(), []);
  const requestRef = React.useRef(0);
  const [category, setCategory] = React.useState<AuditCategory>("all");
  const [state, setState] = React.useState<ListState>({ status: "loading" });

  // 掛載時的初次載入：setState 放在 promise .then() 回呼裡（比照 ServicesTable）。
  React.useEffect(() => {
    const requestId = ++requestRef.current;
    let cancelled = false;
    listAuditLog(supabase, { category: "all" }).then((res) => {
      if (cancelled || requestId !== requestRef.current) return;
      setState(firstPageState(res));
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function loadFirstPage(next: AuditCategory) {
    const requestId = ++requestRef.current;
    setState({ status: "loading" });
    const res = await listAuditLog(supabase, { category: next });
    if (requestId !== requestRef.current) return;
    setState(firstPageState(res));
  }

  function handleSelectCategory(next: AuditCategory) {
    if (next === category) return;
    setCategory(next);
    void loadFirstPage(next);
  }

  async function loadMore() {
    if (state.status !== "loaded" || !state.nextCursor || state.more === "loading") return;
    const cursor = state.nextCursor;
    const requestId = ++requestRef.current;
    setState({ ...state, more: "loading" });
    const res = await listAuditLog(supabase, { category, cursor });
    if (requestId !== requestRef.current) return;
    setState((current) => {
      if (current.status !== "loaded") return current;
      if (!res.ok) return { ...current, more: "error" };
      return appendPage(current, res.data);
    });
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 3 }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" component="h2">
          稽核紀錄
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          記錄後台的預約與設定操作，最新的在最上面。僅供查看，無法修改或刪除。
        </Typography>
      </Box>

      <Stack direction="row" role="group" aria-label="類別篩選" spacing={1} sx={{ mb: 2 }}>
        {CATEGORIES.map(({ value, label }) => {
          const selected = value === category;
          return (
            <Chip
              key={value}
              label={label}
              clickable
              aria-pressed={selected}
              color={selected ? "primary" : "default"}
              variant={selected ? "filled" : "outlined"}
              onClick={() => handleSelectCategory(value)}
            />
          );
        })}
      </Stack>

      {state.status === "error" && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadFirstPage(category)}>
              重試
            </Button>
          }
        >
          無法載入稽核紀錄，請稍後再試。
        </Alert>
      )}

      {state.status === "loading" && (
        <Paper variant="outlined" aria-busy="true" sx={{ p: 2 }}>
          <Stack sx={{ gap: 1.5 }}>
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <Skeleton key={index} variant="rounded" height={36} />
            ))}
          </Stack>
        </Paper>
      )}

      {state.status === "loaded" && state.rows.length === 0 && (
        <Alert severity="info">
          {category === "all" ? (
            <>
              <AlertTitle>尚無任何紀錄</AlertTitle>
              取消預約、改期或修改設定後，操作紀錄會出現在這裡。
            </>
          ) : (
            <>
              <AlertTitle>此類別沒有紀錄</AlertTitle>
              切換到「全部」或其他類別看看。
            </>
          )}
        </Alert>
      )}

      {state.status === "loaded" && state.rows.length > 0 && (
        <>
          <Paper variant="outlined" sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 128 }}>發生時間</TableCell>
                  <TableCell sx={{ width: 144 }}>事件</TableCell>
                  <TableCell>對象</TableCell>
                  <TableCell>變更內容</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.rows.map((row) => (
                  <AuditLogRowView key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Stack sx={{ alignItems: "center", mt: 2.5, gap: 1.5 }}>
            {state.more === "error" && (
              <Alert
                severity="error"
                sx={{ alignSelf: "stretch" }}
                action={
                  <Button color="inherit" size="small" onClick={() => void loadMore()}>
                    重試
                  </Button>
                }
              >
                無法載入更多紀錄，請稍後再試。
              </Alert>
            )}
            {state.nextCursor && state.more !== "error" && (
              <Button
                variant="outlined"
                loading={state.more === "loading"}
                loadingPosition="start"
                onClick={() => void loadMore()}
              >
                {state.more === "loading" ? "載入中…" : "載入更多"}
              </Button>
            )}
            {!state.nextCursor && (
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                已顯示全部紀錄
              </Typography>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
}

// 切換類別時已作廢進行中的請求，所以附加的頁一定屬於目前類別；仍以 id 去重，避免游標邊界重複。
function appendPage(current: Extract<ListState, { status: "loaded" }>, page: AuditLogPage): ListState {
  const seen = new Set(current.rows.map((row) => row.id));
  const fresh = page.rows.filter((row) => !seen.has(row.id));
  return { status: "loaded", rows: [...current.rows, ...fresh], nextCursor: page.nextCursor, more: "idle" };
}

function AuditLogRowView({ row }: { row: AuditLogRow }) {
  const time = formatLogTime(row.created_at);
  const { title, target, diffs } = describeAuditEntry(row);
  // 對象與差異內含使用者可控的名稱（服務、設計師）：<bdi> 隔離方向，overflowWrap 避免超長字串撐破版面。
  const wrap = { overflowWrap: "anywhere" as const };
  return (
    <TableRow>
      <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }} title={time.full}>
        {time.short}
      </TableCell>
      <TableCell sx={{ fontWeight: 600, verticalAlign: "top" }}>{title}</TableCell>
      <TableCell sx={{ ...wrap, color: "text.secondary", verticalAlign: "top" }}>
        {target ? <bdi>{target}</bdi> : <Dash />}
      </TableCell>
      <TableCell sx={{ ...wrap, verticalAlign: "top" }}>
        {diffs.length > 0 ? (
          <Stack sx={{ gap: 0.5 }}>
            {diffs.map((diff, index) => (
              <Box key={index}>
                <bdi>{diff}</bdi>
              </Box>
            ))}
          </Stack>
        ) : (
          <Dash />
        )}
      </TableCell>
    </TableRow>
  );
}

function Dash() {
  return (
    <Box component="span" sx={{ color: "text.disabled" }}>
      —
    </Box>
  );
}
