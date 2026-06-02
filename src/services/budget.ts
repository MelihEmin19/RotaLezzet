import type { ItineraryItem } from "../types/itinerary";

// Tahmini bütçe (USD baz). Google priceLevel ile yorel para birimi arasinda
// kesin esleme yok; bu yuzden kullaniciya "tahmini" oldugunu net soyluyoruz.

type Range = { min: number; max: number };

const FOOD_BY_PRICE_LEVEL: Record<number, Range> = {
  0: { min: 0, max: 0 },
  1: { min: 8, max: 15 },
  2: { min: 20, max: 40 },
  3: { min: 50, max: 80 },
  4: { min: 100, max: 180 },
};

const FOOD_FALLBACK: Range = { min: 18, max: 35 };

const PLACE_FALLBACK_BY_SUBTYPE: Record<string, Range> = {
  history: { min: 8, max: 20 },
  nature: { min: 0, max: 8 },
  shopping: { min: 0, max: 0 },
};

export type ItemBudget = {
  min: number;
  max: number;
};

export function estimateItemBudget(item: ItineraryItem): ItemBudget {
  if (item.category === "food") {
    if (typeof item.priceLevel === "number" && FOOD_BY_PRICE_LEVEL[item.priceLevel]) {
      return FOOD_BY_PRICE_LEVEL[item.priceLevel];
    }
    return FOOD_FALLBACK;
  }
  // place
  const subtype = item.subtype ?? "history";
  return PLACE_FALLBACK_BY_SUBTYPE[subtype] ?? { min: 0, max: 0 };
}

export type ItineraryBudget = {
  totalMin: number;
  totalMax: number;
  perDay: Record<number, ItemBudget>;
  currency: "USD";
};

export function estimateItineraryBudget(items: ItineraryItem[]): ItineraryBudget {
  const perDay: Record<number, ItemBudget> = {};
  let totalMin = 0;
  let totalMax = 0;

  for (const it of items) {
    const dayKey = typeof it.day === "number" && it.day > 0 ? it.day : 1;
    const b = estimateItemBudget(it);
    totalMin += b.min;
    totalMax += b.max;
    const existing = perDay[dayKey] ?? { min: 0, max: 0 };
    perDay[dayKey] = { min: existing.min + b.min, max: existing.max + b.max };
  }

  return { totalMin, totalMax, perDay, currency: "USD" };
}

export function formatBudgetRange(range: ItemBudget, currency: "USD" = "USD"): string {
  const symbol = currency === "USD" ? "$" : currency;
  if (range.min === range.max) return `${symbol}${range.min}`;
  return `${symbol}${range.min}-${symbol}${range.max}`;
}
