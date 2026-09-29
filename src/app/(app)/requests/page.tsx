import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWorkflowStages, getActiveProjects } from "@/lib/cachedLookups";
import Link from "next/link";
import RequestsTable from "./RequestsTable";
import RequestsFilterBar from "./RequestsFilterBar";
import { computeCompletedVerificationBuckets } from "@/lib/requestVerificationStatus";
import { getManagerDepartmentScope, NO_DEPARTMENT_MATCH } from "@/lib/departmentScope";
import { canDo } from "@/lib/permissions";

const PAGE_SIZE = 25;

// Priority has no natural DB ordering (it's a text column, not an enum with
// severity built in), so "sort by priority" is handled by fetching every
// filtered row and ranking in memory below -- fine at this data volume, and
// it keeps the common sorts (date/due) on the cheap range()-paginated path.
const PRIORITY_RANK: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

// The technician relation is embedded two ways depending on whether we're
// filtering by a specific technician: a plain left-embed shows every
// request's crew regardless of who's on it, while an `!inner` embed
// restricts the parent rows themselves to only those with a matching crew
// member -- PostgREST's standard "filter through an embedded resource"
// pattern, used below (via the filterByTechnician ternary at each .select
// call) whenever a technician filter is active: the technician's own "my
// jobs" view, or the staff Technician dropdown. Two named literal
// constants rather than a function returning a computed string -- passing
// a plain `string`-typed value to .select() defeats supabase-js's
// compile-time query parser and the row type falls back to
// GenericStringError, so this keeps each branch a proper string literal.
const REQUEST_SELECT =
  "*, requestor:profiles!requests_requestor_id_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name), request_technicians(technician_id, accepted_at, technician:profiles!request_technicians_technician_id_fkey(full_name)), linked_project:projects!requests_project_id_fkey(name)";
