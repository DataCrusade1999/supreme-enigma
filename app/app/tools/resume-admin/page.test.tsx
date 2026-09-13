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

    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByRole("button", { name: /^publish$/i })).toBeDisabled();
    // Only the five calls above — no draft PUT slipped through.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
