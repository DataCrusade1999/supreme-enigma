import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExpenseTable } from "./ExpenseTable";
import type { Expense } from "../../lib/money-planner";

const TODAY = "2026-09-19";

const RENT: Expense = {
  id: "e1",
  name: "Rent",
  amount: 20_000,
  everyMonths: 1,
  nextDue: "2026-10-01",
};

describe("ExpenseTable", () => {
  it("renders a row per expense", () => {
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("Rent")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20000")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-10-01")).toBeInTheDocument();
  });

  it("says so when there are no expenses yet", () => {
    render(<ExpenseTable expenses={[]} today={TODAY} onChange={vi.fn()} />);
    expect(screen.getByText("No expenses yet.")).toBeInTheDocument();
  });

  it("reports a renamed expense", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 name"), { target: { value: "Wifi" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, name: "Wifi" }]);
  });

  it("reports an edited amount as a number", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 amount"), { target: { value: "21000" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, amount: 21_000 }]);
  });

  it("takes any whole number of months, not just the common ones", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 repeats every"), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, everyMonths: 2 }]);
  });

  it("reports a cleared number field as NaN rather than zero", () => {
    // Zero would be a valid-looking plan and would silently change the answer
    // while the field is mid-edit. NaN fails validation, which is what an empty
    // box means.
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 repeats every"), { target: { value: "" } });
    expect(onChange.mock.calls[0][0][0].everyMonths).toBeNaN();
  });

  it("adds a row that is due today, with a blank amount", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[]} today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0];
    expect(added.amount).toBeNaN();
    expect(added).toMatchObject({
      name: "",
      everyMonths: 1,
      nextDue: TODAY,
      anchorDay: 19,
    });
    expect(added.id).not.toBe("");
  });

  it("still adds a row when crypto.randomUUID is unavailable", () => {
    // Unguarded, this throws on plain http:// off localhost — not a secure
    // context, so crypto.randomUUID is undefined there.
    const original = crypto.randomUUID;
    // @ts-expect-error -- simulating an insecure context, where the method is absent
    delete crypto.randomUUID;
    try {
      const onChange = vi.fn();
      render(<ExpenseTable expenses={[]} today={TODAY} onChange={onChange} />);
      fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
      const added = onChange.mock.calls[0][0][0];
      expect(typeof added.id).toBe("string");
      expect(added.id.length).toBeGreaterThan(0);
    } finally {
      crypto.randomUUID = original;
    }
  });

  it("moves the anchor day with a directly edited next due", () => {
    const onChange = vi.fn();
    render(<ExpenseTable expenses={[RENT]} today={TODAY} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Expense 1 next due"), {
      target: { value: "2026-11-30" },
    });
    expect(onChange).toHaveBeenCalledWith([{ ...RENT, nextDue: "2026-11-30", anchorDay: 30 }]);
  });

  it("removes the row it was asked to remove", () => {
    const onChange = vi.fn();
    const second = { ...RENT, id: "e2", name: "Wifi" };
    render(<ExpenseTable expenses={[RENT, second]} today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Wifi" }));
    expect(onChange).toHaveBeenCalledWith([RENT]);
  });
});
