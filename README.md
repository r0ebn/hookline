# Hookline

Draft hooks and captions on-device, offline and private; polish the winners in the cloud.

Built for **#BuildHybridAI 2026** (Google x Firebase, Devpost): a generative AI web app
that uses Firebase AI Logic hybrid inference. On-device Gemini Nano drafts, cloud Gemini
polishes. **All AI inference goes through Firebase AI Logic** (`firebase/ai`); no other
model API is called anywhere in this codebase.

**Live demo:** https://r0ebn.github.io/hookline/

## What it does

Short-form creators write hooks and captions all day, and their ideas are unpublished
until they post. Hookline keeps the drafting on the creator's own device:

1. The creator pastes a video transcript (or a topic) and clicks **Draft on-device**.
2. Gemini Nano (`InferenceMode.PREFER_ON_DEVICE`) drafts **5 hooks + 3 captions** as
   structured JSON in seconds. Nothing leaves the device, and it works offline once the
   model is downloaded. If no on-device model is available, the SDK falls back to the
   cloud model automatically.
3. The creator picks a hook and a caption draft, then clicks **Polish in the cloud**.
   Cloud Gemini (`InferenceMode.PREFER_IN_CLOUD`) returns a post-ready package: final
   caption, hashtags, and a call to action (structured JSON).
4. Every result carries a badge, **On-device · Gemini Nano** or **Cloud · Gemini**, read
   from the response's `inferenceSource`, so the hybrid routing is always visible.
5. Finished packages are kept in a local on-device history (localStorage), with a
   one-click **Copy post package** button.

## Tech stack

- Vite + React + TypeScript
- Firebase JS SDK v12 (`firebase/ai`, Firebase AI Logic)
- Gemini Developer API backend (free tier, no billing)
- Firebase App Check (Fraud Defense / reCAPTCHA Enterprise in production; a registered
  debug token for local development only)

## Run it locally

Requirements: Node 20+, Chrome Desktop v139+ for the on-device path.

1. Clone this repo and install dependencies:

   ```bash
   npm install
   ```

2. Create a Firebase project, enable **AI Logic** with the **Gemini Developer API**
   backend, register a web app, and register **App Check** with the Fraud Defense
   (reCAPTCHA Enterprise) provider.

3. Copy `.env.example` to `.env.local` and fill in your web app config. For local
   development, also generate any UUID, put it in `VITE_APPCHECK_DEBUG_TOKEN`, and
   register the same value in the Firebase console (App Check > your app > Manage
   debug tokens). Never commit `.env.local` or a debug token.

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. For real on-device inference, enable the Chrome flag
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.
   The first draft click downloads Gemini Nano (progress is shown in the UI); without
   the flag or the model, drafts transparently fall back to the cloud.

## How Firebase AI Logic is used

- `src/lib/ai.ts` creates hybrid models with `getGenerativeModel`:
  the draft step uses `PREFER_ON_DEVICE` and the polish step uses
  `PREFER_IN_CLOUD`, on the Gemini Developer API backend.
- Cloud calls walk a fallback chain of Gemini models
  (`gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, `gemini-3.8-flash`,
  `gemini-3.5-flash`), so if one model is overloaded or retired the next one
  answers automatically. The heavier `gemini-3.8-flash` proved chronically
  overloaded on the free tier, which is why the Lite models lead the chain.
- Drafting tries three attempts in order: structured JSON with
  `PREFER_ON_DEVICE`; a plain line format with `ONLY_ON_DEVICE` (small
  on-device models often ignore JSON schemas or truncate long JSON, while a
  line format is easy for them, and the badge then proves the draft ran
  locally); and structured JSON with `PREFER_IN_CLOUD`. Verified live on
  25 Nov 2026: Gemini Nano drafted on-device in Chrome on Windows with the
  "On-device · Gemini Nano" badge, and the cloud path completed the full
  flow end to end.
- Both calls use structured output (`responseSchema` + `application/json`) and read
  `result.response.inferenceSource` to label where inference actually ran.
- `initializeDeviceModel()` is called from the Draft button's click handler (a user
  gesture, as Chrome requires) before the first on-device request.
- App Check is initialized in `src/lib/firebase.ts` before AI Logic is used.

## License

MIT — see `LICENSE`.
