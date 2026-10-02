import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AccessRequestedPage from "./page";
import { isGatedPath } from "../../lib/route-gate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("AccessRequestedPage", () => {
  it("says what to do and where to write", () => {
    render(<AccessRequestedPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Access requested" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /access@ashutosh-pandey\.com/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:access@ashutosh-pandey\.com\?subject=/),
    );
  });

  // Both pages have to be reachable by someone the gate just turned away.
  it.each(["/access-requested", "/access-denied"])("%s is not gated", (path) => {
    expect(isGatedPath(path)).toBe(false);
  });
});
