import { Platform, Share } from "react-native";

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import type { ItineraryItem, ItineraryRequest } from "../types/itinerary";
import { estimateItemBudget, estimateItineraryBudget, formatBudgetRange } from "./budget";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildItineraryHtml(params: {
  cityName: string;
  items: ItineraryItem[];
  language: string;
  title: string;
  subtitleText: string;
  budgetTotalLabel: string;
  budgetLabelI18n: string;
  budgetEstimateI18n: string;
  dayLabelI18n: string;
  poweredBy: string;
}): string {
  const { cityName, items, title, subtitleText, budgetTotalLabel, budgetLabelI18n, budgetEstimateI18n, dayLabelI18n, poweredBy } = params;

  const byDay: Record<number, ItineraryItem[]> = {};
  items.forEach((it) => {
    const d = typeof it.day === "number" ? it.day : 1;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(it);
  });

  const dayKeys = Object.keys(byDay)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  const dayHtml = dayKeys
    .map((day) => {
      const list = byDay[day]
        .map((it) => {
          const itemBudget = estimateItemBudget(it);
          const budgetText = formatBudgetRange(itemBudget);
          const subtype = it.subtype ? `<span class="tag">${escapeHtml(it.subtype)}</span>` : "";
          const rating = typeof it.rating === "number" ? `★ ${it.rating.toFixed(1)}` : "";
          return `
            <div class="item">
              <div class="time">${escapeHtml(it.startTime)} - ${escapeHtml(it.endTime)}</div>
              <div class="title">${escapeHtml(it.title)}</div>
              <div class="meta">
                <span class="tag">${escapeHtml(it.category)}</span>
                ${subtype}
                ${rating ? `<span class="rating">${escapeHtml(rating)}</span>` : ""}
                <span class="price">${escapeHtml(budgetText)}</span>
              </div>
            </div>
          `;
        })
        .join("\n");
      return `
        <section class="day">
          <h2>${escapeHtml(dayLabelI18n.replace("{{n}}", String(day)))}</h2>
          ${list}
        </section>
      `;
    })
    .join("\n");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4; margin: 24mm 16mm; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #18181b; }
          header { border-bottom: 2px solid #18181b; padding-bottom: 16px; margin-bottom: 24px; }
          header h1 { font-size: 28px; margin: 0; }
          header .city { font-size: 14px; color: #71717a; margin-top: 8px; }
          header .sub { font-size: 12px; color: #52525b; margin-top: 6px; }
          .budget { display: inline-block; margin-top: 12px; padding: 8px 14px; background: #fff7ed; color: #c2410c; border-radius: 999px; font-weight: 700; font-size: 12px; }
          .day { margin-bottom: 24px; }
          .day h2 { font-size: 18px; margin: 0 0 12px 0; padding-bottom: 8px; border-bottom: 1px solid #e4e4e7; }
          .item { padding: 12px 14px; border-radius: 12px; background: #fafafa; margin-bottom: 10px; }
          .time { font-size: 11px; color: #71717a; font-weight: 700; }
          .title { font-size: 14px; font-weight: 800; margin-top: 4px; }
          .meta { margin-top: 6px; font-size: 11px; color: #52525b; }
          .meta .tag { display: inline-block; padding: 2px 8px; margin-right: 6px; background: #e4e4e7; border-radius: 8px; }
          .meta .rating { margin-right: 6px; }
          .meta .price { display: inline-block; padding: 2px 8px; background: #ffedd5; color: #c2410c; border-radius: 8px; font-weight: 700; }
          footer { margin-top: 24px; text-align: center; font-size: 10px; color: #a1a1aa; }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapeHtml(title)}</h1>
          <div class="city">${escapeHtml(cityName)}</div>
          <div class="sub">${escapeHtml(subtitleText)}</div>
          <div class="budget">${escapeHtml(budgetLabelI18n)}: ${escapeHtml(budgetTotalLabel)} <span style="opacity:0.7;font-size:10px">${escapeHtml(budgetEstimateI18n)}</span></div>
        </header>
        ${dayHtml}
        <footer>${escapeHtml(poweredBy)}</footer>
      </body>
    </html>
  `;
}

export async function exportItineraryPdf(params: {
  cityName: string;
  items: ItineraryItem[];
  request: ItineraryRequest;
  i18n: {
    titleText: string;
    subtitleText: string;
    dayLabel: string;
    budgetLabel: string;
    budgetEstimate: string;
    poweredBy: string;
  };
}): Promise<string> {
  const budget = estimateItineraryBudget(params.items);
  const html = buildItineraryHtml({
    cityName: params.cityName,
    items: params.items,
    language: params.request.language,
    title: params.i18n.titleText,
    subtitleText: params.i18n.subtitleText,
    budgetTotalLabel: formatBudgetRange({ min: budget.totalMin, max: budget.totalMax }),
    budgetLabelI18n: params.i18n.budgetLabel,
    budgetEstimateI18n: params.i18n.budgetEstimate,
    dayLabelI18n: params.i18n.dayLabel,
    poweredBy: params.i18n.poweredBy,
  });

  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}

export async function shareItineraryPdf(uri: string): Promise<void> {
  const ok = await Sharing.isAvailableAsync();
  if (!ok) {
    throw new Error("Sharing not available on this platform.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "RotaLezzet",
  });
}

export async function shareItineraryText(params: {
  cityName: string;
  items: ItineraryItem[];
  language: string;
}): Promise<void> {
  const lines: string[] = [];
  lines.push(`RotaLezzet · ${params.cityName}`);
  lines.push("");
  const byDay: Record<number, ItineraryItem[]> = {};
  params.items.forEach((it) => {
    const d = typeof it.day === "number" ? it.day : 1;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(it);
  });
  const dayKeys = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  dayKeys.forEach((day) => {
    lines.push(`Day ${day}:`);
    byDay[day].forEach((it, idx) => {
      lines.push(`  ${idx + 1}. ${it.startTime}-${it.endTime} ${it.title}`);
    });
    lines.push("");
  });
  await Share.share({
    message: lines.join("\n"),
    title: `RotaLezzet · ${params.cityName}`,
  });
}

export function isSharingPlatform(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}
