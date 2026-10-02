import { describe, expect, it } from "vitest";
import { ACCESS_EMAIL, requestAccessHref } from "./access-request";

describe("requestAccessHref", () => {
  it("percent-encodes the subject and body, with %20 for spaces", () => {
    const href = requestAccessHref("Access request: News Desk newsdesk:ask");
    expect(href.startsWith(`mailto:${ACCESS_EMAIL}?subject=`)).toBe(true);
    expect(href).toContain("subject=Access%20request%3A%20News%20Desk%20newsdesk%3Aask");
    expect(href).not.toContain("+");
    expect(decodeURIComponent(href.split("&body=")[1])).toContain("Roughly how many times:");
  });
});
