import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ResumeAdminPage from "./page";

// CommandBar (rendered here because the tool sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const VALID = {
  headline: { name: "A", title: "B", summary: "C" },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["did a thing"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

function choosePdf(name: string) {
  const file = new File(["%PDF"], name, { type: "application/pdf" });
  const input = screen.getByLabelText(/resume pdf/i, { selector: "input" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("Resume admin page", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps both actions off while a second upload is in flight", async () => {
    // draftId flips to the new draft as soon as the presign returns, but the
    // editor still holds the previous draft's JSON until extraction comes back.
    // Saving in that window would PUT draft A's content under draft B's id;
    // publishing would promote it alongside B's freshly uploaded PDF.
    const fetchMock = vi
      .fn()
      // Draft A: presign, upload, extract.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: "A", uploadUrl: "https://s3/A" }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ draftId: "A", resume: VALID }) })
      // Draft B: presign returns, then the upload never settles.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: "B", uploadUrl: "https://s3/B" }),
      })
      .mockReturnValueOnce(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(<ResumeAdminPage />);

    choosePdf("a.pdf");
    const save = await screen.findByRole("button", { name: /save draft/i });
    await waitFor(() => expect(save).toBeEnabled());

    choosePdf("b.pdf");

    // Re-queried each time: clearing draftId unmounts the panel, so it is gone
    // for part of this window and the handle above detaches. Either way there
    // is nothing actionable until B's extraction returns.
    await waitFor(() => {
      const button = screen.queryByRole("button", { name: /save draft/i });
      expect(button === null || (button as HTMLButtonElement).disabled).toBe(true);
    });
    const publish = screen.queryByRole("button", { name: /^publish$/i });
    expect(publish === null || (publish as HTMLButtonElement).disabled).toBe(true);
    // Only the five calls above — no draft PUT slipped through.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not leave the previous draft's JSON actionable after a failed upload", async () => {
    // `error` is a settled state, so `busy` is false again — but draftId has
    // already advanced. Saving here would write draft A's content under B's id;
    // publishing would promote it beside B's PDF. handleFile clears the editor
    // at the source so there is nothing to act on.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: "A", uploadUrl: "https://s3/A" }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ draftId: "A", resume: VALID }) })
      // Draft B: presign and upload land, extraction fails with a non-422.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: "B", uploadUrl: "https://s3/B" }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: "the model was unreachable" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResumeAdminPage />);

    choosePdf("a.pdf");
    const save = await screen.findByRole("button", { name: /save draft/i });
    await waitFor(() => expect(save).toBeEnabled());

    choosePdf("b.pdf");

    await waitFor(() => expect(screen.getByText(/model was unreachable/i)).toBeInTheDocument());
    // Re-queried, not reused: clearing draftId unmounts the panel, so the
    // handle above is detached by now.
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("surfaces a network failure during publish instead of wedging the page", async () => {
    // Both buttons are disabled while status is "publishing", so a throw
    // escaping publish() would leave them disabled under a permanent
    // "Publishing…" with no way back but a page reload.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ draftId: "A", uploadUrl: "https://s3/A" }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ draftId: "A", resume: VALID }) })
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    render(<ResumeAdminPage />);

    choosePdf("a.pdf");
    const publish = await screen.findByRole("button", { name: /^publish$/i });
    await waitFor(() => expect(publish).toBeEnabled());

    fireEvent.click(publish);

    await waitFor(() => expect(screen.getByText(/fetch failed/i)).toBeInTheDocument());
    expect(screen.queryByText(/publishing…/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeEnabled();
  });
});
