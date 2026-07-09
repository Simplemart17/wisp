import type { Metadata } from "next";

import { CreateShare } from "@/components/create-share";

// The receipt shows share ids and key-bearing links — digit runs iOS would
// otherwise linkify as phone numbers.
export const metadata: Metadata = { formatDetection: { telephone: false } };

export default function Home() {
  return <CreateShare />;
}
