import { redirect } from "next/navigation";

// First item in the sidebar is the landing page.
export default function DoctorHome() {
  redirect("/doctor/performance");
}
