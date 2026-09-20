import { AutoRefresh } from "@/components/AutoRefresh";
import { Sidebar } from "@/components/Sidebar";
import { getOverdue, getSidebar } from "@/lib/api";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const [overdue, sidebar] = await Promise.all([getOverdue(), getSidebar()]);
  return (
    <div className="fade-in flex min-h-screen bg-page">
      <AutoRefresh seconds={10} />
      <Sidebar overdueCount={overdue.length} doctor="Dr. Patel" clinic="Joel's Clinic" data={sidebar} />
      <main className="min-w-0 flex-1 px-12 py-10">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}
