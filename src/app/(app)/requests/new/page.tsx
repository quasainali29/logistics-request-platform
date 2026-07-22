import RequestForm from "./RequestForm";
import { getActiveProjects } from "@/lib/cachedLookups";

export default async function NewRequestPage() {
  const projects = await getActiveProjects();

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New request</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fill in the details below. The form adapts to the category you choose.
        </p>
      </div>
      <RequestForm projects={projects} />
    </div>
  );
}
