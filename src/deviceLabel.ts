// ============================================================
// e-Handkerchief — deviceLabel
// Pure: turns a user-agent string into a short, human label such as
// "Android" or "Windows". Stored as `appProperties.editedOn` on every Drive
// content write so the conflict review can say where an edit came from.
// No DOM access — the caller passes navigator.userAgent.
// ============================================================

/** Fallback used when the user agent is unrecognised (or when an old file has no label). */
export const UNKNOWN_DEVICE_LABEL = 'another device';

/**
 * Short device label from a user-agent string: "Android", "iPhone", "iPad",
 * "Windows", "Mac", "Linux", else "another device".
 *
 * Android is tested before Linux (Android UAs contain "Linux"), and iOS
 * before Mac (iOS UAs contain "like Mac OS X"). iPadOS 13+ reports a Mac UA
 * and so is labelled "Mac" — it can't be told apart from the UA alone.
 */
export function deviceLabelFromUserAgent(userAgent: string): string {
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPod/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Linux|X11/i.test(userAgent)) return 'Linux';
  return UNKNOWN_DEVICE_LABEL;
}
