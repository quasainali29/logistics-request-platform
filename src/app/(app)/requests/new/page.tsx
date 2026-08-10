import RequestForm from "./RequestForm";
import { getActiveProjects, getActiveDepartments } from "@/lib/cachedLookups";
import { getProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function NewRequestPage() {
  const profile = await getProfile();
  // Technicians work jobs assigned to them -- they never raise requests --
  // so this route is a no-op for them even if they reach it directly.
  if (profile.role === "technician") {
    redirect("/requests");
  }

  const [projects, departments] = await Promise.all([
    getActiveProjects(),
    getActiveDepartments(),
  ]);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New request</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fill in the details below. The form adapts to the category you choose.
        </p>
      </div>
      <RequestForm projects={projects} departments={departments} />
    </div>
  );
}
