import { describe, expect, it } from "vitest";
import { escapeHtml, formatAppointmentDateTime } from "@/lib/email/format";

describe("formatAppointmentDateTime", () => {
  it("格式化為 YYYY/MM/DD（週X）HH:mm，以 Asia/Taipei 當地時間為準", () => {
    // 2026-08-24T09:00:00Z = 台北時間 2026/08/24 17:00，週一。
    expect(formatAppointmentDateTime("2026-08-24T09:00:00Z")).toBe("2026/08/24（一）17:00");
  });

  it("UTC 日期與台北日期跨日時，顯示台北當地日期與星期幾（既有教訓：不能直接用 UTC 日期推算）", () => {
    // 2026-08-23T20:00:00Z = 台北時間 2026-08-24T04:00:00，已跨到隔天週一。
    expect(formatAppointmentDateTime("2026-08-23T20:00:00Z")).toBe("2026/08/24（一）04:00");
  });

  it("午夜時刻正確顯示為 00:00，不是部分 ICU 實作可能出現的 24:00 怪癖", () => {
    // 2026-08-23T16:00:00Z = 台北時間 2026-08-24T00:00:00。
    expect(formatAppointmentDateTime("2026-08-23T16:00:00Z")).toBe("2026/08/24（一）00:00");
  });

  it("小時與分鐘皆補零至兩位數", () => {
    // 2026-08-25T01:05:00Z = 台北時間 2026-08-25T09:05:00，週二。
    expect(formatAppointmentDateTime("2026-08-25T01:05:00Z")).toBe("2026/08/25（二）09:05");
  });

  it("正確涵蓋星期陣列的頭尾（週日／週六），確保 WEEKDAY_LABELS 順序沒有被誤改", () => {
    // 2026-08-23T12:00:00Z = 台北時間 2026-08-23T20:00:00，週日。
    expect(formatAppointmentDateTime("2026-08-23T12:00:00Z")).toBe("2026/08/23（日）20:00");
    // 2026-08-29T05:00:00Z = 台北時間 2026-08-29T13:00:00，週六。
    expect(formatAppointmentDateTime("2026-08-29T05:00:00Z")).toBe("2026/08/29（六）13:00");
  });

  it("無效的時間字串會拋出例外，而不是靜默產生 NaN/undefined 拼成的亂碼字串", () => {
    expect(() => formatAppointmentDateTime("not-a-valid-date")).toThrow(/無效的時間字串/);
    expect(() => formatAppointmentDateTime("")).toThrow(/無效的時間字串/);
  });
});

describe("escapeHtml", () => {
  it("跳脫 HTML 特殊字元，避免使用者輸入（例如顧客姓名）被當成標籤解析", () => {
    expect(escapeHtml('<a href="https://evil.invalid">改期請點此</a>')).toBe(
      "&lt;a href=&quot;https://evil.invalid&quot;&gt;改期請點此&lt;/a&gt;",
    );
  });

  it("跳脫單引號與 & 本身，且不會把 & 二次跳脫成 &amp;amp;", () => {
    expect(escapeHtml("Tom & Jerry's <script>")).toBe("Tom &amp; Jerry&#39;s &lt;script&gt;");
  });

  it("不含特殊字元的一般文字原樣輸出", () => {
    expect(escapeHtml("王小明")).toBe("王小明");
  });

  it("空字串原樣輸出", () => {
    expect(escapeHtml("")).toBe("");
  });
});
