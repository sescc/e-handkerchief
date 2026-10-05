// ============================================================
// e-Handkerchief — locateFailure
// Pure classification of a failed location request. No DOM and no
// navigator access, so it runs under plain node in its chartest.
// ============================================================

/**
 * Why a location request failed.
 * - 'off':         the site is still allowed, so the device's own Location is off.
 * - 'unavailable': anything else, including every case where we can't be sure
 *                  what is wrong (see classifyLocateFailure).
 */
export type LocateFailureReason = 'off' | 'unavailable';

/**
 * Classify a location failure.
 *
 * Android Chrome reports PERMISSION_DENIED (code 1) both when the site is
 * blocked and when the phone's own Location toggle is off. The Permissions API
 * state is no better for 'denied': Android folds a site that is blocked, the
 * device's Location being off and Chrome itself lacking Android's location
 * permission into the same 'denied'. So 'denied' is NOT trusted to mean "this
 * site is blocked", and we show the generic message instead of a misleading one.
 * Only a site that is still 'granted' is reliable: it must be failing because
 * the device's Location is off.
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
  if (code === 1 && permState === 'granted') return 'off';
  return 'unavailable';
}
