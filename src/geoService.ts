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
   * Reverse-geocode a coordinate to a human-readable address via Nominatim.
   * Returns the address (≤ 100 characters) or null on any failure.
   * Never throws.
   */
  reverseGeocode(lat: number, lng: number): Promise<string | null>;
}

export const geoService: GeoServiceAPI = {
  getCurrentPosition(): Promise<KnotLocation | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      // Belt-and-suspenders: our own timeout in case the API doesn't respect its timeout option
      const guard = setTimeout(() => resolve(null), 10000);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(guard);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy ?? null,
          });
        },
        () => {
          // PERMISSION_DENIED, POSITION_UNAVAILABLE, or TIMEOUT
          clearTimeout(guard);
          resolve(null);
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
    });
  },

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
