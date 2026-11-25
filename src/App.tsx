import { useEffect, useState } from "react";
import {
  draftHooksAndCaptions,
  initDeviceModel,
  polishCaption,
  type DraftResult,
  type InferenceOrigin,
  type PolishResult,
} from "./lib/ai";
import {
  loadHistory,
  saveHistory,
  type HistoryEntry,
} from "./lib/history";

const SAMPLE_TRANSCRIPT = `Okay so I'm one versus three, bomb is down, twenty seconds left. I hear one in heaven, one pushing short. I fake the plant, he peeks, got him. Second one swings wide, I tap him too. Last guy is saving, I hunt him down with five HP left. Clutch or kick? We take those. Clip it, chat, that round was insane.`;

function OriginBadge({ origin }: { origin: InferenceOrigin }) {
  if (origin === "on-device") {
    return (
      <span className="badge on-device">
        <span className="dot" /> On-device · Gemini Nano
      </span>
    );
  }
  if (origin === "cloud") {
    return (
      <span className="badge cloud">
        <span className="dot" /> Cloud · Gemini
      </span>
    );
  }
  return (
    <span className="badge">
      <span className="dot" /> Origin unknown
    </span>
  );
}

export default function App() {
  const [transcript, setTranscript] = useState("");
  const [deviceProgress, setDeviceProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<"draft" | "polish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [selectedHook, setSelectedHook] = useState(0);
  const [selectedCaption, setSelectedCaption] = useState(0);
  const [polished, setPolished] = useState<PolishResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  async function handleDraft() {
    const text = transcript.trim();
    if (text.length < 10 || busy) return;
    setError(null);
    setBusy("draft");
    setPolished(null);
    setCopied(false);
    try {
      // The click is the user gesture Chrome requires before the on-device
      // model can be prepared (first run may download Gemini Nano).
      if (deviceProgress === null || deviceProgress < 1) {
        await initDeviceModel((fraction) => setDeviceProgress(fraction));
      }
      const result = await draftHooksAndCaptions(text);
      setDraft(result);
      setSelectedHook(0);
      setSelectedCaption(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handlePolish() {
    if (!draft || busy) return;
    const hook = draft.hooks[selectedHook];
    const caption = draft.captions[selectedCaption];
    if (!hook || !caption) return;
    setError(null);
    setBusy("polish");
    setCopied(false);
    try {
      const result = await polishCaption(hook, caption, transcript);
      setPolished(result);
      setHistory((prev) =>
        [
          {
            id: `${Date.now()}`,
            createdAt: Date.now(),
            transcript: transcript.trim(),
            hook,
            caption: result.caption,
            hashtags: result.hashtags,
            cta: result.cta,
            draftOrigin: draft.origin,
            polishOrigin: result.origin,
          },
          ...prev,
        ].slice(0, 20),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (!polished) return;
    const text = [
      polished.caption,
      "",
      polished.hashtags.map((tag) => `#${tag}`).join(" "),
      "",
      polished.cta,
    ]
      .filter((line, index, arr) => line !== "" || arr[index - 1] !== "")
      .join("\n")
      .trim();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed. Your browser blocked clipboard access.");
    }
  }

  function openHistory(entry: HistoryEntry) {
    setTranscript(entry.transcript);
    setDraft({
      hooks: [entry.hook],
      captions: [entry.caption],
      origin: entry.draftOrigin,
    });
    setSelectedHook(0);
    setSelectedCaption(0);
    setPolished({
      caption: entry.caption,
      hashtags: entry.hashtags,
      cta: entry.cta,
      origin: entry.polishOrigin,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const drafting = busy === "draft";
  const polishing = busy === "polish";
  const showProgress =
    deviceProgress !== null && deviceProgress < 1 && drafting;

  return (
    <main className="page">
      <header className="hero">
        <h1>
          Hook<span className="hook-accent">line</span>
        </h1>
        <p className="tagline">
          Hooks and captions for clip creators, drafted on your device and
          polished in the cloud.
        </p>
        <p className="sub">
          Paste a clip transcript. Gemini Nano drafts 5 hooks and 3 captions
          locally: fast, private, and offline friendly. Pick a winner and cloud
          Gemini turns it into a post ready package.
        </p>
      </header>

      <section className="card">
        <label className="field-label" htmlFor="transcript">
          Video transcript or topic
        </label>
        <textarea
          id="transcript"
          rows={7}
          placeholder="Paste a transcript, a clip description, or even rough notes about the moment…"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />
        <div className="row spread" style={{ marginTop: 12 }}>
          <span className="char-count">{transcript.trim().length} characters</span>
          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
              disabled={busy !== null}
            >
              Try a sample
            </button>
            <button
              type="button"
              className="primary"
              onClick={handleDraft}
              disabled={transcript.trim().length < 10 || busy !== null}
            >
              {drafting ? "Drafting…" : "Draft on-device"}
            </button>
          </div>
        </div>
        {showProgress && (
          <div className="progress-wrap">
            <div className="progress-label">
              Preparing the on-device model… {Math.round((deviceProgress ?? 0) * 100)}%
              (first run downloads Gemini Nano; later drafts are instant)
            </div>
            <div className="progress-bar">
              <div style={{ width: `${Math.round((deviceProgress ?? 0) * 100)}%` }} />
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      {draft && (
        <>
          <section className="card">
            <div className="section-head">
              <h2>1 · Pick a hook</h2>
              <OriginBadge origin={draft.origin} />
            </div>
            <div className="pick-list">
              {draft.hooks.map((hook, index) => (
                <button
                  key={index}
                  type="button"
                  className={`pick${index === selectedHook ? " selected" : ""}`}
                  onClick={() => setSelectedHook(index)}
                >
                  <span className="pick-num">{index + 1}</span>
                  <span>{hook}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>2 · Pick a caption draft</h2>
            </div>
            <div className="pick-list">
              {draft.captions.map((caption, index) => (
                <button
                  key={index}
                  type="button"
                  className={`pick${index === selectedCaption ? " selected" : ""}`}
                  onClick={() => setSelectedCaption(index)}
                >
                  <span className="pick-num">{index + 1}</span>
                  <span>{caption}</span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="primary"
                onClick={handlePolish}
                disabled={busy !== null}
              >
                {polishing ? "Polishing in the cloud…" : "Polish in the cloud"}
              </button>
              <span className="char-count">
                Cloud Gemini rewrites your pick into the final post package.
              </span>
            </div>
          </section>
        </>
      )}

      {polished && (
        <section className="card">
          <div className="section-head">
            <h2>3 · Your post package</h2>
            <OriginBadge origin={polished.origin} />
          </div>
          <p className="polished-caption">{polished.caption}</p>
          {polished.hashtags.length > 0 && (
            <div className="chips">
              {polished.hashtags.map((tag) => (
                <span key={tag} className="chip">
                  #{tag}
                </span>
              ))}
            </div>
          )}
          {polished.cta && (
            <p className="cta-line">
              <span>CTA</span>
              {polished.cta}
            </p>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy post package"}
            </button>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>History on this device</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => setHistory([])}
            >
              Clear all
            </button>
          </div>
          {history.map((entry) => (
            <div
              key={entry.id}
              className="history-item"
              role="button"
              tabIndex={0}
              onClick={() => openHistory(entry)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openHistory(entry);
              }}
            >
              <div className="h-main">
                <div className="h-hook">{entry.hook}</div>
                <div className="h-meta">
                  {new Date(entry.createdAt).toLocaleString()} · draft{" "}
                  {entry.draftOrigin} · polish {entry.polishOrigin}
                </div>
              </div>
              <button
                type="button"
                className="h-del"
                aria-label="Delete history entry"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistory((prev) =>
                    prev.filter((item) => item.id !== entry.id),
                  );
                }}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      <footer className="foot">
        Built with Firebase AI Logic hybrid inference: Gemini Nano on-device
        for drafts, Gemini in the cloud for polish. Drafts never leave your
        device when the on-device model serves them.
      </footer>
    </main>
  );
}
