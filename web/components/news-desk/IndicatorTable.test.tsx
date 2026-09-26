import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IndicatorTable } from "./IndicatorTable";
import type { IndicatorValue } from "../../lib/news-desk/types";

const NOW = new Date("2026-09-26T12:00:00.000Z");

const fresh: IndicatorValue = {
  id: "cpi-headline",
  label: "Retail inflation",
  unit: "%",
  period: "Aug 2026",
  latest: 4.82,
  prevPeriod: "Jul 2026",
  prev: 4.45,
  lastGoodAt: "2026-09-26T11:00:00.000Z",
};

describe("IndicatorTable", () => {
  it("shows each indicator's period, latest and previous value", () => {
    render(<IndicatorTable indicators={[fresh]} now={NOW} />);
    const table = screen.getByRole("table", { name: "Official indicators" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Indicator",
      "Period",
      "Latest",
      "Prev",
    ]);
    const [, row] = within(table).getAllByRole("row");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Retail inflation",
      "Aug 2026",
      "4.82%",
      "4.45%",
    ]);
    expect(within(row).getByText("4.45%")).toHaveAttribute("title", "Jul 2026");
  });

  it("marks a row whose last refresh failed, keeping its last good value", () => {
    render(
      <IndicatorTable indicators={[{ ...fresh, error: "MoSPI status 503" }]} now={NOW} />,
    );
    expect(screen.getByText("4.82%")).toBeInTheDocument();
    expect(screen.getByText("stale")).toHaveAttribute(
      "title",
      "Stale since 1h ago. The last refresh failed: MoSPI status 503",
    );
  });

  it("shows a dash for an indicator that has never loaded", () => {
    const never: IndicatorValue = {
      ...fresh,
      period: null,
      latest: null,
      prevPeriod: null,
      prev: null,
      lastGoodAt: null,
      error: "MoSPI rejected the query: Invalid parameters",
    };
    render(<IndicatorTable indicators={[never]} now={NOW} />);
    const [, row] = screen.getAllByRole("row");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Retail inflationnot loaded",
      "—",
      "—",
      "—",
    ]);
    expect(screen.getByText("not loaded")).toHaveAttribute(
      "title",
      "Not loaded yet: MoSPI rejected the query: Invalid parameters",
    );
  });

  it("says when there are no indicators yet", () => {
    render(<IndicatorTable indicators={[]} now={NOW} />);
    expect(screen.getByText("Indicators load on the next Refresh.")).toBeInTheDocument();
  });
});
