import { describe, expect, it, vi } from "vitest";
import { NOOP_UNSAVED_CHANGES_STORE, createUnsavedChangesStore } from "@/lib/admin/unsaved-changes";

describe("createUnsavedChangesStore", () => {
  it("初始狀態沒有任何變更", () => {
    const store = createUnsavedChangesStore();
    expect(store.hasUnsaved()).toBe(false);
    expect(store.isDirty("a")).toBe(false);
  });

  it("多個 key 各自獨立：任一為 dirty 即 hasUnsaved", () => {
    const store = createUnsavedChangesStore();
    store.setDirty("a", true);
    store.setDirty("b", true);
    expect(store.hasUnsaved()).toBe(true);
    expect(store.isDirty("a")).toBe(true);
    expect(store.isDirty("b")).toBe(true);
    expect(store.isDirty("c")).toBe(false);

    store.setDirty("a", false);
    expect(store.hasUnsaved()).toBe(true);
    expect(store.isDirty("a")).toBe(false);

    store.setDirty("b", false);
    expect(store.hasUnsaved()).toBe(false);
  });

  it("clear 等同把該 key 設為乾淨，且不影響其他 key", () => {
    const store = createUnsavedChangesStore();
    store.setDirty("a", true);
    store.setDirty("b", true);
    store.clear("a");
    expect(store.isDirty("a")).toBe(false);
    expect(store.isDirty("b")).toBe(true);
  });

  it("值沒有翻轉時不通知訂閱者（重複設為 dirty、對乾淨的 key 再 clear）", () => {
    const store = createUnsavedChangesStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setDirty("a", false);
    store.clear("a");
    expect(listener).not.toHaveBeenCalled();

    store.setDirty("a", true);
    store.setDirty("a", true);
    expect(listener).toHaveBeenCalledTimes(1);

    store.setDirty("a", false);
    store.clear("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("一個 key 已 dirty 時，另一個 key 才變 dirty 仍會通知（hasUnsaved 沒翻轉也要通知，頁籤圓點才會更新）", () => {
    const store = createUnsavedChangesStore();
    store.setDirty("a", true);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setDirty("b", true);
    expect(store.hasUnsaved()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("取消訂閱後不再收到通知；在回呼中取消訂閱不影響其他訂閱者", () => {
    const store = createUnsavedChangesStore();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(() => {
      first();
      unsubscribeFirst();
    });
    store.subscribe(second);

    store.setDirty("a", true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    store.setDirty("a", false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("每個 store 實例互相獨立（測試之間不共用狀態）", () => {
    const one = createUnsavedChangesStore();
    const two = createUnsavedChangesStore();
    one.setDirty("a", true);
    expect(two.hasUnsaved()).toBe(false);
  });
});

describe("NOOP_UNSAVED_CHANGES_STORE", () => {
  it("永遠乾淨：setDirty 不產生任何效果，訂閱不會被通知", () => {
    const listener = vi.fn();
    const unsubscribe = NOOP_UNSAVED_CHANGES_STORE.subscribe(listener);
    NOOP_UNSAVED_CHANGES_STORE.setDirty("a", true);
    expect(NOOP_UNSAVED_CHANGES_STORE.isDirty("a")).toBe(false);
    expect(NOOP_UNSAVED_CHANGES_STORE.hasUnsaved()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
