"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  NOOP_UNSAVED_CHANGES_STORE,
  createUnsavedChangesStore,
  type UnsavedChangesStore,
} from "@/lib/admin/unsaved-changes";

// 後台「未儲存變更」離開提示（TASK-081）。設計與規則見 ai/artifacts/專案設置/task-cards/TASK-081.md
// 的「架構筆記」。要點：
// - 狀態放在外部 store（lib/admin/unsaved-changes.ts），只存「哪些 key 有變更」，不存表單內容。
// - 兩個 context：store context（給需要反應式讀取的 hook）與「動作」context（穩定不變，函式內在呼叫當下
//   才讀 store，所以 LogoutButton、ServiceFormDialog 不會因 dirty 翻轉而重新 render）。
// - 沒有 Provider 時所有 hook 都是安全的 no-op（既有表單的測試是不包 Provider 直接 render 的）。
// - 不攔截瀏覽器上一頁／下一頁與程式化導覽（router.replace／refresh），這是已知限制。

type ConfirmOptions = {
  // 指定時只看該 key 的狀態（例如服務對話框只看 "service-form"，不被頁面上別的表單誤觸發）；
  // 不指定則看全域是否有任何變更。
  key?: string;
  // true 代表這個動作會離開頁面（導覽、登出）：選「放棄變更」後先標記「離開中」，
  // 讓 beforeunload 與後續攔截都略過，避免 Next 退回整頁導覽時又跳一次瀏覽器原生提示。
  leaving?: boolean;
};

type UnsavedChangesActions = {
  // 無變更：立刻執行 action；有變更：開提示，使用者選「放棄變更」才執行。
  confirmIfDirty: (action: () => void, options?: ConfirmOptions) => void;
  // 供 next/link 的 onNavigate 使用：沒有變更、目標等於目前路徑、或已在離開中時不攔截；
  // 否則 preventDefault 並提示，使用者選「放棄變更」後才 router.push(href)。
  guardNavigate: (href: string, event: { preventDefault: () => void }) => void;
};

const NOOP_ACTIONS: UnsavedChangesActions = {
  confirmIfDirty: (action) => action(),
  guardNavigate: () => {},
};

const StoreContext = React.createContext<UnsavedChangesStore>(NOOP_UNSAVED_CHANGES_STORE);
const ActionsContext = React.createContext<UnsavedChangesActions>(NOOP_ACTIONS);

const BEFORE_UNLOAD_MESSAGE = "有尚未儲存的變更";

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  // 用 useState 而不是 useRef 建立 store：eslint-config-next 16 內含 React Compiler 的
  // react-hooks/refs 規則，會擋下 render 期間讀 ref.current。
  const [store] = React.useState(() => createUnsavedChangesStore());
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = React.useState(false);
  // 待執行動作存 ref，state 只存 open：把函式放進 useState 會被 React 當成 updater 立即執行，
  // StrictMode 下還會執行兩次。
  const pendingRef = React.useRef<(() => void) | null>(null);
  const leavingRef = React.useRef(false);
  const pathnameRef = React.useRef(pathname);

  // 路徑改變：記下目前路徑，並解除「離開中」標記（導覽已完成）。
  React.useEffect(() => {
    pathnameRef.current = pathname;
    leavingRef.current = false;
  }, [pathname]);

  const hasUnsaved = React.useSyncExternalStore(store.subscribe, store.hasUnsaved, () => false);

  // 只在有未儲存變更時才註冊 beforeunload；沒有變更時不註冊，也不殘留。
  React.useEffect(() => {
    if (!hasUnsaved) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (leavingRef.current) return;
      event.preventDefault();
      // 非空字串才相容舊版瀏覽器；實際文案由瀏覽器決定，無法自訂。
      event.returnValue = BEFORE_UNLOAD_MESSAGE;
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsaved]);

  const actions = React.useMemo<UnsavedChangesActions>(() => {
    function runAction(action: () => void, leaving: boolean) {
      if (leaving) leavingRef.current = true;
      try {
        action();
      } catch (error) {
        // 動作失敗時不可讓使用者卡在「離開中」狀態；錯誤只記訊息，不記任何表單內容。
        leavingRef.current = false;
        console.error("unsaved-changes: 放棄變更後的動作執行失敗", error instanceof Error ? error.message : String(error));
      }
    }

    function confirmIfDirty(action: () => void, options?: ConfirmOptions) {
      const leaving = options?.leaving ?? false;
      const dirty = options?.key !== undefined ? store.isDirty(options.key) : store.hasUnsaved();
      if (!dirty) {
        runAction(action, leaving);
        return;
      }
      pendingRef.current = () => runAction(action, leaving);
      setOpen(true);
    }

    function guardNavigate(href: string, event: { preventDefault: () => void }) {
      if (leavingRef.current) return;
      if (!store.hasUnsaved()) return;
      if (href === pathnameRef.current) return;
      event.preventDefault();
      confirmIfDirty(() => router.push(href), { leaving: true });
    }

    return { confirmIfDirty, guardNavigate };
  }, [store, router]);

  function handleKeepEditing() {
    pendingRef.current = null;
    setOpen(false);
  }

  // 「放棄變更」永遠可用、不依賴任何非同步結果：先關閉對話框，再執行待執行動作。
  function handleDiscard() {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    pending?.();
  }

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>
        {children}
        <ConfirmDialog
          open={open}
          title="有尚未儲存的變更"
          description="離開後，你輸入的內容會消失。"
          cancelLabel="繼續編輯"
          confirmLabel="放棄變更"
          confirmColor="error"
          autoFocusCancel
          onConfirm={handleDiscard}
          onClose={handleKeepEditing}
        />
      </ActionsContext.Provider>
    </StoreContext.Provider>
  );
}

// 表單回報「目前有沒有未儲存變更」。key 在同一個頁面內要唯一（見任務卡的固定 key 清單）。
// 單一 effect：isDirty 變化時寫入 store，卸載時清除——StrictMode 的「設定→清除→設定」與卸載都安全；
// React 會先跑所有卸載清除、再跑新掛載的 effect，所以兩個頁面共用同一個 key 也不會互相蓋掉。
// 沒有 Provider 時寫入的是 NOOP store，不會有任何效果。
export function useUnsavedChangesGuard(key: string, isDirty: boolean): void {
  const store = React.useContext(StoreContext);
  React.useEffect(() => {
    store.setDirty(key, isDirty);
    return () => store.clear(key);
  }, [store, key, isDirty]);
}

// 反應式讀取某個 key 是否有未儲存變更（例如設計師頁「基本資料」頁籤的圓點，TASK-083）。
export function useIsUnsavedDirty(key: string): boolean {
  const store = React.useContext(StoreContext);
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.isDirty(key),
    () => false,
  );
}

export function useUnsavedChangesActions(): UnsavedChangesActions {
  return React.useContext(ActionsContext);
}
