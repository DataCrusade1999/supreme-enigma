import { x25519 } from "@noble/curves/ed25519.js";

// Runs in the browser. Base64 goes through btoa/atob over byte strings, not Buffer.

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function publicKeyFor(privateKey: string): string {
  return toBase64(x25519.getPublicKey(fromBase64(privateKey)));
}

export function generateKeypair(): { privateKey: string; publicKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return { privateKey: toBase64(secret), publicKey: toBase64(x25519.getPublicKey(secret)) };
}
