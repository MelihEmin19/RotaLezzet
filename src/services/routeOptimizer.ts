import type { Place } from "../types/place";

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

// Basit nearest-neighbor: tek gün demo için yeterli.
export function optimizePlacesOrder(places: Place[]): Place[] {
  if (places.length <= 2) return places;

  const remaining = [...places];
  const route: Place[] = [];

  route.push(remaining.shift()!);

  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const d = haversineKm(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    route.push(remaining.splice(bestIdx, 1)[0]);
  }

  return route;
}

// Jenerik NN: lat/lng olan herhangi bir koleksiyonu en kisa yolda sirala.
export function optimizeByNearestNeighbor<T extends { lat: number; lng: number }>(
  items: T[],
  startFrom?: { lat: number; lng: number },
): T[] {
  if (items.length <= 2) return [...items];

  const remaining = [...items];
  const route: T[] = [];

  if (startFrom) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = haversineKm(startFrom, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    route.push(remaining.splice(bestIdx, 1)[0]);
  } else {
    route.push(remaining.shift()!);
  }

  while (remaining.length) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = haversineKm(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    route.push(remaining.splice(bestIdx, 1)[0]);
  }

  return route;
}

