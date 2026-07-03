import { ManageShare } from "@/components/manage-share";

export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManageShare id={id} />;
}
