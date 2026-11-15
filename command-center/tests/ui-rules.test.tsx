import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../components/SafeMarkdown";
import { applyFilters, parseFilters } from "../lib/board";
import { formatCost, formatPayback, formatSales, formatTime } from "../lib/format";
import { makeData } from "./helpers";

describe("SafeMarkdown (BR-18, BR-17)", () => {
  it("drops raw HTML, scripts, javascript: links and images", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>{`# Hi\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) ![pic](https://example.com/a.png) **ok**`}</SafeMarkdown>,
    );
    expect(html).not.toMatch(/<script|onerror|javascript:|<img/i);
    expect(html).toContain("<strong>ok</strong>");
  });
});

describe("formatting (CC-10 AC2, CC-13, BR-14)", () => {
  it("shows Pending for missing values and formats CAD", () => {
    expect(formatCost(null)).toBe("Pending");
    expect(formatCost(45)).toBe("CA$45.00");
    expect(formatSales(null)).toBe("Pending");
    expect(formatSales(12)).toBe("12");
    expect(formatPayback({ payback_weeks: null, payback_na_reason: null }).text).toBe("Pending");
    expect(formatPayback({ payback_weeks: 0, payback_na_reason: null }).text).toBe("0 wk");
    expect(formatPayback({ payback_weeks: null, payback_na_reason: "No revenue model" })).toEqual({ text: "n/a", tooltip: "No revenue model" });
  });
  it("displays UTC in America/Toronto with a zone label", () => {
    expect(formatTime("2026-11-15T17:00:00.000Z")).toMatch(/EST/);
    expect(formatTime("2026-07-15T17:00:00.000Z")).toMatch(/EDT/);
  });
});

describe("board filters (CC-15)", () => {
  it("filters and sorts, with nulls last", () => {
    const { data } = makeData();
    const a = data.ideas.create({ name: "A", owning_lead_bot: "PMBot" });
    const b = data.ideas.create({ name: "B", owning_lead_bot: "MarketingStrategyBot" });
    data.ideas.updateFields(a.id, { startup_cost_cad: 50, risk_rating: "R" }, { kind: "owner", name: "Ananya" });
    const all = data.ideas.list();
    expect(applyFilters(all, parseFilters({ owner: "PMBot" })).map((i) => i.name)).toEqual(["A"]);
    expect(applyFilters(all, parseFilters({ risk: "Pending" })).map((i) => i.name)).toEqual(["B"]);
    expect(applyFilters(all, parseFilters({ sort: "cost" })).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(parseFilters({ stage: "bogus", sort: "x" })).toMatchObject({ stage: "", sort: "updated" });
  });
});
