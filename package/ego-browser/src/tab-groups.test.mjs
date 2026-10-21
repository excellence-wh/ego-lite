import test from "node:test";
import assert from "node:assert/strict";

import {
  dimensionKey,
  groupTabs,
  registrableDomain,
  tabHostname,
  titleKeyword,
} from "../dist/src/tab-groups.js";

// NOTE: tests run against the build output (dist/src/...) per repo convention.

const t = (overrides = {}) => ({
  targetId: "T1",
  label: "p1",
  title: "GitHub · Build software",
  url: "https://github.com/citrolabs/ego-lite",
  active: false,
  openedBy: "agent",
  ...overrides,
});

test("tabHostname lowercases and handles non-URL input", () => {
  assert.equal(tabHostname("https://GitHub.COM/a"), "github.com");
  assert.equal(tabHostname("not a url"), "not a url");
  assert.equal(tabHostname("   "), "unknown");
});

test("registrableDomain strips only a leading bare www.", () => {
  assert.equal(registrableDomain("github.com"), "github.com");
  assert.equal(registrableDomain("www.github.com"), "github.com");
  assert.equal(registrableDomain("a.www.github.com"), "a.www.github.com");
  assert.equal(
    registrableDomain("news.ycombinator.com"),
    "news.ycombinator.com",
  );
});

test("titleKeyword takes the first significant token", () => {
  assert.equal(titleKeyword("GitHub · Build software"), "github");
  assert.equal(titleKeyword("Google"), "google");
  assert.equal(titleKeyword("你好 世界"), "你好");
  assert.equal(titleKeyword("   "), "(untitled)");
});

test("dimensionKey resolves each dimension", () => {
  const tab = t({
    url: "https://news.ycombinator.com/item?id=1",
    title: "Show HN: demo",
    active: true,
    openedBy: "unknown",
  });
  assert.equal(dimensionKey("subdomain", tab), "news.ycombinator.com");
  assert.equal(dimensionKey("domain", tab), "news.ycombinator.com");
  assert.equal(dimensionKey("title", tab), "show");
  assert.equal(dimensionKey("active", tab), "active");
  assert.equal(dimensionKey("openedBy", tab), "unknown");

  const www = t({ url: "https://www.example.com/x" });
  assert.equal(dimensionKey("domain", www), "example.com");
  assert.equal(dimensionKey("subdomain", www), "www.example.com");
});

test("default grouping is by domain", () => {
  const tabs = [
    t({ url: "https://github.com/a" }),
    t({ url: "https://github.com/b" }),
    t({ url: "https://www.example.com/c" }),
    t({ url: "https://docs.example.com/d" }),
  ];
  const groups = groupTabs(tabs);
  const names = groups.map((g) => g.name);
  assert.deepEqual(names, ["docs.example.com", "example.com", "github.com"]);
  const gh = groups.find((g) => g.name === "github.com");
  assert.equal(gh.count, 2);
});

test("multi-dimensional grouping nests in the given order", () => {
  const tabs = [
    t({ url: "https://github.com/a", active: true, title: "Foo" }),
    t({ url: "https://github.com/b", active: false, title: "Bar" }),
    t({ url: "https://github.com/c", active: false, title: "Baz" }),
    t({ url: "https://example.com/x", active: false, title: "Qux" }),
  ];
  const groups = groupTabs(tabs, { by: ["domain", "active"] });
  const map = new Map(groups.map((g) => [g.name, g.count]));
  assert.equal(map.get("github.com / active"), 1);
  assert.equal(map.get("github.com / inactive"), 2);
  assert.equal(map.get("example.com / inactive"), 1);
});

test("explicit rules match first and sort before auto groups", () => {
  const tabs = [
    t({ url: "https://mail.example.com/", title: "Inbox" }),
    t({ url: "https://github.com/x", title: "PR #1" }),
    t({ url: "https://github.com/y", title: "Issue #2" }),
    t({ url: "https://news.example.com/", title: "Top stories" }),
  ];
  const groups = groupTabs(tabs, {
    groups: [
      { name: "开发", domains: ["github.com"] },
      { name: "邮件", titleKeywords: ["inbox"] },
    ],
  });
  assert.deepEqual(
    groups.map((g) => g.name),
    ["开发", "邮件", "news.example.com"],
  );
  assert.equal(groups[0].tabs.length, 2);
  assert.equal(groups[1].tabs.length, 1);
});

test("rule conditions AND together; empty rules never match", () => {
  const tabs = [
    t({ url: "https://github.com/a", active: true }),
    t({ url: "https://github.com/b", active: false }),
  ];
  const groups = groupTabs(tabs, {
    groups: [{ name: "只有活动分支", domains: ["github.com"], active: true }],
  });
  assert.deepEqual(
    groups.map((g) => g.name),
    ["只有活动分支", "github.com"],
  );
  assert.equal(groups[0].tabs.length, 1);
});

test("single string by and include of summarized tabs", () => {
  const groups = groupTabs([t({ title: "Alpha" }), t({ title: "Alpha Two" })], {
    by: "title",
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "alpha");
  assert.equal(groups[0].count, 2);
  const first = groups[0].tabs[0];
  assert.equal(first.targetId, "T1");
  assert.equal(first.openedBy, "agent");
  assert.equal(typeof first.url, "string");
});
