import { RecallMonitor } from "@/components/RecallMonitor";
import { getOverdue } from "@/lib/api";

export default async function RecallPage() {
  const rows = await getOverdue();
  return <RecallMonitor initialRows={rows} />;
}
