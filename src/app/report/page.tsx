import { ReportForm } from "@/components/report-form";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ share?: string }>;
}) {
  const { share } = await searchParams;
  return <ReportForm shareId={share ?? ""} />;
}
