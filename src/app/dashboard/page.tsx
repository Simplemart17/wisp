import type { Metadata } from "next";

import { Dashboard } from "@/components/dashboard";

// A ledger of share ids — digit runs iOS would otherwise linkify as phone
// numbers.
export const metadata: Metadata = { formatDetection: { telephone: false } };

export default function DashboardPage() {
  return <Dashboard />;
}
