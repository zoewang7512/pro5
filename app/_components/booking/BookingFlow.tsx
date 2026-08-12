"use client";

import * as React from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { createClient } from "@/lib/supabase/client";
import { createAppointment, getServices, getBusinessHours, getAvailableSlots } from "@/lib/booking/api";
import { buildDateRange, getTaipeiToday } from "@/lib/booking/date-range";
import { getBookingErrorMessage } from "@/lib/booking/error-messages";
import { buildSlotGrid, type SlotCell } from "@/lib/booking/slot-grid";
import type { AppointmentConfirmation, AvailableSlot, BusinessHours, Service } from "@/lib/booking/types";
import { EMPTY_STORE_SETTINGS, getStoreSettings, resolveStoreDisplay, type StoreSettings } from "@/lib/store-settings";
import { useToast } from "@/components/ui/ToastProvider";
import { BrandHeaderSection, BrandHeaderSectionSkeleton } from "./BrandHeaderSection";
import { ServiceListSection } from "./ServiceListSection";
import { SlotPickerSection } from "./SlotPickerSection";
import { ContactFormSection, type ContactFormValues } from "./ContactFormSection";
import { SuccessSection } from "./SuccessSection";

// 單頁捲動版型的頁面層 state：服務／時段／聯絡資訊選擇皆集中於此，往下用 props
// 傳給各區塊元件。送出成功後整頁切換為 SuccessSection，狀態只存在 client state，
// 不依賴 URL 參數（重新整理該頁不會重複送出）。

const DATE_RANGE_DAYS = 14;

type FetchStatus = "loading" | "loaded" | "error";

type ServicesResult = { status: "loaded" | "error"; services: Service[] };

type SlotsResult = {
  key: string;
  status: "loaded" | "error";
  businessHours: BusinessHours | null;
  availableSlots: AvailableSlot[];
};

