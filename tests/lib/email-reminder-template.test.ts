import { describe, expect, it } from "vitest";
import { buildReminderEmail } from "@/lib/email/templates/reminder";

describe("buildReminderEmail", () => {
  const baseInput = {
    customerName: "王小明",
    serviceName: "剪髮",
    startAt: "2026-08-24T09:00:00+08:00",
  };

  it("主旨格式為「預約提醒：{服務名稱} {日期} {時間}」", () => {
    const { subject } = buildReminderEmail(baseInput);
    expect(subject).toBe("預約提醒：剪髮 2026/08/24（一）09:00");
  });

  it("內文包含顧客姓名、服務名稱、時段", () => {
    const { html } = buildReminderEmail(baseInput);
    expect(html).toContain("王小明");
    expect(html).toContain("剪髮");
    expect(html).toContain("2026/08/24（一）09:00");
  });

  it("customerName 含 HTML 特殊字元時必須 escape", () => {
    const { html } = buildReminderEmail({
      ...baseInput,
      customerName: '<a href="https://evil.example">click</a>',
    });
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("未提供 storeName 時使用預設值「我們」，未提供 storePhone 時不出現聯絡方式段落", () => {
    const { html } = buildReminderEmail(baseInput);
    expect(html).toContain("提醒您在我們的預約即將到來");
    expect(html).not.toContain("如有問題");
  });

  it("提供 storeName／storePhone 時帶入信件內容並 escape", () => {
    const { html } = buildReminderEmail({ ...baseInput, storeName: "測試髮廊", storePhone: "0912-345-678" });
    expect(html).toContain("提醒您在測試髮廊的預約即將到來");
    expect(html).toContain("如有問題，歡迎聯絡我們：0912-345-678");
  });

  it("storeName／storePhone 為純空白字串時視為未提供", () => {
    const { html } = buildReminderEmail({ ...baseInput, storeName: "   ", storePhone: "   " });
    expect(html).toContain("提醒您在我們的預約即將到來");
    expect(html).not.toContain("如有問題");
  });

  it("storeName 含 HTML 特殊字元時必須 escape（比照 TASK-052 confirmation.ts 的既有測試對稱性）", () => {
    const { html } = buildReminderEmail({ ...baseInput, storeName: "<b>測試髮廊</b>" });
    expect(html).toContain("提醒您在&lt;b&gt;測試髮廊&lt;/b&gt;的預約即將到來");
  });
});
