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

  it("falls back to /tools/bgm-looper when next is a protocol-relative URL (open-redirect guard)", async () => {
    mockSearch = "next=%2F%2Fevil.example";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });

  it("falls back to /tools/bgm-looper when next hides a control character that would resolve off-origin (open-redirect guard)", async () => {
    mockSearch = "next=%2F%09%2Fevil.example";
    render(<LoginPage />);
    await submit();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tools/bgm-looper"));
  });

  it("names the tool the visitor was heading to", () => {
    mockSearch = "next=%2Ftools%2Fbgm-looper";
    render(<LoginPage />);
    expect(screen.getByText("Continuing to")).toBeInTheDocument();
    expect(screen.getByText("BGM Looper")).toBeInTheDocument();
  });

  it.each([
    ["next is missing", ""],
    ["next names no known tool", "next=%2Fsomewhere-else"],
    ["next is off-origin", "next=https%3A%2F%2Fevil.example"],
  ])("drops the destination strip when %s", (_label, search) => {
    mockSearch = search;
    render(<LoginPage />);
    expect(screen.queryByText("Continuing to")).not.toBeInTheDocument();
  });

  it("reports a rejected password on an alert and marks the field invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<LoginPage />);
    await submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid password"),
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
