// Client-side passphrase encryption for saved configs (WebCrypto: PBKDF2-SHA-256 -> AES-256-GCM).
// The server only ever sees the envelope below; the passphrase never leaves the browser.

export const ENCRYPTED_IDENTITY = "🔒 Encrypted";
export const MIN_PASSPHRASE = 8;

const ITERATIONS = 600_000;
const MAX_ITERATIONS = 2_000_000;
const MAX_FIELD = 4_000_000;

export interface EncryptedEnvelope {
  encrypted: true;
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  /** base64 */
  salt: string;
  iv: string;
  ct: string;
}

export function isEncryptedEnvelope(x: unknown): x is EncryptedEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  const b64 = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD && /^[A-Za-z0-9+/]*={0,2}$/.test(v);
  return (
    e.encrypted === true &&
    e.v === 1 &&
    e.kdf === "PBKDF2-SHA256" &&
    typeof e.iter === "number" &&
    Number.isInteger(e.iter) &&
    e.iter >= 100_000 &&
    e.iter <= MAX_ITERATIONS &&
    b64(e.salt) &&
    b64(e.iv) &&
    b64(e.ct)
  );
}

const toB64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number, usage: KeyUsage) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}

export async function encryptJson(value: unknown, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS, "encrypt");
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value))));
  return { encrypted: true, v: 1, kdf: "PBKDF2-SHA256", iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Throws "Wrong passphrase, or the saved data is damaged." when decryption fails. */
export async function decryptJson<T>(env: EncryptedEnvelope, passphrase: string): Promise<T> {
  try {
    const key = await deriveKey(passphrase, fromB64(env.salt), env.iter, "decrypt");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) as BufferSource }, key, fromB64(env.ct) as BufferSource);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    throw new Error("Wrong passphrase, or the saved data is damaged.");
  }
}
