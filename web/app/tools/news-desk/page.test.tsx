import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/news-desk/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news-desk/store")>("@/lib/news-desk/store");
  return { ...actual, readSnapshot: vi.fn() };
});

import { readSnapshot, SnapshotCorruptError } from "@/lib/news-desk/store";
import NewsDeskPage from "./page";

describe("News Desk page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("renders the heading and the empty state before the first refresh", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    render(await NewsDeskPage());
    expect(screen.getByRole("heading", { level: 1, name: "News Desk" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
  });

  it("says storage is not configured instead of reading S3", async () => {
    delete process.env.S3_BUCKET_NAME;
    render(await NewsDeskPage());
    expect(screen.getByText(/Storage is not configured here/)).toBeInTheDocument();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("reports a read failure without crashing", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    render(await NewsDeskPage());
    expect(screen.getByText(/Could not read the saved headlines/)).toBeInTheDocument();
  });
});
