import { format, subDays } from "date-fns";

// Shared date-range parsing for report pages/CSV routes. Defaults to the
// trailing 30 days when the request has no `from`/`to` query params yet
// (first load), while letting the filter form override either side.
export function parseDateRange(params: { from?: string; to?: string }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const defaultFrom = format(subDays(new Date(), 30), "yyyy-MM-dd");

  return {
    from: params.from || defaultFrom,
    to: params.to || today,
  };
}
