// How each tool call reads in Pip's reply: what Pip's doing, then what it did. Shared by Pip in a trip room and on
// the home globe.

/**
 * The step line for a tool call, or null for calls not worth a line: reading the trip is bookkeeping, and edit_plan's
 * changes card says it better.
 */
export function stepLabel(tool: string, output: unknown = null): { doing: string; done: string } | null {
  const o = (output ?? {}) as { refused?: string; total?: number; searched?: number; options?: unknown[]; found?: number };
  const n = (count: number | undefined, one: string, many: string) => (count === undefined ? many : `${count} ${count === 1 ? one : many}`);
  const failed = !!o.refused;
  switch (tool) {
    case "get_leg_options":
      return { doing: "Checking fares", done: failed ? "Couldn't find that leg" : `Checked ${n(o.total, "fare", "fares")}` };
    case "get_split":
      return { doing: "Working out who pays what", done: "Worked out who pays what" };
    case "find_meetup":
      return {
        doing: "Comparing places to meet",
        done: failed ? "Couldn't place everyone" : o.options?.length ? `Compared ${n(o.searched, "route", "routes")}` : "No place works for everyone",
      };
    case "apply_meetup":
      return { doing: "Adding it to the trip", done: failed ? "Couldn't add it" : "Added it to the trip" };
    case "plan_trip":
      return { doing: "Putting it on the globe", done: failed ? "Couldn't place that" : "Put it on the globe" };
    case "search_routes":
      return { doing: "Searching routes", done: failed ? "Couldn't search that" : o.found ? `Found ${n(o.found, "route", "routes")}` : "No routes found" };
    default:
      return null;
  }
}
