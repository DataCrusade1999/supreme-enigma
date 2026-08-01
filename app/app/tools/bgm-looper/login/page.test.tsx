import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "./page";

const pushMock = vi.fn();
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    mockSearch = "";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  async function submit() {
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "test123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  }

  it("redirects to the next param on success when it's a relative path", async () => {
    mockSearch = "next=%2Fkeystatic";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/keystatic"));
  });

  it("falls back to /tools/bgm-looper when next is missing", async () => {
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });

  it("falls back to /tools/bgm-looper when next is not a relative path (open-redirect guard)", async () => {
    mockSearch = "next=https%3A%2F%2Fevil.example";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });
});
