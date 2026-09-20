import { redirect } from "next/navigation";

// First item in the sidebar is the dashboard's default page.
export default function DoctorHome() {
  redirect("/doctor/performance");
}
