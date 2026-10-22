// 後台「未儲存變更」離開提示的狀態 store（TASK-081）。純函式／物件，沒有 React 依賴，方便單元測試。
//
// 只存「哪些 key 有未儲存變更」的布林，**不存、不記錄任何表單內容**（密碼、Email 等欄位都不會進到這裡）。
//
// 為什麼用外部 store 而不是 React state：讓事件處理函式（連結點擊、登出、對話框關閉、beforeunload）
// 能「同步讀到最新值」，不會讀到過期的 closure；多個表單與設計師頁的頁籤圓點共用同一份狀態。

export type UnsavedChangesStore = {
  // 標記某個 key 有／沒有未儲存變更。值沒有改變時不通知訂閱者。
  setDirty(key: string, dirty: boolean): void;
  // 移除某個 key（元件卸載時呼叫）。key 原本不是 dirty 時不通知訂閱者。
  clear(key: string): void;
  isDirty(key: string): boolean;
  // 任一 key 有變更即為 true。
  hasUnsaved(): boolean;
  // 回傳取消訂閱函式；介面符合 React useSyncExternalStore 的 subscribe。
  subscribe(listener: () => void): () => void;
};

export function createUnsavedChangesStore(): UnsavedChangesStore {
  const dirtyKeys = new Set<string>();
  const listeners = new Set<() => void>();

  function notify() {
    // 複製後再迭代：listener 在回呼中取消訂閱不會影響本輪迭代。
    for (const listener of [...listeners]) listener();
  }

  function setDirty(key: string, dirty: boolean) {
    if (dirty) {
      if (dirtyKeys.has(key)) return;
      dirtyKeys.add(key);
    } else {
      if (!dirtyKeys.delete(key)) return;
    }
    notify();
  }

  return {
    setDirty,
    clear: (key) => setDirty(key, false),
    isDirty: (key) => dirtyKeys.has(key),
    hasUnsaved: () => dirtyKeys.size > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// 沒有 Provider 時使用的靜態 store：永遠乾淨、不訂閱任何東西，讓 hook 能無條件呼叫。
export const NOOP_UNSAVED_CHANGES_STORE: UnsavedChangesStore = {
  setDirty: () => {},
  clear: () => {},
  isDirty: () => false,
  hasUnsaved: () => false,
  subscribe: () => () => {},
};
