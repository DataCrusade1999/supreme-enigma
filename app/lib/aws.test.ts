import { describe, expect, it } from "vitest";
import { keyForUpload, deriveOutputKey } from "./aws";

describe("keyForUpload", () => {
  it("prefixes with uploads/ and preserves the extension", () => {
    const key = keyForUpload("my song.mp3");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.mp3$/);
  });

  it("handles filenames with no extension", () => {
    const key = keyForUpload("noext");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}$/);
  });
});

describe("deriveOutputKey", () => {
  it("swaps the uploads/ prefix for outputs/", () => {
    expect(deriveOutputKey("uploads/abc-123.mp3")).toBe("outputs/abc-123.mp3");
  });
});
