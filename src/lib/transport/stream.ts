import type { HubSearchResult } from "./hub-search";

/** Each result replaces the previous snapshot for the same query; only done is authoritative completion. */
export type TransportSearchEvent =
  | { t: "result"; result: HubSearchResult; done: boolean }
  | { t: "failed" };
