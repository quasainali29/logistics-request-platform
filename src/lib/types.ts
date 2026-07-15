// Roles are now admin-managed (see the `roles` table) rather than a fixed
// union — any string key existing in the roles table is valid. The 4 roles
// below still ship as the seeded defaults.
export type Role = string;

export interface RoleRow {
  name: string;
  label: string;
  description: string | null;
  is_staff: boolean;
  is_manager: boolean;
  created_at: string;
}

export interface RoleRequestRow {
  id: string;
  user_id: string;
  requested_role: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  user?: Profile;
}

export type Category = "delivery" | "labor" | "maintenance" | "procurement";

// Statuses are now admin-managed per category (see the `workflow_stages`
// table) rather than a fixed union.
export type RequestStatus = string;

export interface WorkflowStage {
  id: string;
  category: Category;
  key: string;
  label: string;
  color: string;
  sort_order: number;
  is_initial: boolean;
  is_terminal: boolean;
}

export interface WorkflowTransition {
  id: string;
  category: Category;
  from_key: string;
  to_key: string;
  label: string;
  variant: "primary" | "danger" | "secondary";
  allowed_roles: string[];
  sort_order: number;
}

export interface AppSettings {
  id: boolean;
  org_name: string;
  logo_url: string | null;
  accent_color: string;
  updated_at: string;
}

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  department: string | null;
  status: "active" | "inactive";
  // Derived from the joined `roles` row for the profile's current role.
  // Populated by getProfile(); defaults to false if the role lookup fails.
  is_staff?: boolean;
  is_manager?: boolean;
}

export interface RequestRow {
  id: string;
  request_number: string;
  title: string;
  category: Category;
  requestor_id: string;
  project_id: string | null;
  project: string | null;
  department: string | null;
  priority: Priority;
  status: RequestStatus;
  date_requested: string;
  date_required: string | null;
  conclude_date: string | null;
  description: string | null;
  special_instructions: string | null;
  owner_id: string | null;
  approved_by: string | null;
  approval_date: string | null;
  created_at: string;
  updated_at: string;
  requestor?: Profile;
  owner?: Profile;
}

export interface AttachmentFile {
  name: string;
  url: string;
}

export interface DeliveryDetails {
  id: string;
  request_id: string;
  delivery_location: string | null;
  requested_date: string | null;
  requested_time: string | null;
  files: AttachmentFile[];
}

export interface DeliveryItem {
  id: string;
  request_id: string;
  item_no: number;
  item_name: string;
  required_quantity: number;
  image_url: string | null;
  current_location: string | null;
}

export const MAINTENANCE_TYPES = [
  "Electrical",
  "Plumbing",
  "HVAC",
  "Structural",
  "Equipment",
  "Painting",
  "Cleaning",
  "Other",
] as const;

export interface MaintenanceDetails {
  id: string;
  request_id: string;
  location_area: string | null;
  maintenance_type: string | null;
  urgency: "low" | "medium" | "high" | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  photos: AttachmentFile[];
  work_permit: AttachmentFile[];
}

export const PURCHASING_CATEGORIES = [
  { value: "tools", label: "Tools" },
  { value: "it_equipment", label: "IT Equipment" },
  { value: "av_equipment", label: "AV Equipment" },
  { value: "electrical_equipment", label: "Electrical Equipment" },
  { value: "other", label: "Other" },
] as const;

export interface ProcurementDetails {
  id: string;
  request_id: string;
  purchasing_category: string | null;
  purchasing_category_other: string | null;
  vendor: string | null;
  needed_by_date: string | null;
}

export interface ProcurementItem {
  id: string;
  request_id: string;
  item_no: number;
  item_description: string | null;
  quantity: number;
  image_url: string | null;
  purchasing_link: string | null;
}

export const NATURE_OF_WORK_OPTIONS = [
  { value: "loading_unloading", label: "Loading / Unloading" },
  { value: "setup_installation", label: "Setup / Installation" },
  { value: "removal_dismantling", label: "Removal / Dismantling" },
] as const;

