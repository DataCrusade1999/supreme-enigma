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
    { sub: "p", username: "Google_p", email: "pending@example.com", createdAt: "2026-10-02T00:00:00Z", groups: [], status: "pending", grants: [] },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
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
    expect(within(members).getByText(/News Desk ask: 7 of 20 left/)).toBeInTheDocument();
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
