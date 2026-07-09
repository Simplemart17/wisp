import type { Metadata } from "next";

import { ManageShare } from "@/components/manage-share";

// Ids, hashed visitors, and timestamps — digit runs iOS would otherwise
// linkify as phone numbers.
export const metadata: Metadata = { formatDetection: { telephone: false } };

export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManageShare id={id} />;
}
