// Hookline AI layer. Every AI call in this app goes through Firebase AI Logic
// (the hackathon requirement). No other model API is called anywhere.
//
// Hybrid routing:
// - Draft step  -> InferenceMode.PREFER_ON_DEVICE: Gemini Nano in Chrome
//   drafts locally (fast, private, works offline); if on-device inference is
//   unavailable the SDK falls back to a cloud model from the fallback chain.
// - Polish step -> InferenceMode.PREFER_IN_CLOUD: the longer, higher quality
//   rewrite runs on cloud Gemini, with on-device as fallback.
//
// Which one actually served a request is read back from
// result.response.inferenceSource and surfaced to the UI as `origin`.

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
  type GenerativeModel,
} from "firebase/ai";
import { firebaseApp } from "./firebase";

// Firebase AI Logic, Gemini Developer API backend (free tier, no billing).
// Pattern follows https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

// Cloud models, tried in order whenever a hybrid request is served in the
// cloud (free tier on the Gemini Developer API backend, no billing).
// Model choice history, learned from live calls on this project:
// - gemini-2.5-flash: 404, "no longer available to new users" (Nov 2026).
// - gemini-3.8-flash: reachable but chronically overloaded on the free tier
//   (503 deadline expired, then 500 "high demand" twice in a row).
// - The Flash-Lite models carry the bulk of successful free-tier traffic,
//   so they lead the chain; heavier models remain as later fallbacks.
// If one model errors (overload, timeout, retirement), the next is tried
// automatically, so a single busy model never blocks the user.
const CLOUD_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
];

function hybridModel(
  mode: InferenceMode,
  cloudModel: string,
): GenerativeModel {
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: { model: cloudModel },
  });
}

/** Device-facing model, used to prepare (download) Gemini Nano. */
const deviceModel: GenerativeModel = hybridModel(
  InferenceMode.PREFER_ON_DEVICE,
  CLOUD_MODELS[0],
);

type GenerateRequest = Parameters<GenerativeModel["generateContent"]>[0];
type GenerateResult = Awaited<ReturnType<GenerativeModel["generateContent"]>>;

/**
 * Runs one generation with the given routing mode, walking the cloud model
 * fallback chain until one model answers. On-device success returns on the
 * first attempt; the chain only advances when a call actually errors.
 */
async function generateWithFallback(
  mode: InferenceMode,
  request: GenerateRequest,
): Promise<GenerateResult> {
  let lastError: unknown;
  for (const cloudModel of CLOUD_MODELS) {
    try {
      return await hybridModel(mode, cloudModel).generateContent(request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "All cloud models failed."));
}

export type InferenceOrigin = "on-device" | "cloud" | "unknown";

/**
 * Prepares the on-device model. Must be called from a user gesture (for
 * example a button click) BEFORE the first on-device request, because Chrome
 * may need to download Gemini Nano first. Reports download progress (0..1)
 * via the callback. Safe to call when the device has no on-device model:
 * it resolves quietly and PREFER_ON_DEVICE requests fall back to the cloud.
 */
export async function initDeviceModel(
  onProgress?: (fraction: number) => void,
): Promise<void> {
  try {
    await deviceModel.initializeDeviceModel((value: number) => {
      onProgress?.(value);
    });
    onProgress?.(1);
  } catch {
    // On-device model unavailable (unsupported browser or blocked download).
    // Not fatal: requests fall back to the cloud model.
  }
}

export interface DraftResult {
  hooks: string[];
  captions: string[];
  origin: InferenceOrigin;
}

export interface PolishResult {
  caption: string;
  hashtags: string[];
  cta: string;
  origin: InferenceOrigin;
}

function toOrigin(source: InferenceSource | undefined): InferenceOrigin {
  if (source === InferenceSource.ON_DEVICE) return "on-device";
  if (source === InferenceSource.IN_CLOUD) return "cloud";
  return "unknown";
}

/**
 * Repairs JSON that was cut off mid-stream (on-device models have small
 * output limits, so a long structured answer can end mid-string). Cuts the
 * text at the last comma outside any string and closes every bracket that
 * was open at that point, keeping only complete elements.
 */
function repairTruncatedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const s = text.slice(start);
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  let cutIndex = -1;
  let cutStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === "," && stack.length > 0) {
      cutIndex = i;
      cutStack = [...stack];
    }
  }
  if (cutIndex < 0) return null;
  const closers = cutStack
    .reverse()
    .map((open) => (open === "{" ? "}" : "]"))
    .join("");
  return s.slice(0, cutIndex) + closers;
}

