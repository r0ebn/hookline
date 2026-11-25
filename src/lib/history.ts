import type { InferenceOrigin } from "./ai";

export interface HistoryEntry {
  id: string;
  createdAt: number;
  transcript: string;
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  draftOrigin: InferenceOrigin;
  polishOrigin: InferenceOrigin;
}

const KEY = "hookline.history.v1";
const MAX_ENTRIES = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage full or unavailable; history is a convenience, not critical.
  }
}
