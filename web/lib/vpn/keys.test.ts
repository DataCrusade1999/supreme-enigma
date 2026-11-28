import { describe, expect, it } from "vitest";
import { generateKeypair, publicKeyFor } from "./keys";
import { isPublicKey } from "./model";

const b64 = (hex: string) => btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))));

describe("keys", () => {
  it("derives the RFC 7748 §6.1 public key", () => {
    const priv = b64("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    expect(publicKeyFor(priv)).toBe(b64("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"));
  });

  it("generateKeypair gives a 32-byte pair whose public half matches", () => {
    const { privateKey, publicKey } = generateKeypair();
    expect(atob(privateKey)).toHaveLength(32);
    expect(isPublicKey(publicKey)).toBe(true);
    expect(publicKeyFor(privateKey)).toBe(publicKey);
  });
});
