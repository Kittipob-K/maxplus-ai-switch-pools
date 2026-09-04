import { userInfo } from "node:os";
import { Entry } from "@napi-rs/keyring";

/** The subset of @napi-rs/keyring's Entry that we use — also the test seam. */
export interface Keychain {
  getPassword(): string | null;
  setPassword(secret: string): void;
  deletePassword(): boolean;
}

const SERVICE = "maxplus-ai";

/**
 * Open the OS-keychain entry holding the Primary API Key, or null when the
 * keychain is disabled (MAXPLUS_DISABLE_KEYCHAIN=1 — tests, or users who want
 * file-only mode) or cannot be reached on this machine.
 */
export function openKeychain(): Keychain | null {
  const off = process.env.MAXPLUS_DISABLE_KEYCHAIN;
  if (off && off !== "0") return null;
  try {
    return new Entry(SERVICE, userInfo().username);
  } catch {
    // No usable keychain backend (headless Linux without Secret Service,
    // odd containers, unsupported Windows state). The Settings File takes
    // over as the Credential Store.
    return null;
  }
}
