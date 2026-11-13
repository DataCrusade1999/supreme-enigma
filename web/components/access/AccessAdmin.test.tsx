import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessAdmin } from "./AccessAdmin";

const directory = {
  users: [
    { sub: "o", username: "o", email: "owner@example.com", createdAt: "2026-09-28T00:00:00Z", groups: ["owner"], status: "owner", grants: [] },
    {
      sub: "f", username: "Google_f", email: "friend@example.com", createdAt: "2026-10-01T00:00:00Z", groups: ["friends"], status: "member",
      grants: [{ sub: "f", action: "newsdesk:ask", email: "friend@example.com", limit: 20, used: 13, expiresAt: 1_791_504_000, grantedAt: 0 }],
    },
    {
      sub: "g", username: "Google_g", email: "other@example.com", createdAt: "2026-10-01T00:00:00Z", groups: ["friends"], status: "member", grants: [],
    },
    { sub: "p", username: "Google_p", email: "pending@example.com", createdAt: "2026-10-02T00:00:00Z", groups: [], status: "pending", grants: [] },
  ],
};

const fetchMock = vi.fn();
const NOW = 1_790_000_000;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => (url === "/api/access/users" && !init?.method ? directory : { ok: true }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("AccessAdmin", () => {
  it("splits users into Pending, Members and You", async () => {
    render(<AccessAdmin />);
    const pending = await screen.findByRole("region", { name: "Pending" });
    expect(within(pending).getByText("pending@example.com")).toBeInTheDocument();
    const members = screen.getByRole("region", { name: "Members" });
    expect(within(members).getByText("friend@example.com")).toBeInTheDocument();
    expect(within(members).getByText(/News Desk ask: 7 of 20 uses left, until 9 Oct 2026, 5:30 am IST/)).toBeInTheDocument();
    const you = screen.getByRole("region", { name: "You" });
    expect(within(you).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(you).queryByRole("button")).not.toBeInTheDocument();
  });

  it("approves a pending user and reloads", async () => {
    render(<AccessAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve pending@example.com" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/access/members", expect.objectContaining({ method: "POST", body: JSON.stringify({ sub: "p" }) }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === "/api/access/users")).toHaveLength(2));
  });

  it("grants a metered action with the form's values", async () => {
    render(<AccessAdmin />);
    const form = await screen.findByRole("form", { name: "Grant to friend@example.com" });
    await userEvent.selectOptions(within(form).getByLabelText("Action"), "looper:process");
    await userEvent.clear(within(form).getByLabelText("Uses"));
    await userEvent.type(within(form).getByLabelText("Uses"), "5");
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(call[0]).toBe("/api/access/grants");
    expect(JSON.parse(call[1].body)).toEqual({ sub: "f", action: "looper:process", limit: 5, expiresInDays: 7, note: "" });
  });

  function withGrants(grants: object[]) {
    const f = directory.users[1];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (url === "/api/access/users" && !init?.method ? { users: [directory.users[0], { ...f, grants }, ...directory.users.slice(2)] } : { ok: true }),
    }));
  }
  const g = (o: object) => ({ sub: "f", email: "friend@example.com", grantedAt: 0, expiresAt: 1_791_504_000, ...o });

  it("shows a live time-only grant, a used-up grant and an expired grant", async () => {
    withGrants([
      g({ action: "moneyplanner:use" }),
      g({ action: "newsdesk:ask", limit: 20, used: 20 }),
      g({ action: "looper:process", limit: 5, used: 1, expiresAt: NOW - 86_400 }),
    ]);
    render(<AccessAdmin />);
    const live = await screen.findByText("Money Planner: until 9 Oct 2026, 5:30 am IST");
    expect(live).not.toHaveClass("text-muted");
    const used = screen.getByText("News Desk ask: used up, until 9 Oct 2026, 5:30 am IST");
    expect(used).toHaveClass("text-muted");
    const expired = screen.getByText(/: expired \d{1,2} \w+$/);
    expect(expired).toHaveTextContent(/expired 20 Sep/);
    expect(expired).toHaveClass("text-muted");
    expect(screen.getByRole("button", { name: "Revoke News Desk ask for friend@example.com" })).toBeInTheDocument();
  });

  it("drops the Uses field for a time-only action and omits limit from the request", async () => {
    render(<AccessAdmin />);
    const form = await screen.findByRole("form", { name: "Grant to friend@example.com" });
    await userEvent.selectOptions(within(form).getByLabelText("Action"), "moneyplanner:use");
    expect(within(form).queryByLabelText("Uses")).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(call[1].body)).toEqual({ sub: "f", action: "moneyplanner:use", expiresInDays: 7, note: "" });
  });

  it("resets the form after a successful grant and keeps it after a failed one", async () => {
    render(<AccessAdmin />);
    const form = await screen.findByRole("form", { name: "Grant to friend@example.com" });
    const fill = async () => {
      await userEvent.selectOptions(within(form).getByLabelText("Action"), "looper:process");
      await userEvent.clear(within(form).getByLabelText("Uses"));
      await userEvent.type(within(form).getByLabelText("Uses"), "5");
      await userEvent.clear(within(form).getByLabelText("Days"));
      await userEvent.type(within(form).getByLabelText("Days"), "3");
      await userEvent.type(within(form).getByLabelText("Note"), "hello");
    };
    await fill();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "nope" }) });
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    await screen.findByRole("alert");
    expect(within(form).getByLabelText("Uses")).toHaveValue(5);
    expect(within(form).getByLabelText("Days")).toHaveValue(3);
    expect(within(form).getByLabelText("Note")).toHaveValue("hello");
    await userEvent.click(within(form).getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(within(form).getByLabelText("Uses")).toHaveValue(20));
    expect(within(form).getByLabelText("Action")).toHaveValue("newsdesk:ask");
    expect(within(form).getByLabelText("Days")).toHaveValue(7);
    expect(within(form).getByLabelText("Note")).toHaveValue("");
  });

  it("keeps one member's typed values out of another member's form", async () => {
    render(<AccessAdmin />);
    const a = await screen.findByRole("form", { name: "Grant to friend@example.com" });
    const b = screen.getByRole("form", { name: "Grant to other@example.com" });
    await userEvent.type(within(a).getByLabelText("Note"), "only for friend");
    expect(within(b).getByLabelText("Note")).toHaveValue("");
  });

  it("revokes a grant with the action encoded in the URL", async () => {
    render(<AccessAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke News Desk ask for friend@example.com" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/access/grants/f/newsdesk%3Aask", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows the API's error message", async () => {
    render(<AccessAdmin />);
    await screen.findByText("pending@example.com");
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "expected a pending user, found a member one" }) });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss pending@example.com" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expected a pending user, found a member one");
  });

  it("says so when the directory can't be loaded", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "the change failed; nothing was changed" }) });
    render(<AccessAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load users");
  });
});
