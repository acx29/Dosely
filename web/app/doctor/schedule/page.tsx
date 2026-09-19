import { ScheduleView } from "@/components/ScheduleView";
import { getSchedule } from "@/lib/api";

export default async function SchedulePage() {
  const data = await getSchedule();
  return <ScheduleView data={data} />;
}
