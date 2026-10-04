import type { DeepSeekLanguageModelChatOptions } from "@ai-sdk/deepseek";

type Effort = NonNullable<DeepSeekLanguageModelChatOptions["reasoningEffort"]>;

/**
 * Tools whose results Pip has to weigh before it writes: fares across routes and cities, entry rules across passports.
 * After one of these, the steps that read the results and put the plan together think hard.
 */
export const THINK_AFTER = new Set([
  "find_meetup", "plan_group", "optimize_leg", "optimize_route", "search_routes", "search_nearby_trains", "check_entry", "get_leg_options",
]);

/**
 * How hard DeepSeek thinks on each step, decided by what Pip has done, not by reading the message. Picking a tool
 * is easy, so the first step thinks little; that alone answers or edits most messages. Once a planning tool has
 * returned, the rest of the run thinks hard. The API has low, high and max; "medium" is an alias for high.
 */
export function effortFor(steps: readonly { toolCalls: readonly { toolName: string }[] }[]): Effort {
  return steps.some((s) => s.toolCalls.some((c) => THINK_AFTER.has(c.toolName))) ? "high" : "low";
}

/** streamText's prepareStep: per-step DeepSeek options. */
export const prepareEffort = ({ steps }: { steps: readonly { toolCalls: readonly { toolName: string }[] }[] }) => ({
  providerOptions: { deepseek: { reasoningEffort: effortFor(steps) } satisfies DeepSeekLanguageModelChatOptions },
});
