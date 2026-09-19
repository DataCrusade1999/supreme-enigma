import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultPanel } from "./ResultPanel";
import type { AffordResult } from "../../lib/money-planner";

const TODAY = "2026-09-19";

function panel(result: AffordResult) {
  render(<ResultPanel result={result} targetName="Camera" today={TODAY} />);
}

describe("ResultPanel", () => {
  it("shows the date and how far off it is", () => {
    panel({
      kind: "date",
      date: "2027-03-04",
      balanceThen: 125_000,
      timeline: [{ date: "2026-10-01", label: "Salary", delta: 80_000, balanceAfter: 80_000 }],
    });
    expect(screen.getByText("4 March 2027")).toBeInTheDocument();
    expect(screen.getByText(/5 months away/)).toBeInTheDocument();
    expect(screen.getByText(/Camera/)).toBeInTheDocument();
  });

  it("lists the events behind the answer", () => {
    // The answer date differs from every timeline date on purpose: the heading
    // renders a long date too, and a shared one would match twice.
    panel({
      kind: "date",
      date: "2026-11-01",
      balanceThen: 160_000,
      timeline: [
        { date: "2026-10-01", label: "Salary", delta: 80_000, balanceAfter: 80_000 },
        { date: "2026-10-04", label: "Wifi", delta: -1_800, balanceAfter: 78_200 },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /how this adds up/i }));
    expect(screen.getByText("1 October 2026")).toBeInTheDocument();
    expect(screen.getByText("Wifi")).toBeInTheDocument();
  });

  it("says the money is already there", () => {
    panel({ kind: "already" });
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it("gives the monthly shortfall when the net is negative", () => {
    panel({ kind: "unreachable", reason: "negative", monthlyNet: -4_200 });
    expect(screen.getByText(/4,200 short each month/)).toBeInTheDocument();
  });

  it("says more than ten years rather than never when the net is positive", () => {
    panel({ kind: "unreachable", reason: "horizon", monthlyNet: 1_000 });
    expect(screen.getByText(/more than ten years/i)).toBeInTheDocument();
    expect(screen.queryByText(/short each month/)).not.toBeInTheDocument();
  });

  it("lists what is wrong with an invalid plan", () => {
    panel({ kind: "invalid", problems: ["Pay day must be a whole day between 1 and 31"] });
    expect(screen.getByText("Pay day must be a whole day between 1 and 31")).toBeInTheDocument();
  });
});
