"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import InputLabel from "@mui/material/InputLabel";
import FormControl from "@mui/material/FormControl";
import Checkbox from "@mui/material/Checkbox";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Alert from "@mui/material/Alert";
import { Nav } from "@/components/ui/Nav";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormSection } from "@/components/ui/FormSection";
import { useToast } from "@/components/ui/ToastProvider";
import { MonthPicker } from "@/components/ui/MonthPicker";
import { PasswordStrengthMeter } from "@/components/ui/PasswordStrengthMeter";
import { OtpInput } from "@/components/ui/OtpInput";
import { ColorModeToggle } from "@/components/ui/ColorModeToggle";
import { TrendBarChart, type TrendBarBucket } from "@/components/ui/TrendBarChart";

// MonthPicker Demo 的唯讀日期（例如全店公休日）：不可點，灰底加刪除線。
const MONTH_PICKER_READ_ONLY_DATES = new Set(["2026-08-10", "2026-08-11"]);

// TrendBarChart Demo：每格 [已完成, 待完成] 筆數；tooltip／aria-label 的文案由呼叫端組（這裡只示範格式）。
function demoTrendBuckets(
  pairs: [number, number][],
  options: { labelOf: (index: number) => string; titleOf?: (index: number) => string; showLabel?: (index: number) => boolean; todayIndex?: number },
): TrendBarBucket[] {
  return pairs.map(([done, pending], index) => {
    const label = options.labelOf(index);
    const title = options.titleOf?.(index) ?? label;
    const total = done + pending;
    return {
      key: `demo-${index}`,
      label,
      showLabel: options.showLabel?.(index) ?? true,
      today: index === options.todayIndex,
      segments: [
        { value: done, kind: "solid" },
        { value: pending, kind: "striped" },
      ],
      tooltip: [title, `預約量 ${total} 筆`, `完成 ${done} ・ 待完成 ${pending}`],
      ariaLabel: `${title}，預約 ${total} 筆，完成 ${done}、待完成 ${pending}`,
    };
  });
}

