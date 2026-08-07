"use client";

import * as React from "react";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableBody from "@mui/material/TableBody";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import Chip from "@mui/material/Chip";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import type { WeekAppointment } from "@/lib/admin/appointments";
import { STATUS_COLOR, STATUS_LABEL, formatAppointmentDateLabel, formatTimeRange } from "@/lib/admin/format";

// 同一週資料的表格檢視，比照 mockup 畫面 4：日期／時段／顧客／服務／狀態。

export type AppointmentListViewProps = {
  status: "loading" | "loaded" | "error";
  appointments: WeekAppointment[];
  onRowClick?: (appointment: WeekAppointment) => void;
};

export function AppointmentListView({ status, appointments, onRowClick }: AppointmentListViewProps) {
  if (status === "error") {
    return <Alert severity="error">無法載入本週預約，請重新整理頁面再試一次。</Alert>;
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>日期</TableCell>
          <TableCell>時段</TableCell>
          <TableCell>顧客</TableCell>
          <TableCell>服務</TableCell>
          <TableCell>狀態</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {status === "loading" &&
          [0, 1, 2].map((i) => (
            <TableRow key={i}>
              <TableCell colSpan={5}>
                <Skeleton variant="rounded" height={32} />
              </TableCell>
            </TableRow>
          ))}

        {status === "loaded" && appointments.length === 0 && (
          <TableRow>
            <TableCell colSpan={5}>
              <Alert severity="info" sx={{ my: 1 }}>
                本週沒有預約
              </Alert>
            </TableCell>
          </TableRow>
        )}

        {status === "loaded" &&
          appointments.map((appointment) => (
            <TableRow
              key={appointment.id}
              hover={Boolean(onRowClick)}
              onClick={onRowClick ? () => onRowClick(appointment) : undefined}
              sx={{ cursor: onRowClick ? "pointer" : "default" }}
            >
              <TableCell>{formatAppointmentDateLabel(appointment.start_at)}</TableCell>
              <TableCell>{formatTimeRange(appointment.start_at, appointment.end_at)}</TableCell>
              <TableCell>{appointment.customer_name}</TableCell>
              <TableCell>{appointment.service_name}</TableCell>
              <TableCell>
                <Chip size="small" label={STATUS_LABEL[appointment.status]} color={STATUS_COLOR[appointment.status]} />
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}
