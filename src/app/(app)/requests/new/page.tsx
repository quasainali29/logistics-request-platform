import { createClient } from "@/lib/supabase/server";
import RequestForm from "./RequestForm";

export default async function NewRequestPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active")
    .order("name");

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New request</h1>
        <p className="text-sm text-slate-500 mt-1">
          Fill in the details below. The form adapts to the category you choose.
        </p>
      </div>
      <RequestForm projects={projects ?? []} />
    </div>
  );
}
