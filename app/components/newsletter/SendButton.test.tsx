import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendButton } from "./SendButton";

describe("SendButton", () => {
  beforeEach(() => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  it("shows Sent after a successful send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
  });

  it("shows the error message when the send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "This issue has already been sent" }),
      }),
    );
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This issue has already been sent"),
    );
  });

  it("surfaces a rejected fetch instead of stranding the button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to fetch"),
    );
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("does not call fetch when the confirm dialog is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SendButton slug="hello-newsletter" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
