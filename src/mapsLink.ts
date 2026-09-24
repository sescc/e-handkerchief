// ============================================================
// e-Handkerchief — mapsLink
// Helper for building Google Maps URLs from knot coordinates.
// ============================================================

import type { KnotLocation } from './types.js';

/** Build a Google Maps URL that points at the given coordinates. */
export function googleMapsUrl(location: KnotLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}
