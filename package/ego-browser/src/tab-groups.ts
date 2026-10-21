/**
 * Pure tab-grouping logic for `TaskSpace.groupTabs()`.
 *
 * Kept free of any browser/CDP dependency so the grouping behaviour can be
 * unit-tested in isolation (see `tab-groups.test.mjs`). The task-space method
 * merely feeds the reconciled tab inventory through `groupTabs` and maps the
 * result back onto the public API shape.
 */

/**
 * Ordering dimensions for automated tab grouping, applied left-to-right so an
 * array like `["domain", "active"]` nests by domain first, then by activity.
 */
export type TabGroupDimension =
  "domain" | "subdomain" | "title" | "active" | "openedBy";

export const TAB_GROUP_DIMENSIONS: readonly TabGroupDimension[] = [
  "domain",
  "subdomain",
  "title",
  "active",
  "openedBy",
];

/** Explicit rule-based group a tab can be assigned to (first match wins). */
export type TabGroupRule = {
  /** Group name shown in the returned structure. */
  name: string;
  /** Match when the tab hostname equals or is a subdomain of one of these. */
  domains?: string[];
  /** Match when the tab title contains any of these (case-insensitive). */
  titleKeywords?: string[];
  /** Match when the tab is the active tab (true) or not (false). */
  active?: boolean;
  /** Match when the tab was opened by this origin. */
  openedBy?: "agent" | "unknown";
};

/** Lightweight, serializable description of one tab inside a group. */
export type TabGroupSummary = {
  targetId: string;
  label?: string;
  title: string;
  url: string;
  active: boolean;
  openedBy: string;
};

/** A named group of tabs produced by `groupTabs`. */
export type TabGroup = {
  name: string;
  count: number;
  tabs: TabGroupSummary[];
};

export type GroupTabsOptions = {
  by?: TabGroupDimension | TabGroupDimension[];
  groups?: TabGroupRule[];
};

/** Fields a tab inventory item must expose for grouping. */
export type GroupableTab = {
  targetId: string;
  label?: string;
  title: string;
  url: string;
  active: boolean;
  openedBy: string;
};

const UNGROUPED = "(未分组)";
const UNTITLED = "(untitled)";
const UNKNOWN_HOST = "unknown";

/** Extract a lowercased hostname, tolerating non-URL-friendly inputs. */
export function tabHostname(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname) return parsed.hostname.toLowerCase();
  } catch {
    // fall through to the raw-input fallback
  }
  const cleaned = url.trim();
  return cleaned.length > 0 ? cleaned.toLowerCase() : UNKNOWN_HOST;
}

/** Registrable-ish domain: hostname with a leading bare `www.` stripped. */
export function registrableDomain(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

/** First whitespace-separated token of a title, punctuation trimmed. */
export function titleKeyword(title: string): string {
  const token = title.trim().split(/\s+/)[0] ?? "";
  const keyword = token
    .toLowerCase()
    .replace(/^[^a-z0-9\u4e00-\u9fff]+|[^a-z0-9\u4e00-\u9fff]+$/g, "");
  return keyword.length > 0 ? keyword : UNTITLED;
}

/** Compute a tab's single-dimension grouping key. */
export function dimensionKey(
  dimension: TabGroupDimension,
  tab: GroupableTab,
): string {
  switch (dimension) {
    case "domain":
      return registrableDomain(tabHostname(tab.url));
    case "subdomain":
      return tabHostname(tab.url);
    case "title":
      return titleKeyword(tab.title);
    case "active":
      return tab.active ? "active" : "inactive";
    case "openedBy":
      return tab.openedBy || "unknown";
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  const d = domain.toLowerCase();
  return hostname === d || hostname.endsWith(`.${d}`);
}

function ruleMatches(tab: GroupableTab, rule: TabGroupRule): boolean {
  if (rule.domains !== undefined) {
    const hostname = tabHostname(tab.url);
    if (!rule.domains.some((d) => hostMatches(hostname, d))) return false;
  }
  if (rule.titleKeywords !== undefined) {
    const haystack = tab.title.toLowerCase();
    if (
      !rule.titleKeywords.some(
        (k) => k.toLowerCase() && haystack.includes(k.toLowerCase()),
      )
    ) {
      return false;
    }
  }
  if (rule.active !== undefined && tab.active !== rule.active) return false;
  if (rule.openedBy !== undefined && tab.openedBy !== rule.openedBy)
    return false;
  return true;
}

function isEmptyGroup(rule: TabGroupRule): boolean {
  return (
    (rule.domains === undefined || rule.domains.length === 0) &&
    (rule.titleKeywords === undefined || rule.titleKeywords.length === 0) &&
    rule.active === undefined &&
    rule.openedBy === undefined
  );
}

/** Group tab summaries by a dimension list, producing `"a / b / c"` keys. */
function groupByDimension(
  tabs: GroupableTab[],
  dimensions: TabGroupDimension[],
): Map<string, GroupableTab[]> {
  const buckets = new Map<string, GroupableTab[]>();
  for (const tab of tabs) {
    const keys = dimensions.map((d) => dimensionKey(d, tab));
    const name = keys.length > 0 ? keys.join(" / ") : UNGROUPED;
    const list = buckets.get(name) ?? [];
    list.push(tab);
    buckets.set(name, list);
  }
  return buckets;
}

/**
 * Group tabs by explicit rules (first match wins) and, for the remaining tabs,
 * by the automated dimension list. Rule groups are returned first in declared
 * order, then automated groups sorted by name, then any residual tabs under
 * "(未分组)".
 */
export function groupTabs(
  tabs: GroupableTab[],
  options: GroupTabsOptions = {},
): TabGroup[] {
  const dimensions: TabGroupDimension[] = Array.isArray(options.by)
    ? options.by
    : options.by
      ? [options.by]
      : ["domain"];
  const rules = options.groups ?? [];
  const ruleGroups: { name: string; tabs: GroupableTab[] }[] = rules.map(
    (rule) => ({ name: rule.name, tabs: [] }),
  );
  const unassigned: GroupableTab[] = [];
  const seen = new Set<GroupableTab>();

  for (const tab of tabs) {
    let matched = -1;
    for (let i = 0; i < rules.length; i++) {
      if (isEmptyGroup(rules[i])) continue;
      if (ruleMatches(tab, rules[i])) {
        matched = i;
        break;
      }
    }
    if (matched >= 0) {
      ruleGroups[matched].tabs.push(tab);
      seen.add(tab);
    }
  }
  for (const tab of tabs) {
    if (!seen.has(tab)) unassigned.push(tab);
  }

  const groups: TabGroup[] = [];
  for (const g of ruleGroups) {
    if (g.tabs.length > 0) {
      groups.push({
        name: g.name,
        count: g.tabs.length,
        tabs: g.tabs.map(summarizeTab),
      });
    }
  }

  const auto = groupByDimension(unassigned, dimensions);
  const autoNames = [...auto.keys()].sort((a, b) => a.localeCompare(b, "zh"));
  for (const name of autoNames) {
    const list = auto.get(name) ?? [];
    groups.push({ name, count: list.length, tabs: list.map(summarizeTab) });
  }

  return groups;
}

export function summarizeTab(tab: GroupableTab): TabGroupSummary {
  return {
    targetId: tab.targetId,
    label: tab.label,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    openedBy: tab.openedBy,
  };
}
