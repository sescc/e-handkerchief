// ============================================================
// e-Handkerchief — GeoService
// Wraps navigator.geolocation with a configurable deadline (default 10 s).
// Optional Nominatim reverse geocoding.
// ============================================================

import type { KnotLocation } from './types.js';
import { classifyLocateFailure } from './locateFailure.js';
import type { LocateFailureReason } from './locateFailure.js';

export type { LocateFailureReason };

export interface GeoServiceAPI {
  /**
   * Request the current GPS position.
   * Always resolves within 10 seconds (the default deadline) — never throws.
   * Returns null on permission denial, timeout, or unavailability.
   */
  getCurrentPosition(): Promise<KnotLocation | null>;

  /**
   * Like getCurrentPosition(), but reports why a failure happened:
   * 'off' (the site is still allowed, so the device's Location is off) or
   * 'unavailable' (anything else, including every ambiguous case).
   * Never rejects. `deadlineMs` (default 10 000) is how long to wait for a fix.
   */
  locate(deadlineMs?: number): Promise<LocateResult>;

  /**
   * Reverse-geocode a coordinate to a human-readable address via Nominatim.
   * Returns the address (≤ 100 characters) or null on any failure.
   * Never throws.
   */
  reverseGeocode(lat: number, lng: number): Promise<string | null>;
}

/**
 * Outcome of a location request. On failure, `reason` is one of:
 * - 'off':         the site is allowed, so the device's own Location is off.
 * - 'unavailable': any other failure, including every ambiguous one (no fix,
 *                  timeout, no geolocation support, or permission denied —
 *                  Android reports a blocked site, device Location off and
 *                  missing Chrome-app permission alike as 'denied').
 */
export type LocateResult =
  | { ok: true; coords: KnotLocation }
  | { ok: false; reason: LocateFailureReason };

/** Max time to wait for the Permissions API before treating its state as unknown. */
const PERMISSION_QUERY_TIMEOUT_MS = 1000;

/**
 * Read the geolocation permission state, or null if the Permissions API is
 * missing, throws, rejects, or doesn't answer within PERMISSION_QUERY_TIMEOUT_MS.
 * Never rejects.
 */
async function queryGeolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!navigator.permissions) return null;
    const query = navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => s.state as 'granted' | 'denied' | 'prompt')
      .catch(() => null);
    const timeout = new Promise<null>((res) => {
      timer = setTimeout(() => res(null), PERMISSION_QUERY_TIMEOUT_MS);
    });
    return await Promise.race([query, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request the current GPS position, reporting why it failed.
 * Always resolves within `deadlineMs` (default 10 s) plus, after a
 * permission-denied error, up to 1 s for the permission lookup — never
 * rejects, and resolves exactly once. A longer deadline suits offline use,
 * where a cold GPS fix without assisted GPS can take minutes.
 *
 * Failure reasons: PERMISSION_DENIED (code 1) is refined with the Permissions
 * API, queried after the error fires so the state is fresh. Only 'granted' is
 * conclusive: the site is allowed, so the device's Location must be off
 * ('off'; Android Chrome reports that as code 1). A 'denied' state is not
 * trusted, because Android also uses it when the device Location is off or
 * Chrome lacks Android's location permission, so it gives 'unavailable', as do
 * a 'prompt' or unknown state, POSITION_UNAVAILABLE, TIMEOUT, the guard
 * timeout, and no geolocation support.
 */
export function locate(deadlineMs = 10000): Promise<LocateResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LocateResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(result);
    };
    const fail = (code: number | null, perm: 'granted' | 'denied' | 'prompt' | null): void =>
      finish({ ok: false, reason: classifyLocateFailure(code, perm) });

    // Belt-and-suspenders: our own timeout in case the API doesn't respect its timeout option
    const guard = setTimeout(() => fail(null, null), deadlineMs);

    if (!navigator.geolocation) {
      fail(null, null);
      return;
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          finish({
            ok: true,
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyMeters: pos.coords.accuracy ?? null,
            },
          });
        },
        (err) => {
          // The error has arrived: stop the guard so it can't fire while the
          // permission lookup is pending (finish() also ignores late callers).
          clearTimeout(guard);
          // PERMISSION_DENIED = 1; POSITION_UNAVAILABLE = 2; TIMEOUT = 3
          const code = err && typeof err.code === 'number' ? err.code : null;
          if (code === 1) {
            void queryGeolocationPermission().then((state) => fail(code, state));
          } else {
            fail(code, null);
          }
        },
        { timeout: deadlineMs, maximumAge: 0, enableHighAccuracy: true }
      );
    } catch {
      fail(null, null);
    }
  });
}

export const geoService: GeoServiceAPI = {
  async getCurrentPosition(): Promise<KnotLocation | null> {
    const r = await locate();
    return r.ok ? r.coords : null;
  },

  locate,

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse` +
        `?format=jsonv2&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en',
          // Nominatim policy requires a meaningful User-Agent
          'User-Agent': 'e-Handkerchief/1.0',
        },
      });
      if (!res.ok) return null;
      const data = await res.json() as { display_name?: string };
      if (!data.display_name) return null;
      return data.display_name.slice(0, 100);
    } catch {
      return null;
    }
  },
};
