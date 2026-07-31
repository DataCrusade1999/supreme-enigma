import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "./page";

function mockFetchSequence() {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
    })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ downloadUrl: "https://s3/download" }),
    });
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchSequence());
  });

  it("uploads, processes, and shows a preview + download link", async () => {
    render(<Home />);
    const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
        "href",
        "https://s3/download",
      );
    });
    expect(document.querySelector("audio")).toHaveAttribute("src", "https://s3/download");
  });

  it("shows an error message when processing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false }),
    );

    render(<Home />);
    const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
