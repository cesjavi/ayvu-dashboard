// ---------------------------------------------------------------------------
// AES-256-GCM encryption / decryption helpers
// ---------------------------------------------------------------------------

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM

function getEncryptionKeyHex(): string {
  const key = Deno.env.get("ENCRYPTION_KEY");
  if (!key) throw new Error("ENCRYPTION_KEY not configured in Secret Manager");
  return key;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(rawHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(rawHex);
  return await crypto.subtle.importKey("raw", raw, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a plaintext string. Returns base64( iv || ciphertext ). */
export async function encryptKey(plaintext: string): Promise<string> {
  const keyHex = getEncryptionKeyHex();
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return bytesToBase64(combined);
}

/** Decrypt a base64( iv || ciphertext ) string. Returns plaintext. */
export async function decryptKey(encoded: string): Promise<string> {
  const keyHex = getEncryptionKeyHex();
  const key = await importKey(keyHex);
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}