/** Parses a model JSON response, tolerating markdown fences and prose around the object. */
function parseJson(text: string): Record<string, unknown> {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  // On-device models sometimes wrap the JSON in explanatory prose; extract
  // the outermost object before parsing.
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    // Maybe the answer was truncated mid-JSON; try to salvage complete items.
    const repaired = repairTruncatedJson(unfenced);
    if (repaired) {
      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        // fall through to the error below
      }
    }
    throw new Error(
      "The model returned a response that was not valid JSON. Please try again.",
    );
  }
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`The model response is missing the "${field}" list.`);
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const draftSchema = Schema.object({
  properties: {
    hooks: Schema.array({ items: Schema.string() }),
    captions: Schema.array({ items: Schema.string() }),
  },
});

const polishSchema = Schema.object({
  properties: {
    caption: Schema.string(),
    hashtags: Schema.array({ items: Schema.string() }),
    cta: Schema.string(),
  },
});

/**
 * Drafts 5 hooks and 3 captions from a clip transcript, preferring on-device
 * inference so the draft is instant, private, and works offline.
 */
export async function draftHooksAndCaptions(
  transcript: string,
): Promise<DraftResult> {
  const prompt = [
    "You are Hookline, a hook and caption assistant for short-form clip creators (TikTok, Reels, Shorts).",
    "From the video transcript below, write:",
    "- Exactly 5 scroll-stopping hooks. Each hook is one short line (max 12 words) written to be spoken or shown in the first 3 seconds. Vary the angles: one question, one bold claim, one curiosity gap, one relatable pain point, one number or result.",
    "- Exactly 3 short captions for the post (max 40 words each), each with a different tone: punchy, friendly, and curiosity-driven.",
    "Write in the same language as the transcript. No emojis inside hooks. No hashtags in the hooks or captions.",
    "",
    "TRANSCRIPT:",
    transcript.trim(),
  ].join("\n");

  const request: GenerateRequest = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: draftSchema,
      temperature: 0.9,
    },
  };

  // Two attempts: device first, then cloud. A generation that returns
  // unusable text (for example Gemini Nano answering with prose around the
  // JSON) counts as a failed attempt, so the cloud attempt still runs and
  // the user is never stuck with a parse error.
  let lastError: unknown;
  for (const mode of [
    InferenceMode.PREFER_ON_DEVICE,
    InferenceMode.PREFER_IN_CLOUD,
  ]) {
    try {
      const result = await generateWithFallback(mode, request);
      const parsed = parseJson(result.response.text());
      const hooks = asStringArray(parsed.hooks, "hooks").slice(0, 5);
      const captions = asStringArray(parsed.captions, "captions").slice(0, 3);
      if (hooks.length === 0 || captions.length === 0) {
        throw new Error("The model returned no hooks or captions.");
      }
      return {
        hooks,
        captions,
        origin: toOrigin(result.response.inferenceSource),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Draft failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Polishes one chosen hook and caption into a post-ready package on the cloud
 * model: final caption, hashtags, and a call to action.
 */
export async function polishCaption(
  hook: string,
  caption: string,
  transcript?: string,
): Promise<PolishResult> {
  const prompt = [
    "You are Hookline, a hook and caption assistant for short-form clip creators (TikTok, Reels, Shorts).",
    "Polish the chosen hook and draft caption below into a post-ready package:",
    "- caption: one polished caption (max 60 words) that opens with the hook's energy, keeps the creator's voice, and reads naturally. Emojis are allowed sparingly (max 2).",
    "- hashtags: 6 to 10 relevant hashtags, each WITHOUT the # symbol, lowercase, no spaces.",
    "- cta: one short call to action (max 10 words) inviting a comment, save, share, or follow.",
    "Write in the same language as the hook and caption.",
    "",
    `CHOSEN HOOK: ${hook.trim()}`,
    `DRAFT CAPTION: ${caption.trim()}`,
    ...(transcript
      ? ["", "ORIGINAL TRANSCRIPT (context only):", transcript.trim()]
      : []),
  ].join("\n");

  const request: GenerateRequest = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: polishSchema,
      temperature: 0.7,
    },
  };

  // One retry: a single malformed response should not fail the polish.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateWithFallback(
        InferenceMode.PREFER_IN_CLOUD,
        request,
      );
      const parsed = parseJson(result.response.text());
      const finalCaption =
        typeof parsed.caption === "string" ? parsed.caption.trim() : "";
      const hashtags = asStringArray(parsed.hashtags, "hashtags")
        .map((tag) => tag.replace(/^#+/, "").replace(/\s+/g, ""))
        .filter((tag) => tag.length > 0)
        .slice(0, 10);
      const cta = typeof parsed.cta === "string" ? parsed.cta.trim() : "";
      if (!finalCaption) {
        throw new Error("The model returned an empty caption.");
      }
      return {
        caption: finalCaption,
        hashtags,
        cta,
        origin: toOrigin(result.response.inferenceSource),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Polish failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
