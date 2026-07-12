export type Role =
  | "requestor"
  | "logistics_coordinator"
  | "logistics_manager"
  | "warehouse_team";

export type Category = "delivery" | "labor" | "maintenance" | "procurement";

export type RequestStatus =
  | "submitted"
  | "under_review"
  | "returned_for_info"
  | "approved"
  | "planning"
  | "assigned"
  | "dispatched"
  | "on_site"
  | "completed"
  | "closed"
  | "rejected";

export type Priority = "low" | "medium" | "high" | "urgent";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  department: string | null;
  status: "active" | "inactive";
}

export interface RequestRow {
  id: string;
  request_number: string;
  title: string;
  category: Category;
  requestor_id: string;
  project_id: string | null;
  department: string | null;
  priority: Priority;
  status: RequestStatus;
  date_requested: string;
  date_required: string | null;
  description: string | null;
  special_instructions: string | null;
  owner_id: string | null;
  approved_by: string | null;
  approval_date: string | null;
  created_at: string;
  updated_at: string;
  requestor?: Profile;
}

export const ROLE_LABELS: Record<Role, string> = {
  requestor: "Requestor",
  logistics_coordinator: "Logistics Coordinator",
  logistics_manager: "Logistics Manager",
  warehouse_team: "Warehouse Team",
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "Submitted",
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

export const STATUS_COLORS: Record<RequestStatus, string> = {
  submitted: "bg-slate-100 text-slate-700",
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