const DEMO_MONTH_PAIRS: [number, number][] = Array.from({ length: 31 }, (_, i) =>
  i < 23 ? [2 + ((i * 5) % 6), 0] : i === 23 ? [3, 2] : [0, (i * 3) % 5],
);
const DEMO_WEEK_PAIRS: [number, number][] = [[4, 0], [6, 0], [2, 0], [5, 1], [3, 2], [0, 4], [0, 0]];
const DEMO_DAY_PAIRS: [number, number][] = [[1, 0], [2, 0], [0, 0], [3, 0], [2, 1], [0, 2], [0, 3], [0, 1], [0, 0], [0, 1]];
const DEMO_LEGEND = { solid: "已完成", striped: "待完成" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 6 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export default function DesignSystemShowcase() {
  const { showToast } = useToast();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectValue, setSelectValue] = React.useState("cut");
  const [monthPickerYear, setMonthPickerYear] = React.useState(2026);
  const [monthPickerMonth, setMonthPickerMonth] = React.useState(8);
  const [markedDates, setMarkedDates] = React.useState(new Set(["2026-08-19", "2026-08-25"]));
  const [strengthDemoPassword, setStrengthDemoPassword] = React.useState("abc12345");
  const [otpDemoValue, setOtpDemoValue] = React.useState("");

  return (
    <Box>
      <Nav
        title="設計系統展示"
        items={[
          { label: "元件", href: "/design-system", active: true },
          { label: "首頁", href: "/" },
        ]}
      />
      <Container maxWidth="md" sx={{ py: 5 }}>
        <Typography variant="h3" component="h1" sx={{ mb: 1 }}>
          S4 核心元件庫
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 5 }}>
          僅使用 S3 核准的 design token；展示各元件的必要狀態，供人工核准。
        </Typography>

        <Section title="Button">
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
            <Button variant="contained">預設</Button>
            <Button variant="outlined">Outlined</Button>
            <Button variant="text">Text</Button>
            <Button variant="contained" color="error">
              Danger
            </Button>
          </Stack>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button variant="contained" disabled>
              停用
            </Button>
            <Button variant="contained" loading loadingPosition="start">
              載入中
            </Button>
          </Stack>
        </Section>

        <Section title="Input">
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            <TextField label="顧客姓名" defaultValue="" placeholder="請輸入姓名" />
            <TextField label="已停用" disabled defaultValue="無法編輯" />
            <TextField label="電話" error helperText="格式不正確" defaultValue="abc" />
          </Stack>
        </Section>

        <Section title="Select">
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="service-select-label">服務項目</InputLabel>
            <Select
              labelId="service-select-label"
              label="服務項目"
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
            >
              <MenuItem value="cut">剪髮造型</MenuItem>
              <MenuItem value="color">染髮設計</MenuItem>
              <MenuItem value="scalp">頭皮護理</MenuItem>
            </Select>
          </FormControl>
        </Section>

        <Section title="Checkbox / Radio">
          <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Stack>
              <FormControlLabel control={<Checkbox defaultChecked />} label="已勾選" />
              <FormControlLabel control={<Checkbox />} label="未勾選" />
              <FormControlLabel control={<Checkbox disabled />} label="停用" />
            </Stack>
            <RadioGroup defaultValue="a">
              <FormControlLabel value="a" control={<Radio />} label="選項 A" />
              <FormControlLabel value="b" control={<Radio />} label="選項 B" />
              <FormControlLabel value="c" disabled control={<Radio />} label="停用選項" />
            </RadioGroup>
          </Stack>
        </Section>

        <Section title="Card">
          <Card sx={{ maxWidth: 320 }}>
            <CardContent>
              <Typography variant="h6" component="h3">
                剪髮造型
              </Typography>
              <Typography variant="body2" color="text.secondary">
                45 分鐘 · NT$800
              </Typography>
            </CardContent>
          </Card>
        </Section>

        <Section title="Table">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>服務項目</TableCell>
                <TableCell align="right">時長</TableCell>
                <TableCell align="right">價格</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>剪髮造型</TableCell>
                <TableCell align="right">45 分鐘</TableCell>
                <TableCell align="right">NT$800</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>染髮設計</TableCell>
                <TableCell align="right">120 分鐘</TableCell>
                <TableCell align="right">NT$2,400</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        <Section title="Form">
          <FormSection title="顧客資訊" description="用於預約表單的欄位間距與標籤慣例">
            <TextField label="姓名" />
            <TextField label="電話" />
          </FormSection>
        </Section>

        <Section title="Modal / Dialog">
          <Button variant="contained" onClick={() => setDialogOpen(true)}>
            開啟確認對話框
          </Button>
          <ConfirmDialog
            open={dialogOpen}
            title="確認取消預約？"
            description="取消後將無法復原，顧客需要重新預約。"
            confirmLabel="取消預約"
            confirmColor="error"
            onConfirm={() => setDialogOpen(false)}
            onClose={() => setDialogOpen(false)}
          />
        </Section>

        <Section title="MonthPicker">
          <Box sx={{ maxWidth: 340 }}>
            <MonthPicker
              year={monthPickerYear}
              month={monthPickerMonth}
              todayDate="2026-08-07"
              markedDates={markedDates}
              readOnlyDates={MONTH_PICKER_READ_ONLY_DATES}
              readOnlyLabel="全店公休"
              onDayClick={(date) => {
                setMarkedDates((prev) => {
                  const next = new Set(prev);
                  if (next.has(date)) {
                    next.delete(date);
                  } else {
                    next.add(date);
                  }
                  return next;
                });
              }}
              onMonthChange={(year, month) => {
                setMonthPickerYear(year);
                setMonthPickerMonth(month);
              }}
            />
          </Box>
        </Section>

        <Section title="TrendBarChart">
          <Stack spacing={4}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>月（31 格，每 5 日標一次，今天 24 日）</Typography>
              <TrendBarChart
                ariaLabel="預約量（每日）"
                max={8}
                legend={DEMO_LEGEND}
                buckets={demoTrendBuckets(DEMO_MONTH_PAIRS, {
                  labelOf: (i) => String(i + 1),
                  titleOf: (i) => `10/${i + 1}`,
                  showLabel: (i) => i === 0 || (i + 1) % 5 === 0,
                  todayIndex: 23,
                })}
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>週（7 格）</Typography>
              <TrendBarChart
                ariaLabel="預約量（每日）"
                max={8}
                legend={DEMO_LEGEND}
                buckets={demoTrendBuckets(DEMO_WEEK_PAIRS, {
                  labelOf: (i) => `10/${19 + i}（${["一", "二", "三", "四", "五", "六", "日"][i]}）`,
                  todayIndex: 5,
                })}
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>日（10 格，10:00–19:00）</Typography>
              <TrendBarChart
                ariaLabel="預約量（每小時）"
                max={4}
                legend={DEMO_LEGEND}
                buckets={demoTrendBuckets(DEMO_DAY_PAIRS, { labelOf: (i) => `${10 + i}:00` })}
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>全零（每格仍佔位）</Typography>
              <TrendBarChart
                ariaLabel="預約量（每日）"
                max={4}
                buckets={demoTrendBuckets(DEMO_WEEK_PAIRS.map((): [number, number] => [0, 0]), {
                  labelOf: (i) => `${i + 1}`,
                })}
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>空（buckets 為空）</Typography>
              <TrendBarChart ariaLabel="預約量（每日）" max={4} buckets={[]} emptyLabel="此期間沒有資料" />
            </Box>
          </Stack>
        </Section>

        <Section title="PasswordStrengthMeter">
          <Box sx={{ maxWidth: 320 }}>
            <TextField
              label="輸入密碼試試"
              size="small"
              fullWidth
              value={strengthDemoPassword}
              onChange={(event) => setStrengthDemoPassword(event.target.value)}
              sx={{ mb: 1 }}
            />
            <PasswordStrengthMeter password={strengthDemoPassword} />
          </Box>
        </Section>

        <Section title="OtpInput">
          <Stack spacing={2} sx={{ maxWidth: 320 }}>
            <OtpInput value={otpDemoValue} onChange={setOtpDemoValue} />
            <OtpInput value="481" onChange={() => {}} error />
            <OtpInput value="481212" onChange={() => {}} disabled />
          </Stack>
        </Section>

        <Section title="ColorModeToggle">
          <ColorModeToggle />
        </Section>

        <Section title="Toast / Alert">
          <Stack spacing={1} sx={{ mb: 2 }}>
            <Alert severity="success">操作成功</Alert>
            <Alert severity="warning">請注意</Alert>
            <Alert severity="error">發生錯誤</Alert>
            <Alert severity="info">提示訊息</Alert>
          </Stack>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button variant="outlined" color="success" onClick={() => showToast("預約已建立", "success")}>
              觸發成功 Toast
            </Button>
            <Button variant="outlined" color="error" onClick={() => showToast("儲存失敗", "error")}>
              觸發錯誤 Toast
            </Button>
          </Stack>
        </Section>
      </Container>
    </Box>
  );
}
