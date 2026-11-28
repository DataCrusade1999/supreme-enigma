import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

import { VpnDashboard } from "./VpnDashboard";
import type { Desired, ServerReport } from "../../lib/vpn/model";

const now = () => Math.floor(Date.now() / 1000);
const KEY = btoa("a".repeat(32));

function desired(over: Partial<Desired> = {}): Desired {
  return {
    pk: "desired", version: 1, settingsVersion: 1,
    settings: { dns: ["1.1.1.1"], tunnel: "full", cidrs: [] },
    peers: [], ...over,
  };
}
function server(over: Partial<ServerReport> = {}): ServerReport {
  return {
    pk: "server", publicKey: KEY, endpoint: "1.2.3.4:51820", appliedVersion: 1,
    lastSeen: now(), certNotAfter: now() + 90 * 86400, error: null, peers: {}, ...over,
  };
}
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VpnDashboard", () => {
  it("disables Add peer until the server has reported", async () => {
    const peers = [{ id: "p1", name: "Pixel", publicKey: KEY, address: "10.66.66.2", createdAt: 1, settingsVersion: 1 }];
    fetchMock.mockImplementation(() => json({ desired: desired({ peers }), server: null }));
    render(<VpnDashboard />);
    expect(await screen.findByText(/The VPN server hasn't reported yet/)).toBeInTheDocument();
    // A name is typed so the empty-name rule can't be what disables the button.
    await userEvent.type(screen.getByLabelText("Name"), "Laptop");
    expect(screen.getByRole("button", { name: "Add peer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Re-issue Pixel" })).toBeDisabled();
  });

  it("after adding, shows the QR and .conf once and never posts the private key", async () => {
    const user = userEvent.setup();
    const peer = { id: "p1", name: "Pixel", publicKey: "", address: "10.66.66.2", createdAt: 1, settingsVersion: 1 };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const p = { ...peer, publicKey: body.publicKey };
        return json({ desired: desired({ peers: [p] }), peer: p }, 201);
      }
      return json({ desired: desired(), server: server() });
    });
    const { container } = render(<VpnDashboard />);
    await user.type(await screen.findByLabelText("Name"), "Pixel");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add peer" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add peer" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("canvas")).not.toBeNull();
    expect(within(dialog).getByRole("link", { name: "Download .conf" })).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    const sent = JSON.parse(String(post[1].body));
    expect(Object.keys(sent).sort()).toEqual(["name", "publicKey"]);
    expect(post[0]).toBe("/api/vpn/peers");

    // The config text carries the private key; read it from the blob, then check it is gone after close.
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const text = await blob.text();
    const priv = /PrivateKey = (\S+)/.exec(text)![1];
    expect(container.textContent).not.toContain(priv);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download .conf" })).toBeNull();
    expect(document.body.innerHTML).not.toContain(priv);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("marks peers whose settingsVersion is older than the current one", async () => {
    const peers = [{ id: "p1", name: "Old", publicKey: KEY, address: "10.66.66.2", createdAt: 1, settingsVersion: 1 }];
    fetchMock.mockImplementation(() => json({ desired: desired({ settingsVersion: 2, peers }), server: server() }));
    render(<VpnDashboard />);
    expect(await screen.findByText("Out of date — re-issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-issue/ })).toBeEnabled();
  });

  it("shows handshake time and bytes from the server report", async () => {
    const peers = [{ id: "p1", name: "Pixel", publicKey: KEY, address: "10.66.66.2", createdAt: 1, settingsVersion: 1 }];
    const s = server({ peers: { [KEY]: { latestHandshake: now() - 120, rxBytes: 2048, txBytes: 5 * 1024 * 1024 } } });
    fetchMock.mockImplementation(() => json({ desired: desired({ peers }), server: s }));
    render(<VpnDashboard />);
    expect(await screen.findByText("2 min ago")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
  });
});