export const LABOR_TYPES = [
  { value: "labor", label: "Labor" },
  { value: "welder", label: "Welder" },
  { value: "carpenter", label: "Carpenter" },
  { value: "rigger", label: "Rigger" },
  { value: "electrician", label: "Electrician" },
] as const;

export interface LaborLine {
  id: string;
  request_id: string;
  personnel_type: string | null;
  quantity: number;
  date_from: string | null;
  date_to: string | null;
  nature_of_work: string | null;
}

// Closeout documents required before a request can move from Completed to
// Closed. One row per request; only the fields relevant to that request's
// category are ever populated.
export interface RequestCloseout {
  id: string;
  request_id: string;
  delivery_note: AttachmentFile | null;
  delivery_location: string | null;
  labor_sheet: AttachmentFile | null;
  maintenance_form: AttachmentFile | null;
  maintenance_photos: AttachmentFile[];
  invoice: AttachmentFile | null;
  procurement_photos: AttachmentFile[];
  total_value: number | null;
  closed_by: string | null;
  closed_at: string;
}

export interface LaborCloseoutLine {
  id: string;
  request_id: string;
  personnel_type: string;
  quantity: number;
  cost_per_labor: number;
  total_value: number;
}

// Fallback labels for the 4 seeded roles, used only when a `roles` row isn't
// available to look up (e.g. a stale client cache). Prefer passing the real
// roles list into formatRoleLabel() wherever one is in scope.
export const ROLE_LABELS: Record<string, string> = {
  requestor: "Requestor",
  logistics_coordinator: "Logistics Coordinator",
  logistics_manager: "Logistics Manager",
  warehouse_team: "Warehouse Team",
};

export function formatRoleLabel(roleName: string, roles?: RoleRow[]): string {
  const fromList = roles?.find((r) => r.name === roleName)?.label;
  if (fromList) return fromList;
  if (ROLE_LABELS[roleName]) return ROLE_LABELS[roleName];
  // Unknown custom role with no roles list in scope — humanize the slug.
  return roleName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Fallback status labels/colors — the seeded defaults, used only when a
// workflow_stages row isn't available to look up. Prefer passing the real
// stage list into formatStatusLabel()/statusColor() wherever one is in scope.
export const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  under_process: "Under Process",
  under_review: "Under Review",
  returned_for_info: "Returned for Info",
  approved: "Approved",
  planning: "Planning",
  assigned: "Assigned",
  dispatched: "Dispatched",
  on_site: "On Site",
  completed: "Completed",
  closed: "Closed",
  rejected: "Rejected",
};

export const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700",
  under_process: "bg-amber-100 text-amber-800",
  under_review: "bg-amber-100 text-amber-800",
  returned_for_info: "bg-orange-100 text-orange-800",
  approved: "bg-blue-100 text-blue-800",
  planning: "bg-indigo-100 text-indigo-800",
  assigned: "bg-indigo-100 text-indigo-800",
  dispatched: "bg-purple-100 text-purple-800",
  on_site: "bg-purple-100 text-purple-800",
  completed: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-600",
  rejected: "bg-red-100 text-red-800",
};

export function formatStatusLabel(
  category: string,
  statusKey: string,
  stages?: WorkflowStage[]
): string {
  const fromList = stages?.find((s) => s.category === category && s.key === statusKey)?.label;
  if (fromList) return fromList;
  if (STATUS_LABELS[statusKey]) return STATUS_LABELS[statusKey];
  return statusKey
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function statusColor(
  category: string,
  statusKey: string,
  stages?: WorkflowStage[]
): string {
  const fromList = stages?.find((s) => s.category === category && s.key === statusKey)?.color;
  return fromList ?? STATUS_COLORS[statusKey] ?? "bg-slate-100 text-slate-700";
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  delivery: "Delivery",
  labor: "Labor",
  maintenance: "Maintenance",
  procurement: "Procurement",
};
