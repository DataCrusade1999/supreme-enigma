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
    expect(new URL(location!).pathname).toBe("/login");
    expect(location).toMatch(/\?next=\/keystatic$/);
  });

  it("keeps / legible in ?next but still escapes query and hash characters", () => {
    const request = new NextRequest(new URL("http://localhost:3000/tools/news-desk"));
    expect(proxy(request).headers.get("location")).toMatch(/\?next=\/tools\/news-desk$/);

    const odd = new NextRequest(new URL("http://localhost:3000/tools/a%3Fb%23c%26d"));
    const location = new URL(proxy(odd).headers.get("location")!);
    expect(location.search).toBe("?next=/tools/a%253Fb%2523c%2526d");
    expect(location.searchParams.get("next")).toBe("/tools/a%3Fb%23c%26d");
  });
});
