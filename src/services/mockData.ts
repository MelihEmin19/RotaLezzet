import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";

type Candidate = Omit<ItineraryItem, "id">;

const allCandidates: Candidate[] = [
  {
    placeId: "mock-1",
    startTime: "09:00",
    endTime: "11:00",
    title: "Şehir Müzesi",
    category: "place",
    lat: 36.2023,
    lng: 36.1602,
  },
  {
    placeId: "mock-2",
    startTime: "11:30",
    endTime: "12:15",
    title: "Tarihi Çarşı",
    category: "place",
    lat: 36.2008,
    lng: 36.1617,
  },
  {
    placeId: "mock-3",
    startTime: "12:30",
    endTime: "13:45",
    title: "Yerel Esnaf Lokantası",
    category: "food",
    lat: 36.1994,
    lng: 36.165,
    nlpHighlight: { dishName: "Tepsi Kebabı", positivePercent: 92 },
  },
  {
    placeId: "mock-4",
    startTime: "14:15",
    endTime: "15:30",
    title: "Sokaklar & Fotoğraf Rotası",
    category: "place",
    lat: 36.1987,
    lng: 36.1672,
  },
  {
    placeId: "mock-5",
    startTime: "16:00",
    endTime: "16:30",
    title: "Künefe Molası",
    category: "food",
    lat: 36.1972,
    lng: 36.1704,
    nlpHighlight: { dishName: "Künefe", positivePercent: 95 },
  },
  {
    placeId: "mock-6",
    startTime: "17:00",
    endTime: "18:15",
    title: "Manzara Noktası",
    category: "place",
    lat: 36.206,
    lng: 36.1755,
  },
  {
    placeId: "mock-7",
    startTime: "19:00",
    endTime: "20:15",
    title: "Akşam Yemeği",
    category: "food",
    lat: 36.209,
    lng: 36.172,
    nlpHighlight: { dishName: "Kağıt Kebabı", positivePercent: 88 },
  },
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return result;
}

export function getMockItinerary(request: ItineraryRequest): ItineraryItem[] {
  const baseCount = request.tempo === "Yoğun" ? 6 : request.tempo === "Dengeli" ? 5 : 4;
  const selected = pickRandom(allCandidates, baseCount).sort((a, b) => a.startTime.localeCompare(b.startTime));

  const withIds: ItineraryItem[] = selected.map((item, idx) => ({
    ...item,
    id: `${request.cityId}-${idx}-${item.startTime.replace(":", "")}`,
  }));

  if (request.interests.includes("Gastronomi")) return withIds;

  // Gastronomi seçilmediyse NLP rozetlerini sadeleştir.
  return withIds.map((x) => ({ ...x, nlpHighlight: undefined }));
}

