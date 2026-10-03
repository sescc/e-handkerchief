// ============================================================
// e-Handkerchief — GeoService
// Wraps navigator.geolocation with a 10-second deadline.
// Optional Nominatim reverse geocoding.
// ============================================================

import type { KnotLocation } from './types.js';

export interface GeoServiceAPI {
  /**
   * Request the current GPS position.
   * Always resolves within 10 seconds — never throws.
   * Returns null on permission denial, timeout, or unavailability.
   */
  getCurrentPosition(): Promise<KnotLocation | null>;

  /**
   * Like getCurrentPosition(), but reports whether a failure was a permission
   * denial or anything else. Never rejects.
   */
  locate(): Promise<LocateResult>;

  /**
   * Reverse-geocode a coordinate to a human-readable address via Nominatim.
   * Returns the address (≤ 100 characters) or null on any failure.
   * Never throws.
   */
  reverseGeocode(lat: number, lng: number): Promise<string | null>;
}

/** Outcome of a location request, distinguishing a permission block from other failures. */
export type LocateResult =
  | { ok: true; coords: KnotLocation }
  | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * Request the current GPS position, reporting why it failed.
 * Always resolves within 10 seconds — never rejects.
 * PERMISSION_DENIED (code 1) -> 'denied'; POSITION_UNAVAILABLE, TIMEOUT, the
 * guard timeout, or no geolocation support -> 'unavailable'.
 */
export function locate(): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ok: false, reason: 'unavailable' });
      return;
    }

    // Belt-and-suspenders: our own timeout in case the API doesn't respect its timeout option
    const guard = setTimeout(() => resolve({ ok: false, reason: 'unavailable' }), 10000);

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(guard);
          resolve({
            ok: true,
            coords: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyMeters: pos.coords.accuracy ?? null,
            },
          });
        },
        (err) => {
          clearTimeout(guard);
          // PERMISSION_DENIED = 1; POSITION_UNAVAILABLE = 2; TIMEOUT = 3
          resolve({ ok: false, reason: err && err.code === 1 ? 'denied' : 'unavailable' });
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
    } catch {
      clearTimeout(guard);
      resolve({ ok: false, reason: 'unavailable' });
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