export function BookingFlow() {
  const supabase = React.useMemo(() => createClient(), []);
  const dateOptions = React.useMemo(() => buildDateRange(getTaipeiToday(), DATE_RANGE_DAYS), []);
  const { showToast } = useToast();

  // 兩個 fetch 結果都存「完成時的結果＋對應 key」，loading 狀態由 render 時比較
  // 目前的依賴值與最後完成的 key 是否一致推導出來，不在 effect 內同步呼叫
  // setState 把狀態撥回 loading（react-hooks/set-state-in-effect 規則要求）。
  const [servicesResult, setServicesResult] = React.useState<ServicesResult | null>(null);
  const [slotsResult, setSlotsResult] = React.useState<SlotsResult | null>(null);
  const [brandSettings, setBrandSettings] = React.useState<StoreSettings | null>(null);

  const [selectedService, setSelectedService] = React.useState<Service | null>(null);
  const [editingService, setEditingService] = React.useState(false);

  const [selectedDate, setSelectedDate] = React.useState(dateOptions[0].date);
  const [selectedSlot, setSelectedSlot] = React.useState<AvailableSlot | null>(null);
  const [editingSlot, setEditingSlot] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState<AppointmentConfirmation | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getServices(supabase).then((result) => {
      if (cancelled) return;
      setServicesResult(
        result.ok ? { status: "loaded", services: result.data } : { status: "error", services: [] },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // 品牌顯示區塊的讀取獨立於服務列表，各自的 effect／state，互不阻塞——
  // 品牌資訊載入慢或失敗不應延遲顧客看到服務列表。.catch 確保 promise reject
  // （非 getStoreSettings 內部已處理的 {ok:false} 分支，而是呼叫本身拋出）時
  // 仍會降級為空值，不會讓骨架屏卡住不放（security-reviewer TASK-032 審查發現）。
  React.useEffect(() => {
    let cancelled = false;
    getStoreSettings(supabase)
      .then((result) => {
        if (cancelled) return;
        setBrandSettings(result.ok ? result.data : EMPTY_STORE_SETTINGS);
      })
      .catch(() => {
        if (cancelled) return;
        setBrandSettings(EMPTY_STORE_SETTINGS);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const slotsRequestKey = selectedService ? `${selectedService.id}|${selectedDate}` : null;

  React.useEffect(() => {
    if (!selectedService) return;
    const dateOption = dateOptions.find((option) => option.date === selectedDate);
    if (!dateOption) return;

    const key = `${selectedService.id}|${selectedDate}`;
    let cancelled = false;

    Promise.all([
      getBusinessHours(supabase, dateOption.weekday),
      getAvailableSlots(supabase, selectedService.id, selectedDate),
    ]).then(([hoursResult, availableResult]) => {
      if (cancelled) return;
      if (hoursResult.ok && availableResult.ok) {
        setSlotsResult({ key, status: "loaded", businessHours: hoursResult.data, availableSlots: availableResult.data });
      } else {
        setSlotsResult({ key, status: "error", businessHours: null, availableSlots: [] });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [supabase, selectedService, selectedDate, dateOptions]);

  const servicesStatus: FetchStatus = servicesResult?.status ?? "loading";
  const services = servicesResult?.services ?? [];

  const brandDisplay = brandSettings ? resolveStoreDisplay(brandSettings) : null;

  const slotsMatchesRequest = slotsRequestKey !== null && slotsResult?.key === slotsRequestKey;
  const slotsStatus: FetchStatus = slotsMatchesRequest ? slotsResult!.status : "loading";
  const businessHours = slotsMatchesRequest ? slotsResult!.businessHours : null;
  const availableSlots = React.useMemo<AvailableSlot[]>(
    () => (slotsMatchesRequest ? slotsResult!.availableSlots : []),
    [slotsMatchesRequest, slotsResult],
  );

  function handleSelectService(service: Service) {
    if (service.id !== selectedService?.id) {
      setSelectedSlot(null);
      setEditingSlot(false);
    }
    setSelectedService(service);
    setEditingService(false);
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    setSelectedSlot(null);
  }

  function handleSelectSlot(cell: SlotCell) {
    if (!selectedService || cell.disabled) return;
    const endAt = new Date(
      new Date(cell.startAt).getTime() + selectedService.duration_minutes * 60_000,
    ).toISOString();
    setSelectedSlot({ start_at: cell.startAt, end_at: endAt });
    setEditingSlot(false);
  }

  async function handleSubmitContact(values: ContactFormValues) {
    if (!selectedService || !selectedSlot) return;

    setSubmitting(true);
    const result = await createAppointment(supabase, {
      serviceId: selectedService.id,
      startAt: selectedSlot.start_at,
      customerName: values.name,
      customerPhone: values.phone,
      customerEmail: values.email || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      setConfirmation(result.data);
    } else {
      showToast(getBookingErrorMessage(result.error.code), "error");
    }
  }

  const cells = React.useMemo(
    () =>
      selectedService
        ? buildSlotGrid({
            date: selectedDate,
            durationMinutes: selectedService.duration_minutes,
            businessHours,
            availableSlots,
          })
        : [],
    [selectedService, selectedDate, businessHours, availableSlots],
  );

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2.5, sm: 3 } }}>
      {brandDisplay === null ? (
        <BrandHeaderSectionSkeleton />
      ) : brandDisplay.hasBrand ? (
        <BrandHeaderSection display={brandDisplay} />
      ) : (
        <Typography variant="h5" component="h1" sx={{ mb: 3 }}>
          預約{selectedService ? ` · ${selectedService.name}` : ""}
        </Typography>
      )}

      {confirmation ? (
        <SuccessSection confirmation={confirmation} />
      ) : (
        <>
          <ServiceListSection
            status={servicesStatus}
            services={services}
            selectedService={selectedService}
            collapsed={Boolean(selectedService) && !editingService}
            onSelect={handleSelectService}
            onEdit={() => setEditingService(true)}
          />

          {selectedService && !editingService && (
            <SlotPickerSection
              dateOptions={dateOptions}
              selectedDate={selectedDate}
              onSelectDate={handleSelectDate}
              status={slotsStatus}
              cells={cells}
              selectedSlot={selectedSlot}
              onSelectSlot={handleSelectSlot}
              collapsed={Boolean(selectedSlot) && !editingSlot}
              onEdit={() => setEditingSlot(true)}
            />
          )}

          {selectedService && selectedSlot && !editingService && !editingSlot && (
            <ContactFormSection submitting={submitting} onSubmit={handleSubmitContact} />
          )}
        </>
      )}
    </Container>
  );
}
