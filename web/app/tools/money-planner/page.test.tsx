// web/app/tools/money-planner/page.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import MoneyPlannerPage from "./page";
import { STORAGE_KEY } from "../../../lib/money-planner-storage";
import type { Plan } from "../../../lib/money-planner";

// CommandBar (rendered here because the tool sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const SAVED: Plan = {
  v: 1,
  balance: 50_000,
  salary: 80_000,
  payDay: 1,
  expenses: [{ id: "e1", name: "Rent", amount: 20_000, everyMonths: 1, nextDue: "2026-10-01" }],
  target: { name: "Camera", price: 90_000 },
};

describe("Money Planner page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the heading", () => {
    render(<MoneyPlannerPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Money Planner" })).toBeInTheDocument();
  });

  it("shows no result at all until something has been entered", () => {
    render(<MoneyPlannerPage />);
    // Not "Price must be more than zero" either — an untouched form has no
    // answer and nothing to complain about.
    expect(screen.queryByText("Not ready")).not.toBeInTheDocument();
    expect(screen.queryByText(/(months?|days?) away/)).not.toBeInTheDocument();
  });

  it("starts every number field blank, so what is typed is the whole value", () => {
    render(<MoneyPlannerPage />);
    for (const label of ["Balance today", "Monthly salary", "Pay day", "Price"]) {
      expect(screen.getByLabelText(label)).toHaveValue(null);
    }
    fireEvent.change(screen.getByLabelText("Monthly salary"), { target: { value: "5000" } });
    expect(screen.getByLabelText("Monthly salary")).toHaveValue(5000);
  });

  it("asks for the fields still blank once something has been entered", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "90000" } });
    await waitFor(() =>
      expect(
        screen.getByText("Balance must be a whole number of rupees, zero or more"),
      ).toBeInTheDocument(),
    );
  });

  it("shows the blank form over the all-zero plan earlier versions saved", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, balance: 0, salary: 0, payDay: 1, expenses: [], target: { name: "", price: 0 } }),
    );
    render(<MoneyPlannerPage />);
    // Let the post-mount load run before asserting nothing came of it.
    await waitFor(() => expect(screen.getByLabelText("Balance today")).toHaveValue(null));
    expect(screen.getByLabelText("Pay day")).toHaveValue(null);
  });

  it("renders a hand-edited saved plan that has no target instead of crashing", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, balance: 100, salary: 100, payDay: 5, expenses: [] }),
    );
    render(<MoneyPlannerPage />);
    await waitFor(() => expect(screen.getByLabelText("Balance today")).toHaveValue(100));
    expect(screen.getByLabelText("What are you buying")).toHaveValue("");
    expect(screen.getByText("Not ready")).toBeInTheDocument();
  });

  it("loads a saved plan after mount", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
    render(<MoneyPlannerPage />);
    await waitFor(() => expect(screen.getByLabelText("Balance today")).toHaveValue(50_000));
    expect(screen.getByDisplayValue("Rent")).toBeInTheDocument();
  });

  it("does not read storage during render", () => {
    // The real check for the hydration rule. render() flushes effects before it
    // returns, so a client-side assertion cannot tell a render-time read from an
    // effect. Server rendering runs no effects, so the saved 50,000 can only
    // reach this string if the component read storage while rendering — which
    // is the markup mismatch React would report on hydration.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
    expect(renderToString(<MoneyPlannerPage />)).not.toContain("50000");
  });

  it("answers as the fields are filled in, with no submit button", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Balance today"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Monthly salary"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Pay day"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("What are you buying"), { target: { value: "Camera" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "90000" } });

    // Not /away|today/: "Balance today" is a label on this page and would match.
    await waitFor(() => expect(screen.getByText(/(months?|days?) away/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /calculate/i })).not.toBeInTheDocument();
  });

  it("says what is wrong instead of an answer when a field is cleared", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "90000" } });
    fireEvent.change(screen.getByLabelText("Pay day"), { target: { value: "" } });
    await waitFor(() =>
      expect(screen.getByText("Pay day must be a whole day between 1 and 31")).toBeInTheDocument(),
    );
  });

  it("saves what was typed", async () => {
    render(<MoneyPlannerPage />);
    fireEvent.change(screen.getByLabelText("Monthly salary"), { target: { value: "80000" } });
    await waitFor(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored as string).salary).toBe(80_000);
    });
  });

  it("hides the spare-a-month readout instead of showing ₹NaN while a field is cleared", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVED));
    render(<MoneyPlannerPage />);
    await waitFor(() =>
      expect(screen.getByText(/spare a month, on average\./)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Expense 1 repeats every"), { target: { value: "" } });

    await waitFor(() =>
      expect(screen.queryByText(/spare a month, on average\./)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/₹NaN/)).not.toBeInTheDocument();
  });

  it("keeps a way back to the public site", () => {
    render(<MoneyPlannerPage />);
    expect(screen.getByRole("link", { name: "Ashutosh Pandey" })).toHaveAttribute("href", "/");
  });

  it("rewrites the stored plan with rolled-forward due dates on load", async () => {
    // A plan left alone for months has a nextDue in the past. The design spec
    // requires the page to persist the rolled-forward result, not just hold
    // it in state, so a reopen next week doesn't show the same stale date.
    const stale: Plan = { ...SAVED, expenses: [{ ...SAVED.expenses[0], nextDue: "2020-01-15" }] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    render(<MoneyPlannerPage />);
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as Plan;
      expect(stored.expenses[0].nextDue).not.toBe("2020-01-15");
    });
  });
});
