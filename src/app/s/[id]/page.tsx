import { ShareViewer } from "@/components/share-viewer";

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareViewer id={id} />;
}