const REQUEST_SELECT_TECH_FILTER =
  "*, requestor:profiles!requests_requestor_id_fkey(full_name), owner:profiles!requests_owner_id_fkey(full_name), request_technicians!inner(technician_id, accepted_at, technician:profiles!request_technicians_technician_id_fkey(full_name)), linked_project:projects!requests_project_id_fkey(name)";

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    category?: string;
    project?: string;
    requestor?: string;
    priority?: string;
    status?: string;
    from?: string;
    to?: string;
    due?: string;
    sort?: string;
    search?: string;
    coordinator?: string;
    technician?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const category = params.category || "";
  const projectId = params.project || "";
  const requestorId = params.requestor || "";
  const priority = params.priority || "";
  const status = params.status || "";
  const dateFrom = params.from || "";
  const dateTo = params.to || "";
  const due = params.due || "";
  const sort = params.sort || "newest";
  const search = (params.search || "").trim();
  const coordinatorId = params.coordinator || "";
  const technicianId = params.technician || "";

  const profile = await getProfile();
  const supabase = await createClient();
  const isStaff = !!profile.is_staff;
  // A technician doesn't submit requests -- they're never the requestor --
  // so the default "own requests" filter below would show them nothing.
  // They see jobs assigned to them instead, same list/filter/pagination UI.
  const isTechnician = profile.role === "technician";
  const isCoordinator = profile.role === "logistics_coordinator";
  const isManager = !!profile.is_manager;

  // A technician filters to "requests I'm on the crew for"; staff can
  // additionally filter to a specific technician via the dropdown. Only
  // one of these applies at a time -- a technician doesn't also see the
  // staff-only Technician filter (see RequestsFilterBar).
  const technicianFilterId = isTechnician ? profile.id : isStaff ? technicianId : "";
  const filterByTechnician = !!technicianFilterId;

  // A department-scoped manager (any is_manager role other than
  // logistics_manager/main_admin -- see lib/departmentScope.ts) only
  // sees requests whose department matches one they've been assigned via
  // Admin > Departments. null means "no restriction" (plain requestor,
  // coordinator, technician, warehouse_team, or a sees-all manager role).
  const managerDepartmentScope = await getManagerDepartmentScope(supabase, profile);

  // Non-staff only ever see their own requests -- same restriction the
  // page always enforced, just applied consistently alongside the new
  // filters below. Duplicated across the two branches below (rather than
  // factored into a shared helper) because the Supabase query builder's
  // generic type narrows with each chained call, which doesn't play well
  // with a generic wrapper function -- inlining keeps it straightforward
  // to typecheck.
  const today = new Date().toISOString().slice(0, 10);

  // Fetched up front (rather than after the query blocks below, where it
  // used to live) so the "Overdue" due-date filter can exclude terminal
  // statuses -- see terminalStatusKeys below. A request whose (category,
  // status) pair is marked terminal in the workflow builder (currently
  // "completed", "closed", and "rejected" everywhere) is done, so it
  // should never show up under "Overdue" regardless of conclude_date,
  // matching the red-highlight logic RequestsTable.tsx already applies.
  const stageList = await getWorkflowStages();
  const terminalStatusKeys = Array.from(
    new Set(stageList.filter((s) => s.is_terminal).map((s) => s.key))
  );

  // Two synthetic filter values ("work_in_process" and the three
  // completed sub-states) don't map to a single workflow_stages key --
  // see the statusOptions comment further down. "work_in_process" is
  // handled with a plain .in(["dispatched","on_site"]) below; the
  // completed sub-states need a request_verifications/request_closeouts
  // lookup that a single .eq("status", ...) can't express, so for those
  // we narrow to a concrete list of request ids up front (mirroring the
  // priority-sort branch's "fetch everything matching, then filter in
  // memory" approach below -- fine at this data volume) and filter the
  // real query by id instead of by status.
  const COMPLETED_SUBSTATES = new Set(["waiting_verification", "require_recheck", "verified"]);
  let restrictToIds: string[] | null = null;

  if (COMPLETED_SUBSTATES.has(status)) {
    let idQuery = supabase
      .from("requests")
      .select(filterByTechnician ? "id, request_technicians!inner(technician_id)" : "id");
    if (!isStaff) {
      if (!isTechnician) idQuery = idQuery.eq("requestor_id", profile.id);
    } else if (isCoordinator) {
      idQuery = idQuery.eq("owner_id", profile.id);
    } else if (managerDepartmentScope !== null) {
      idQuery = idQuery.in(
        "department",
        managerDepartmentScope.length ? managerDepartmentScope : NO_DEPARTMENT_MATCH
      );
    } else if (!canDo(profile, "view_all_requests")) {
      idQuery = idQuery.eq("requestor_id", profile.id);
    }
    if (filterByTechnician) idQuery = idQuery.eq("request_technicians.technician_id", technicianFilterId);
    idQuery = idQuery.eq("status", "completed");
    if (category) idQuery = idQuery.eq("category", category);
    if (projectId) idQuery = idQuery.eq("project_id", projectId);
    if (isStaff && requestorId) idQuery = idQuery.eq("requestor_id", requestorId);
    if (isStaff && coordinatorId) idQuery = idQuery.eq("owner_id", coordinatorId);
    if (priority) idQuery = idQuery.eq("priority", priority);
    if (search) idQuery = idQuery.ilike("request_number", `%${search}%`);
    if (dateFrom) idQuery = idQuery.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) idQuery = idQuery.lte("created_at", `${dateTo}T23:59:59`);
    // The Overdue due-date filter always excludes terminal statuses (see
    // terminalStatusKeys above), and "completed" is terminal, so an
    // Overdue + completed-substate combination would always be empty
    // anyway -- skip replicating that filter here.

    const { data: candidateRows } = await idQuery;
    const candidateIds = ((candidateRows ?? []) as any[]).map((r) => r.id as string);
    const buckets = await computeCompletedVerificationBuckets(supabase, candidateIds);
    restrictToIds = candidateIds.filter((id) => buckets.get(id) === status);
  }

  let requests: Array<Record<string, unknown>> = [];
  let total = 0;

  if (sort === "priority") {
    let query = supabase
      .from("requests")
      .select(filterByTechnician ? REQUEST_SELECT_TECH_FILTER : REQUEST_SELECT, { count: "exact" });
    if (!isStaff) {
      if (!isTechnician) query = query.eq("requestor_id", profile.id);
      // Technicians are scoped below via the request_technicians!inner
      // embed + eq filter -- eq("assigned_technician_id", ...) doesn't
      // exist anymore now that a request can have more than one.
    } else if (isCoordinator) {
      // Coordinators only ever see requests assigned to them, everywhere
      // in the app -- same scoping as their dashboard, not just the
      // requestor_id fallback non-staff roles get.
      query = query.eq("owner_id", profile.id);
    } else if (managerDepartmentScope !== null) {
      query = query.in(
        "department",
        managerDepartmentScope.length ? managerDepartmentScope : NO_DEPARTMENT_MATCH
      );
    } else if (!canDo(profile, "view_all_requests")) {
      query = query.eq("requestor_id", profile.id);
    }
    if (filterByTechnician) query = query.eq("request_technicians.technician_id", technicianFilterId);
    if (category) query = query.eq("category", category);
    if (projectId) query = query.eq("project_id", projectId);
    if (isStaff && requestorId) query = query.eq("requestor_id", requestorId);
    if (isStaff && coordinatorId) query = query.eq("owner_id", coordinatorId);
    if (priority) query = query.eq("priority", priority);
    if (status === "work_in_process") query = query.in("status", ["dispatched", "on_site"]);
    else if (restrictToIds !== null) {
      query = query.in("id", restrictToIds.length ? restrictToIds : ["00000000-0000-0000-0000-000000000000"]);
    } else if (status) query = query.eq("status", status);
    if (search) query = query.ilike("request_number", `%${search}%`);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);
    if (due === "overdue") {
      query = query.lt("conclude_date", today);
      if (terminalStatusKeys.length) query = query.not("status", "in", `(${terminalStatusKeys.join(",")})`);
    }
    else if (due === "next7" || due === "next30") {
      const upper = new Date();
      upper.setDate(upper.getDate() + (due === "next7" ? 7 : 30));
      query = query.gte("conclude_date", today).lte("conclude_date", upper.toISOString().slice(0, 10));
    }

    const { data, count } = await query.order("created_at", { ascending: false });
    const all = (data ?? []).slice().sort((a: any, b: any) => {
      const ra = PRIORITY_RANK[a.priority] ?? 0;
      const rb = PRIORITY_RANK[b.priority] ?? 0;
      return rb - ra;
    });
    total = count ?? all.length;
    requests = all.slice(from, to + 1);
  } else {
    let query = supabase
      .from("requests")
      .select(filterByTechnician ? REQUEST_SELECT_TECH_FILTER : REQUEST_SELECT, { count: "exact" });
    if (!isStaff) {
      if (!isTechnician) query = query.eq("requestor_id", profile.id);
      // Technicians are scoped below via the request_technicians!inner
      // embed + eq filter -- eq("assigned_technician_id", ...) doesn't
      // exist anymore now that a request can have more than one.
    } else if (isCoordinator) {
      // Coordinators only ever see requests assigned to them, everywhere
      // in the app -- same scoping as their dashboard, not just the
      // requestor_id fallback non-staff roles get.
      query = query.eq("owner_id", profile.id);
    } else if (managerDepartmentScope !== null) {
      query = query.in(
        "department",
        managerDepartmentScope.length ? managerDepartmentScope : NO_DEPARTMENT_MATCH
      );
    } else if (!canDo(profile, "view_all_requests")) {
      query = query.eq("requestor_id", profile.id);
    }
    if (filterByTechnician) query = query.eq("request_technicians.technician_id", technicianFilterId);
    if (category) query = query.eq("category", category);
    if (projectId) query = query.eq("project_id", projectId);
    if (isStaff && requestorId) query = query.eq("requestor_id", requestorId);
    if (isStaff && coordinatorId) query = query.eq("owner_id", coordinatorId);
    if (priority) query = query.eq("priority", priority);
    if (status === "work_in_process") query = query.in("status", ["dispatched", "on_site"]);
    else if (restrictToIds !== null) {
      query = query.in("id", restrictToIds.length ? restrictToIds : ["00000000-0000-0000-0000-000000000000"]);
    } else if (status) query = query.eq("status", status);
    if (search) query = query.ilike("request_number", `%${search}%`);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);
    if (due === "overdue") {
      query = query.lt("conclude_date", today);
      if (terminalStatusKeys.length) query = query.not("status", "in", `(${terminalStatusKeys.join(",")})`);
    }
    else if (due === "next7" || due === "next30") {
      const upper = new Date();
      upper.setDate(upper.getDate() + (due === "next7" ? 7 : 30));
      query = query.gte("conclude_date", today).lte("conclude_date", upper.toISOString().slice(0, 10));
    }

    let ordered;
    if (sort === "oldest") ordered = query.order("created_at", { ascending: true });
    else if (sort === "due") ordered = query.order("conclude_date", { ascending: true, nullsFirst: false });
    else ordered = query.order("created_at", { ascending: false });

    const { data, count } = await ordered.range(from, to);
    requests = data ?? [];
    total = count ?? 0;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Requestor filter options -- staff only, since non-staff can only ever
  // see their own requests regardless of this filter (see withFilters
  // above), so the control would be a no-op for them.
  const activeProjects = await getActiveProjects();
  const projectOptions = activeProjects.map((p) => ({ id: p.id, name: p.name }));

  let requestorOptions: { id: string; full_name: string }[] = [];
  let coordinatorOptions: { id: string; full_name: string }[] = [];
  let technicianOptions: { id: string; full_name: string }[] = [];
  if (isStaff) {
    const [{ data: requestorRows }, { data: coordinatorRows }, { data: technicianRows }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("status", "active")
          .order("full_name"),
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "logistics_coordinator")
          .eq("status", "active")
          .order("full_name"),
        supabase
          .from("profiles")
          .select("id, full_name")
          .eq("role", "technician")
          .eq("status", "active")
          .order("full_name"),
      ]);
    requestorOptions = requestorRows ?? [];
    coordinatorOptions = coordinatorRows ?? [];
    technicianOptions = technicianRows ?? [];
  }

  // Status filter options -- deduped by key across every category's
  // configured workflow stages, since the filter applies a plain
  // `status = key` match regardless of which category the request is in.
  //
  // Several things need normalizing here rather than showing
  // workflow_stages verbatim:
  //  - "planning", "under_review", and "rejected" are configured stages
  //    that no code path in the app ever actually sets on a request
  //    (the submitted->review step and the standalone "rejected" terminal
  //    status were both superseded by the current approve/reject flow,
  //    which uses "returned_for_info" and "closed" instead). Filtering by
  //    any of these always returns zero rows, so they're excluded here
  //    entirely rather than left as dead options.
  //  - "under_process" is labeled "Under Process" for delivery/labor/
  //    procurement but "Team Assigned" for maintenance only. Since this
  //    filter matches the status across every category at once, it needs
  //    one canonical label rather than whichever category's row happens
  //    to be deduped last -- each category's own request badges keep
  //    their own configured label, this only affects the shared filter.
  //  - "submitted" displays as "Unassigned" in this filter (and the table
  //    below) -- same underlying status, just a clearer name for what it
  //    actually means at this stage.
  //  - "dispatched" and "on_site" collapse into one synthetic
  //    "work_in_process" option/value -- see the query building above,
  //    which expands it back into `status in ('dispatched','on_site')`.
  //  - "completed" is replaced by three synthetic sub-states --
  //    "waiting_verification", "require_recheck", "verified" -- derived
  //    from request_verifications/request_closeouts rather than a
  //    workflow_stages key (see computeCompletedVerificationBuckets).
  const DEAD_STATUS_KEYS = new Set(["planning", "under_review", "rejected"]);
  const CANONICAL_STATUS_LABELS: Record<string, string> = {
    under_process: "Under Process",
  };
  const dedupedStages = Array.from(
    new Map(
      stageList
        .filter((s) => !DEAD_STATUS_KEYS.has(s.key))
        .map((s) => [s.key, { value: s.key, label: CANONICAL_STATUS_LABELS[s.key] ?? s.label }])
    ).values()
  );
  const statusOptions: { value: string; label: string }[] = [];
  let addedWorkInProcess = false;
  for (const opt of dedupedStages) {
    if (opt.value === "dispatched" || opt.value === "on_site") {
      if (!addedWorkInProcess) {
        statusOptions.push({ value: "work_in_process", label: "Work in process" });
        addedWorkInProcess = true;
      }
      continue;
    }
    if (opt.value === "completed") {
      statusOptions.push({ value: "waiting_verification", label: "Waiting for verification" });
      statusOptions.push({ value: "require_recheck", label: "Require recheck" });
      statusOptions.push({ value: "verified", label: "Verified" });
      continue;
    }
    if (opt.value === "submitted") {
      statusOptions.push({ value: "submitted", label: "Unassigned" });
      continue;
    }
    statusOptions.push(opt);
  }

  // Same derivation the filter above uses, but scoped to just the
  // completed requests on THIS page -- so RequestsTable can show the
  // right sub-state label/color per row regardless of which status
  // filter (if any) is active.
  const completedIdsOnPage = (requests as any[])
    .filter((r) => r.status === "completed")
    .map((r) => r.id as string);
  const verificationBucketsMap = await computeCompletedVerificationBuckets(supabase, completedIdsOnPage);
  const verificationBuckets = Object.fromEntries(verificationBucketsMap);

  function pageHref(p: number) {
    const sp = new URLSearchParams();
    if (category) sp.set("category", category);
    if (projectId) sp.set("project", projectId);
    if (requestorId) sp.set("requestor", requestorId);
    if (coordinatorId) sp.set("coordinator", coordinatorId);
    if (technicianId) sp.set("technician", technicianId);
    if (priority) sp.set("priority", priority);
    if (status) sp.set("status", status);
    if (dateFrom) sp.set("from", dateFrom);
    if (dateTo) sp.set("to", dateTo);
    if (due) sp.set("due", due);
    if (search) sp.set("search", search);
    if (sort && sort !== "newest") sp.set("sort", sort);
    sp.set("page", String(p));
    return `/requests?${sp.toString()}`;
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isCoordinator
              ? "Requests assigned to you."
              : isStaff
              ? "All requests across the team."
              : isTechnician
              ? "Jobs assigned to you."
              : "Requests you've submitted."}
            {total > 0 && (
              <span className="text-slate-400">
                {" "}
                — {total} total, showing {from + 1}–{Math.min(to + 1, total)}
              </span>
            )}
          </p>
        </div>
        {!isTechnician && canDo(profile, "create_request") && (
          <Link
            href="/requests/new"
            className="bg-[var(--accent)] text-white rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            New Request
          </Link>
        )}
      </div>

      <RequestsFilterBar
        isStaff={isStaff}
        isCoordinator={isCoordinator}
        requestorOptions={requestorOptions}
        coordinatorOptions={coordinatorOptions}
        technicianOptions={technicianOptions}
        statusOptions={statusOptions}
        projectOptions={projectOptions}
      />

      <RequestsTable
        requests={requests as any}
        stageList={stageList}
        isStaff={isStaff}
        isManager={isManager}
        canDelete={canDo(profile, "delete_request")}
        verificationBuckets={verificationBuckets}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Link
            href={pageHref(page - 1)}
            aria-disabled={page <= 1}
            className={`text-sm rounded-md px-3 py-1.5 border ${
              page <= 1
                ? "pointer-events-none text-slate-300 border-slate-200"
                : "text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            ← Previous
          </Link>
          <p className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </p>
          <Link
            href={pageHref(page + 1)}
            aria-disabled={page >= totalPages}
            className={`text-sm rounded-md px-3 py-1.5 border ${
              page >= totalPages
                ? "pointer-events-none text-slate-300 border-slate-200"
                : "text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}
