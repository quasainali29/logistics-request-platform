import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getProfile } from "@/lib/auth";
import { getActiveProjects, getActiveDepartments } from "@/lib/cachedLookups";
import {
  MAINTENANCE_TYPES,
  PURCHASING_CATEGORIES,
  NATURE_OF_WORK_OPTIONS,
  LABOR_TYPES,
} from "@/lib/types";

// Turns a free-text description on the New Request form into a best-guess
// set of structured field values via Claude, which the requester then
// reviews/edits before submitting -- this route never creates or touches a
// request itself, it only proposes values for the existing createRequest
// flow. Kept deliberately lenient: any field the model can't confidently
// fill (or that fails validation against the real Project/Department/enum
// lists) is simply left null rather than guessed.

const CATEGORIES = ["delivery", "labor", "maintenance", "procurement"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];
type Category = (typeof CATEGORIES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function isoDate(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}
function isoTime(v: unknown): string | null {
  return typeof v === "string" && TIME_RE.test(v) ? v : null;
}
function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function POST(req: NextRequest) {
  const profile = await getProfile().catch(() => null);
  if (!profile || profile.role === "technician") {
    return NextResponse.json({ error: "Not available for this account." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Auto-fill isn't set up yet. Ask an admin to add the ANTHROPIC_API_KEY environment variable." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "No description provided." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "That's a bit long -- try trimming it down." }, { status: 400 });
  }

  const [projects, departments] = await Promise.all([getActiveProjects(), getActiveDepartments()]);
  const projectIds = projects.map((p) => p.id);
  const departmentNames = departments.map((d) => d.name);
  const maintenanceTypes = MAINTENANCE_TYPES as readonly string[];
  const purchasingCategories = PURCHASING_CATEGORIES.map((c) => c.value);
  const laborTypes = LABOR_TYPES.map((t) => t.value);
  const natureOfWork = NATURE_OF_WORK_OPTIONS.map((o) => o.value);

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const systemPrompt = `You extract structured facilities/logistics request fields from a short free-text description, by calling the fill_request_form tool exactly once.

Today is ${todayLabel} (${todayIso}). Resolve any relative dates ("Friday", "tomorrow", "next week", "in 3 days") against this date and always output dates as YYYY-MM-DD.

Valid projects (id = name):
${projects.map((p) => `${p.id} = ${p.name}`).join("\n") || "(none configured)"}

Valid departments: ${departmentNames.join(", ") || "(none configured)"}

Rules:
- Only set project_id to one of the exact IDs listed above, and only if that project is clearly referenced (by name or an obvious close variant) in the text. Otherwise omit it.
- Only set department to one of the exact names listed above, and only if clearly implied. Otherwise omit it.
- Pick the single best-matching category (delivery, labor, maintenance, or procurement). Only include the matching category's detail object (delivery / maintenance / procurement / labor); omit the other three entirely.
- title: a short, specific summary (well under 12 words), not the full description.
- description: a clear 1-3 sentence restatement of the request, close to the user's own words.
- For item lists (delivery items, procurement line items, labor personnel lines), include every distinct item/role mentioned with whatever detail is stated. If none are mentioned, return an empty array.
- Never invent a fact (a location, vendor, quantity, or date) that isn't stated or strongly implied by the text. Omit fields you're not confident about rather than guessing.`;

  const tool = {
    name: "fill_request_form",
    description: "Structured fields extracted from the user's free-text request description.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: { type: "string", enum: CATEGORIES as unknown as string[] },
        title: { type: "string" },
        priority: { type: "string", enum: PRIORITIES as unknown as string[] },
        project_id: { type: "string", enum: projectIds },
        department: { type: "string", enum: departmentNames },
        date_required: { type: "string", description: "YYYY-MM-DD" },
        conclude_date: { type: "string", description: "YYYY-MM-DD" },
        description: { type: "string" },
        special_instructions: { type: "string" },
        delivery: {
          type: "object",
          properties: {
            delivery_location: { type: "string" },
            delivery_requested_date: { type: "string", description: "YYYY-MM-DD" },
            delivery_requested_time: { type: "string", description: "HH:MM 24h" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_name: { type: "string" },
                  required_quantity: { type: "number" },
                  current_location: { type: "string" },
                },
                required: ["item_name"],
              },
            },
          },
        },
        maintenance: {
          type: "object",
          properties: {
            location_area: { type: "string" },
            maintenance_type: { type: "string", enum: maintenanceTypes as unknown as string[] },
            urgency: { type: "string", enum: PRIORITIES as unknown as string[] },
            maintenance_date: { type: "string", description: "YYYY-MM-DD" },
            maintenance_time: { type: "string", description: "HH:MM 24h" },
          },
        },
        procurement: {
          type: "object",
          properties: {
            purchasing_category: { type: "string", enum: purchasingCategories },
            purchasing_category_other: { type: "string" },
            vendor: { type: "string" },
            procurement_needed_by: { type: "string", description: "YYYY-MM-DD" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item_description: { type: "string" },
                  quantity: { type: "number" },
                  purchasing_link: { type: "string" },
                },
                required: ["item_description"],
              },
            },
          },
        },
        labor: {
          type: "object",
          properties: {
            labor_date_from: { type: "string", description: "YYYY-MM-DD" },
            labor_date_to: { type: "string", description: "YYYY-MM-DD" },
            lines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  personnel_type: { type: "string", enum: laborTypes },
                  nature_of_work: { type: "string", enum: natureOfWork },
                  quantity: { type: "number" },
                },
                required: ["personnel_type"],
              },
            },
          },
        },
      },
      required: ["category", "title", "description"],
    },
  };

  let toolInput: Record<string, unknown>;
  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
      tools: [tool],
      tool_choice: { type: "tool", name: "fill_request_form" },
    });
    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUse) {
      return NextResponse.json({ error: "Couldn't parse that description. Try rephrasing." }, { status: 502 });
    }
    toolInput = toolUse.input as Record<string, unknown>;
  } catch (err) {
    console.error("auto-fill anthropic call failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Auto-fill is temporarily unavailable. Try again shortly." }, { status: 502 });
  }

  const category = pick<Category>(toolInput.category, CATEGORIES);

  const deliveryRaw = obj(toolInput.delivery);
  const maintenanceRaw = obj(toolInput.maintenance);
  const procurementRaw = obj(toolInput.procurement);
  const laborRaw = obj(toolInput.labor);

  const result = {
    category,
    title: str(toolInput.title),
    priority: pick<Priority>(toolInput.priority, PRIORITIES),
    project_id: (() => {
      const v = str(toolInput.project_id);
      return v && projectIds.includes(v) ? v : null;
    })(),
    department: (() => {
      const v = str(toolInput.department);
      return v && departmentNames.includes(v) ? v : null;
    })(),
    date_required: isoDate(toolInput.date_required),
    conclude_date: isoDate(toolInput.conclude_date),
    description: str(toolInput.description),
    special_instructions: str(toolInput.special_instructions),
    delivery:
      category === "delivery" && deliveryRaw
        ? {
            delivery_location: str(deliveryRaw.delivery_location),
            delivery_requested_date: isoDate(deliveryRaw.delivery_requested_date),
            delivery_requested_time: isoTime(deliveryRaw.delivery_requested_time),
            items: arr(deliveryRaw.items)
              .map((it) => obj(it))
              .filter((it): it is Record<string, unknown> => !!it && !!str(it.item_name))
              .map((it) => ({
                item_name: str(it.item_name) as string,
                required_quantity: num(it.required_quantity),
                current_location: str(it.current_location),
              })),
          }
        : null,
    maintenance:
      category === "maintenance" && maintenanceRaw
        ? {
            location_area: str(maintenanceRaw.location_area),
            maintenance_type: pick(maintenanceRaw.maintenance_type, maintenanceTypes),
            urgency: pick<Priority>(maintenanceRaw.urgency, PRIORITIES),
            maintenance_date: isoDate(maintenanceRaw.maintenance_date),
            maintenance_time: isoTime(maintenanceRaw.maintenance_time),
          }
        : null,
    procurement:
      category === "procurement" && procurementRaw
        ? {
            purchasing_category: pick(procurementRaw.purchasing_category, purchasingCategories),
            purchasing_category_other: str(procurementRaw.purchasing_category_other),
            vendor: str(procurementRaw.vendor),
            procurement_needed_by: isoDate(procurementRaw.procurement_needed_by),
            items: arr(procurementRaw.items)
              .map((it) => obj(it))
              .filter((it): it is Record<string, unknown> => !!it && !!str(it.item_description))
              .map((it) => ({
                item_description: str(it.item_description) as string,
                quantity: num(it.quantity),
                purchasing_link: str(it.purchasing_link),
              })),
          }
        : null,
    labor:
      category === "labor" && laborRaw
        ? {
            labor_date_from: isoDate(laborRaw.labor_date_from),
            labor_date_to: isoDate(laborRaw.labor_date_to),
            lines: arr(laborRaw.lines)
              .map((l) => obj(l))
              .filter((l): l is Record<string, unknown> => !!l && !!pick(l.personnel_type, laborTypes))
              .map((l) => ({
                personnel_type: pick(l.personnel_type, laborTypes) as string,
                nature_of_work: pick(l.nature_of_work, natureOfWork),
                quantity: num(l.quantity),
              })),
          }
        : null,
  };

  return NextResponse.json({ result });
}
