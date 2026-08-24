import { describe, expect, it } from "vitest";
import { classifyAppointmentUpdate } from "@/lib/email/classify-appointment-update";

const base = { status: "pending", start_at: "2026-08-24T09:00:00+08:00", end_at: "2026-08-24T09:30:00+08:00" };

describe("classifyAppointmentUpdate", () => {
  it("status 由 pending 變為 cancelled 時分類為 cancelled", () => {
    expect(classifyAppointmentUpdate(base, { ...base, status: "cancelled" })).toBe("cancelled");
  });

  it("status 由 confirmed 變為 cancelled 時分類為 cancelled", () => {
    expect(classifyAppointmentUpdate({ ...base, status: "confirmed" }, { ...base, status: "cancelled" })).toBe(
      "cancelled",
    );
  });

  it("start_at 變更且 status 仍非 cancelled 時分類為 rescheduled", () => {
    const record = { ...base, start_at: "2026-08-25T09:00:00+08:00", end_at: "2026-08-25T09:30:00+08:00" };
    expect(classifyAppointmentUpdate(base, record)).toBe("rescheduled");
  });

  it("僅 end_at 變更（start_at 不變）也分類為 rescheduled", () => {
    const record = { ...base, end_at: "2026-08-24T10:00:00+08:00" };
    expect(classifyAppointmentUpdate(base, record)).toBe("rescheduled");
  });

  it("status 已經是 cancelled 時，即使 start_at 也變了，仍分類為 none（不誤判成改期）", () => {
    const oldRecord = { ...base, status: "cancelled" };
    const record = { ...base, status: "cancelled", start_at: "2026-08-25T09:00:00+08:00" };
    expect(classifyAppointmentUpdate(oldRecord, record)).toBe("none");
  });

  it("標記完成（status 變為 completed）分類為 none，不誤判為取消或改期", () => {
    expect(classifyAppointmentUpdate(base, { ...base, status: "completed" })).toBe("none");
  });

  it("欄位完全沒有實質變化時分類為 none（例如僅 updated_at 觸發、其餘欄位不變）", () => {
    expect(classifyAppointmentUpdate(base, { ...base })).toBe("none");
  });

  it("old status 已是 cancelled，record status 仍是 cancelled 且時段不變，分類為 none", () => {
    const oldRecord = { ...base, status: "cancelled" };
    expect(classifyAppointmentUpdate(oldRecord, oldRecord)).toBe("none");
  });

  it("取消優先於改期判斷：假設性地同一次事件 status 變 cancelled 又動了時段，仍分類為 cancelled", () => {
    const record = { status: "cancelled", start_at: "2026-08-25T09:00:00+08:00", end_at: "2026-08-25T09:30:00+08:00" };
    expect(classifyAppointmentUpdate(base, record)).toBe("cancelled");
  });
});
