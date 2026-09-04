import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("redirects an unauthenticated request for a gated path to login with ?next set", () => {
    const request = new NextRequest(new URL("http://localhost:3000/keystatic"));
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/tools/bgm-looper/login");
    expect(location).toMatch(/\?next=%2Fkeystatic$/);
  });
});
