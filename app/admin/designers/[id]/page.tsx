import { DesignerEditView } from "../../_components/DesignerEditView";

export default async function EditDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key：從一位設計師的編輯頁直接導向另一位時，整個表單狀態要重置。
  return <DesignerEditView key={id} designerId={id} />;
}
