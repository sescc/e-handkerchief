// ============================================================
// e-Handkerchief — locateFailure
// Pure classification of a failed location request. No DOM and no
// navigator access, so it runs under plain node in its chartest.
// ============================================================

/**
 * Why a location request failed.
 * - 'denied':      the site is blocked in the browser settings.
 * - 'off':         the site is allowed, so the device's own Location is off.
 * - 'unknown':     permission was denied but we can't tell whether the site or
 *                  the device is the cause (browsers report both as code 1).
 * - 'unavailable': any other failure (no fix, timeout, no geolocation support).
 */
export type LocateFailureReason = 'denied' | 'off' | 'unknown' | 'unavailable';

/**
 * Classify a location failure.
 *
 * Android Chrome reports PERMISSION_DENIED (code 1) both when the site is
 * blocked and when the phone's own Location toggle is off. The Permissions API
 * state tells them apart: a site that is still 'granted' must be failing
 * because the device's Location is off.
 *
 * @param code GeolocationPositionError.code, or null for no geolocation
 *   support, our own guard timeout, or a thrown call.
 * @param permState Result of navigator.permissions.query({name:'geolocation'}).state,
 *   or null if the query was unavailable or threw.
 */
export function classifyLocateFailure(
  code: number | null,
  permState: 'granted' | 'denied' | 'prompt' | null
): LocateFailureReason {
  if (code !== 1) return 'unavailable';
  if (permState === 'denied') return 'denied';
  if (permState === 'granted') return 'off';
  return 'unknown';
}
