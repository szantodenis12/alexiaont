/**
 * PIN lock for gallery folders.
 *
 * The folder metadata carries `pinHash` (never the PIN itself), so the code
 * cannot simply be read out of the page. Public viewers do not fetch a locked
 * folder's photos until the right PIN is entered.
 *
 * Honest limit: gallery data is public by design (clients open galleries
 * without an account), so this is a privacy screen for ordinary visitors — it
 * keeps other wedding guests out of a private folder — not protection against
 * someone querying the database directly. A 4-digit PIN also has only 10,000
 * combinations, which is why wrong attempts are throttled in the UI.
 */

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);

/** SHA-256 of the PIN, salted with gallery + folder so equal PINs hash differently. */
export async function hashFolderPin(galleryId: string, subId: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`xia-folder-lock:${galleryId}:${subId}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function checkFolderPin(galleryId: string, subId: string, pin: string, pinHash: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  return (await hashFolderPin(galleryId, subId, pin)) === pinHash;
}
