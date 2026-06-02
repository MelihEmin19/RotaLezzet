import { useMemo, useState } from "react";

import type { City } from "../types/city";

const popularCityIds = ["istanbul", "ankara", "izmir", "antalya", "bursa", "gaziantep"] as const;

export function useCitySelection(cities: City[]) {
  const [selectedCity, setSelectedCity] = useState<City | null>(null);
  const [isPickerOpen, setPickerOpen] = useState(false);

  const popularCities = useMemo(() => {
    const set = new Set<string>(popularCityIds);
    return cities.filter((c) => set.has(c.id));
  }, [cities]);

  return {
    selectedCity,
    setSelectedCity,
    isPickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    popularCities,
  };
}

