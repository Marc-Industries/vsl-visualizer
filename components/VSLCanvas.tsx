import React, { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

declare global {
    interface ImportMeta {
        env: Record<string, string | undefined>;
    }
}
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || "http://localhost:3001";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Scene {
    sceneIndex: number;
    status: "pending" | "processing" | "image_ready" | "generating_video" | "video_ready" | "error";
    imageUrl?: string;
    videoUrl?: string;
    prompt?: string;
    jobId?: string;
    isMaster?: boolean;
}

interface ProjectState {
    scenes: Scene[];
    totalScenes: number;
}

interface SceneUpdatePayload {
    scene: Scene;
    totalScenes?: number;
}

interface UploadFormData {
    type: "SRT" | "PROMPTS";
    content: string;
    sampling_sec: number;
}

// ─── Polling Kie.ai per stato video ───────────────────────────────────────────
function useVideoPolling(
    scenes: Scene[],
    setScenes: React.Dispatch<React.SetStateAction<Scene[]>>
) {
    const pollingRefs = useRef<Record<string, boolean>>({});

    const pollJobStatus = useCallback(
        async (jobId: string, sceneIndex: number) => {
            if (pollingRefs.current[jobId]) return;
            pollingRefs.current[jobId] = true;

            const check = async () => {
                try {
                    const res = await fetch(`${BRIDGE_URL}/proxy/kie-status/${jobId}`);
                    const data = await res.json();

                    if (data.status === "SUCCESS" && data.video_url) {
                        setScenes((prev) =>
                            prev.map((s) =>
                                s.sceneIndex === sceneIndex
                                    ? { ...s, status: "video_ready", videoUrl: data.video_url }
                                    : s
                            )
                        );
                        delete pollingRefs.current[jobId];
                    } else if (data.status === "FAILED") {
                        setScenes((prev) =>
                            prev.map((s) =>
                                s.sceneIndex === sceneIndex ? { ...s, status: "error" } : s
                            )
                        );
                        delete pollingRefs.current[jobId];
                    } else {
                        setTimeout(check, 8000);
                    }
                } catch {
                    setTimeout(check, 12000);
                }
            };

            setTimeout(check, 5000);
        },
        [setScenes]
    );

    useEffect(() => {
        scenes.forEach((scene) => {
            if (scene.status === "generating_video" && scene.jobId) {
                pollJobStatus(scene.jobId, scene.sceneIndex);
            }
        });
    }, [scenes, pollJobStatus]);
}

// ─── Card singola scena ───────────────────────────────────────────────────────
function SceneCard({ scene }: { scene: Scene }): React.ReactElement {
    const { status, imageUrl, videoUrl, prompt, isMaster, sceneIndex } = scene;
    const isReady = status === "video_ready";
    const isGenerating = status === "generating_video";
    const hasImage =
        status === "image_ready" || isGenerating || isReady;

    return (
        <div className={`scene-card ${status} ${isMaster ? "master" : ""}`}>
            <div className="scene-badge">
                {isMaster ? (
                    <span className="badge master-badge">★ MASTER</span>
                ) : (
                    <span className="badge index-badge">
                        S{String(sceneIndex).padStart(2, "0")}
                    </span>
                )}
                <span className={`status-dot status-${status}`} />
            </div>

            <div className="scene-media">
                {isReady && videoUrl && (
                    <video
                        src={videoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="media-element"
                    />
                )}

                {hasImage && !isReady && imageUrl && (
                    <div className="image-wrapper">
                        <img
                            src={imageUrl}
                            alt={`Scene ${sceneIndex}`}
                            className="media-element"
                        />
                        {isGenerating && (
                            <div className="generating-overlay">
                                <div className="spinner-ring" />
                                <p className="spinner-label">
                                    Generazione
                                    <br />
                                    Video…
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {!hasImage && (
                    <div className="placeholder">
                        <div className="placeholder-pulse" />
                        <p className="placeholder-label">
                            {status === "processing" ? "Analisi prompt…" : "In attesa…"}
                        </p>
                    </div>
                )}
            </div>

            {prompt && (
                <div className="scene-prompt">
                    <p>{prompt.length > 100 ? prompt.slice(0, 100) + "…" : prompt}</p>
                </div>
            )}

            <div className="scene-status-bar">
                <span className="status-text">
                    {status === "pending" && "In coda"}
                    {status === "processing" && "Elaborazione…"}
                    {status === "image_ready" && "Immagine pronta"}
                    {status === "generating_video" && "Video in generazione"}
                    {status === "video_ready" && "✓ Completato"}
                    {status === "error" && "⚠ Errore"}
                </span>
            </div>
        </div>
    );
}

// ─── Upload Form ───────────────────────────────────────────────────────────────
function UploadForm({
    onSubmit,
    isLoading,
}: {
    onSubmit: (data: UploadFormData) => void;
    isLoading: boolean;
}) {
    const [type, setType] = useState<"SRT" | "PROMPTS">("SRT");
    const [content, setContent] = useState("");
    const [samplingInterval, setSamplingInterval] = useState(5);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!content.trim()) return;
        onSubmit({ type, content, sampling_sec: samplingInterval });
    };

    return (
        <form className="upload-form" onSubmit={handleSubmit}>
            <div className="form-row">
                <div className="input-group">
                    <label>Tipo Input</label>
                    <div className="toggle-group">
                        {(["SRT", "PROMPTS"] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                className={`toggle-btn ${type === t ? "active" : ""}`}
                                onClick={() => setType(t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="input-group">
                    <label>Frame ogni (sec)</label>
                    <input
                        type="number"
                        min={2}
                        max={30}
                        value={samplingInterval}
                        onChange={(e) => setSamplingInterval(Number(e.target.value))}
                        className="num-input"
                    />
                </div>
            </div>

            <div className="input-group full">
                <label>{type === "SRT" ? "Contenuto SRT" : "Prompt (uno per riga)"}</label>
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                        type === "SRT"
                            ? "1\n00:00:00,000 --> 00:00:05,000\nCiao mondo!"
                            : "Scena 1: uomo che cammina in città\nScena 2: barista che prepara caffè"
                    }
                    className="script-textarea"
                    rows={8}
                />
            </div>

            <button
                type="submit"
                className="submit-btn"
                disabled={isLoading || !content.trim()}
            >
                {isLoading ? (
                    <>
                        <span className="btn-spinner" /> Avvio elaborazione…
                    </>
                ) : (
                    <>⚡ Genera VSL</>
                )}
            </button>
        </form>
    );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({
    scenes,
    totalScenes,
}: {
    scenes: Scene[];
    totalScenes: number;
}) {
    const completed = scenes.filter((s) => s.status === "video_ready").length;
    const withImage = scenes.filter((s) =>
        ["image_ready", "generating_video", "video_ready"].includes(s.status)
    ).length;
    const pct =
        totalScenes > 0 ? Math.round((completed / totalScenes) * 100) : 0;

    return (
        <div className="progress-container">
            <div className="progress-stats">
                <span>
                    Scene totali: <strong>{totalScenes || "—"}</strong>
                </span>
                <span>
                    Immagini: <strong>{withImage}</strong>
                </span>
                <span>
                    Video pronti: <strong>{completed}</strong>
                </span>
                <span className="pct-label">{pct}%</span>
            </div>
            <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

// ─── App principale ────────────────────────────────────────────────────────────
export default function VSLCanvas() {
    const [projectId] = useState<string>(() => `proj_${Date.now()}`);
    const [scenes, setScenes] = useState<Scene[]>([]);
    const [totalScenes, setTotalScenes] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done">("idle");
    const socketRef = useRef<Socket | null>(null);

    useVideoPolling(scenes, setScenes);

    // ── Socket.io setup ─────────────────────────────────────────────────────────
    useEffect(() => {
        const socket = io(BRIDGE_URL, { transports: ["websocket"] });
        socketRef.current = socket;

        socket.on("connect", () => {
            setIsConnected(true);
            socket.emit("join_project", projectId);
        });

        socket.on("disconnect", () => setIsConnected(false));

        socket.on("project_state", (project: ProjectState) => {
            setScenes(project.scenes || []);
            setTotalScenes(project.totalScenes || 0);
        });

        socket.on("scene_update", ({ scene, totalScenes: ts }: SceneUpdatePayload) => {
            if (ts) setTotalScenes(ts);
            setScenes((prev) => {
                const exists = prev.find((s) => s.sceneIndex === scene.sceneIndex);
                if (exists) {
                    return prev.map((s) =>
                        s.sceneIndex === scene.sceneIndex ? { ...s, ...scene } : s
                    );
                }
                return [...prev, scene].sort((a, b) => a.sceneIndex - b.sceneIndex);
            });
            setPhase("processing");
            setIsLoading(false);
        });

        return () => {
            socket.disconnect();
        };
    }, [projectId]);

    // ── Avvio progetto ──────────────────────────────────────────────────────────
    const handleSubmit = async ({ type, content, sampling_sec }: UploadFormData) => {
        setIsLoading(true);
        setPhase("uploading");
        setScenes([]);
        setTotalScenes(0);

        try {
            const res = await fetch(`${BRIDGE_URL}/start-project`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ project_id: projectId, type, content, sampling_sec }),
            });
            if (!res.ok) throw new Error(`Bridge error: ${res.status}`);
        } catch (err) {
            console.error(err);
            setIsLoading(false);
            setPhase("idle");
            alert("Errore avvio progetto: " + (err instanceof Error ? err.message : "Unknown error"));
        }
    };

    const allDone =
        totalScenes > 0 &&
        scenes.filter((s) => s.status === "video_ready").length === totalScenes;

    return (
        <>
            <style>{STYLES}</style>
            <div className="vsl-app">
                {/* HEADER */}
                <header className="vsl-app-header">
                    <div className="vsl-logo">
                        <span className="vsl-logo-icon">⚡</span>
                        <span className="vsl-logo-text">ANTIGRAVITY</span>
                        <span className="vsl-logo-sub">VSL Studio · Bridge</span>
                    </div>
                    <div className="vsl-connection-status">
                        <span className={`conn-dot ${isConnected ? "connected" : "disconnected"}`} />
                        <span>{isConnected ? "Bridge connesso" : "Bridge disconnesso"}</span>
                    </div>
                </header>

                <main className="vsl-app-main">
                    {/* FORM */}
                    {phase === "idle" && (
                        <section className="upload-section">
                            <h1 className="hero-title">
                                Trasforma lo script
                                <br />
                                in un video professionale
                            </h1>
                            <p className="hero-sub">
                                Carica il tuo SRT o una lista di prompt. Ogni scena verrà generata
                                in tempo reale tramite il Bridge.
                            </p>
                            <UploadForm onSubmit={handleSubmit} isLoading={isLoading} />
                        </section>
                    )}

                    {/* PROCESSING / CANVAS */}
                    {(phase === "uploading" || phase === "processing") && (
                        <section className="canvas-section">
                            <div className="canvas-header">
                                <div>
                                    <h2 className="canvas-title">
                                        {phase === "uploading"
                                            ? "Avvio generazione…"
                                            : "Generazione in corso"}
                                    </h2>
                                    <p className="canvas-sub">
                                        {phase === "uploading"
                                            ? "n8n sta analizzando lo script"
                                            : "Le scene appaiono man mano che vengono completate"}
                                    </p>
                                </div>
                                <button
                                    className="reset-btn"
                                    onClick={() => {
                                        setPhase("idle");
                                        setScenes([]);
                                    }}
                                >
                                    ← Nuovo progetto
                                </button>
                            </div>

                            <ProgressBar scenes={scenes} totalScenes={totalScenes} />

                            {scenes.length === 0 ? (
                                <div className="waiting-state">
                                    <div className="pulse-ring" />
                                    <p>In attesa della prima scena da n8n…</p>
                                </div>
                            ) : (
                                <div className="scenes-grid">
                                    {scenes.map((scene) => (
                                        <SceneCard key={scene.sceneIndex} scene={scene} />
                                    ))}
                                </div>
                            )}

                            {allDone && (
                                <div className="done-banner">
                                    ✓ Tutte le {totalScenes} scene sono state generate con successo!
                                </div>
                            )}
                        </section>
                    )}
                </main>
            </div>
        </>
    );
}

// ─── STYLES (scoped con prefisso vsl- per evitare conflitti) ──────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

  .vsl-app *, .vsl-app *::before, .vsl-app *::after { box-sizing: border-box; }

  .vsl-app {
    --vsl-bg: #080a0e;
    --vsl-surface: #0e1117;
    --vsl-surface2: #161b24;
    --vsl-border: rgba(255,255,255,0.07);
    --vsl-accent: #e8ff47;
    --vsl-accent2: #47c5ff;
    --vsl-text: #f0f4ff;
    --vsl-text-dim: rgba(240,244,255,0.45);
    --vsl-success: #47ffa0;
    --vsl-warn: #ffa747;
    --vsl-error: #ff4747;
    --vsl-radius: 12px;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--vsl-bg);
    color: var(--vsl-text);
    font-family: 'Syne', sans-serif;
  }

  /* ── Header ── */
  .vsl-app-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 2rem; border-bottom: 1px solid var(--vsl-border);
    background: rgba(8,10,14,0.95); backdrop-filter: blur(20px);
    position: sticky; top: 0; z-index: 50;
  }
  .vsl-logo { display: flex; align-items: center; gap: 0.75rem; }
  .vsl-logo-icon { font-size: 1.4rem; }
  .vsl-logo-text { font-size: 1.1rem; font-weight: 800; letter-spacing: 0.15em; color: var(--vsl-accent); }
  .vsl-logo-sub { font-size: 0.7rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); letter-spacing: 0.1em; margin-top: 2px; }
  .vsl-connection-status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); }
  .conn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .conn-dot.connected { background: var(--vsl-success); box-shadow: 0 0 8px var(--vsl-success); animation: vsl-pulse-dot 2s infinite; }
  .conn-dot.disconnected { background: var(--vsl-error); }

  /* ── Main ── */
  .vsl-app-main { flex: 1; padding: 2rem; max-width: 1400px; margin: 0 auto; width: 100%; }

  /* ── Upload Section ── */
  .upload-section { max-width: 680px; margin: 3rem auto; }
  .hero-title { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; line-height: 1.1; margin-bottom: 1rem; background: linear-gradient(135deg, var(--vsl-text) 0%, var(--vsl-accent) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .hero-sub { color: var(--vsl-text-dim); margin-bottom: 2.5rem; line-height: 1.6; }

  .upload-form { background: var(--vsl-surface); border: 1px solid var(--vsl-border); border-radius: 16px; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem; }
  .form-row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .input-group.full { width: 100%; }
  .vsl-app label { font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); letter-spacing: 0.05em; text-transform: uppercase; }

  .toggle-group { display: flex; border: 1px solid var(--vsl-border); border-radius: 8px; overflow: hidden; }
  .toggle-btn { padding: 0.5rem 1.25rem; background: transparent; border: none; color: var(--vsl-text-dim); font-family: 'Syne', sans-serif; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; }
  .toggle-btn.active { background: var(--vsl-accent); color: #000; font-weight: 700; }

  .num-input { background: var(--vsl-surface2); border: 1px solid var(--vsl-border); border-radius: 8px; padding: 0.5rem 0.75rem; color: var(--vsl-text); font-family: 'JetBrains Mono', monospace; width: 80px; }
  .num-input:focus { outline: none; border-color: var(--vsl-accent); }

  .script-textarea { background: var(--vsl-surface2); border: 1px solid var(--vsl-border); border-radius: 8px; padding: 1rem; color: var(--vsl-text); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; resize: vertical; width: 100%; }
  .script-textarea:focus { outline: none; border-color: var(--vsl-accent); }
  .script-textarea::placeholder { color: var(--vsl-text-dim); }

  .submit-btn { background: var(--vsl-accent); color: #000; border: none; border-radius: 8px; padding: 0.9rem 2rem; font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.75rem; }
  .submit-btn:hover:not(:disabled) { background: #f5ff70; transform: translateY(-1px); }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.3); border-top-color: #000; border-radius: 50%; animation: vsl-spin 0.8s linear infinite; display: inline-block; }

  /* ── Canvas Section ── */
  .canvas-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
  .canvas-title { font-size: 1.5rem; font-weight: 700; }
  .canvas-sub { color: var(--vsl-text-dim); font-size: 0.85rem; margin-top: 0.25rem; }
  .reset-btn { background: var(--vsl-surface2); border: 1px solid var(--vsl-border); border-radius: 8px; padding: 0.5rem 1rem; color: var(--vsl-text-dim); font-family: 'Syne', sans-serif; cursor: pointer; font-size: 0.85rem; }
  .reset-btn:hover { color: var(--vsl-text); border-color: rgba(255,255,255,0.15); }

  /* ── Progress ── */
  .progress-container { background: var(--vsl-surface); border: 1px solid var(--vsl-border); border-radius: var(--vsl-radius); padding: 1rem 1.5rem; margin-bottom: 2rem; }
  .progress-stats { display: flex; gap: 2rem; font-size: 0.8rem; color: var(--vsl-text-dim); font-family: 'JetBrains Mono', monospace; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .progress-stats strong { color: var(--vsl-text); }
  .pct-label { margin-left: auto; color: var(--vsl-accent); font-weight: 600; }
  .progress-track { height: 4px; background: var(--vsl-surface2); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--vsl-accent), var(--vsl-accent2)); border-radius: 2px; transition: width 0.6s ease; }

  /* ── Scenes Grid ── */
  .scenes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }

  /* ── Scene Card ── */
  .scene-card { background: var(--vsl-surface); border: 1px solid var(--vsl-border); border-radius: var(--vsl-radius); overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.3s; }
  .scene-card.master { border-color: var(--vsl-accent); box-shadow: 0 0 20px rgba(232,255,71,0.1); }
  .scene-card.video_ready { border-color: var(--vsl-success); }
  .scene-card.error { border-color: var(--vsl-error); }

  .scene-badge { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--vsl-border); }
  .badge { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; font-weight: 600; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .master-badge { background: var(--vsl-accent); color: #000; }
  .index-badge { background: var(--vsl-surface2); color: var(--vsl-text-dim); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.status-pending { background: var(--vsl-text-dim); }
  .status-dot.status-processing { background: var(--vsl-warn); animation: vsl-pulse-dot 1s infinite; }
  .status-dot.status-image_ready { background: var(--vsl-accent2); }
  .status-dot.status-generating_video { background: var(--vsl-warn); animation: vsl-pulse-dot 0.8s infinite; }
  .status-dot.status-video_ready { background: var(--vsl-success); }
  .status-dot.status-error { background: var(--vsl-error); }

  .scene-media { aspect-ratio: 9/16; background: var(--vsl-surface2); position: relative; overflow: hidden; }
  .media-element { width: 100%; height: 100%; object-fit: cover; display: block; }
  .image-wrapper { position: relative; width: 100%; height: 100%; }

  .generating-overlay { position: absolute; inset: 0; background: rgba(8,10,14,0.65); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; }
  .spinner-ring { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--vsl-warn); border-radius: 50%; animation: vsl-spin 1s linear infinite; }
  .spinner-label { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); text-align: center; line-height: 1.4; }

  .placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; }
  .placeholder-pulse { width: 40px; height: 40px; border-radius: 50%; background: var(--vsl-surface); animation: vsl-pulse-scale 1.5s ease-in-out infinite; }
  .placeholder-label { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); }

  .scene-prompt { padding: 0.75rem; border-top: 1px solid var(--vsl-border); }
  .scene-prompt p { font-size: 0.7rem; color: var(--vsl-text-dim); line-height: 1.4; }

  .scene-status-bar { padding: 0.4rem 0.75rem; background: var(--vsl-surface2); }
  .status-text { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--vsl-text-dim); }

  /* ── Waiting State ── */
  .waiting-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5rem 2rem; gap: 1.5rem; color: var(--vsl-text-dim); }
  .pulse-ring { width: 60px; height: 60px; border: 2px solid var(--vsl-accent); border-radius: 50%; animation: vsl-pulse-ring 1.5s ease-out infinite; }

  /* ── Done Banner ── */
  .done-banner { background: rgba(71,255,160,0.1); border: 1px solid var(--vsl-success); border-radius: var(--vsl-radius); padding: 1rem 1.5rem; margin-top: 2rem; color: var(--vsl-success); font-weight: 600; text-align: center; }

  /* ── Animations ── */
  @keyframes vsl-spin { to { transform: rotate(360deg); } }
  @keyframes vsl-pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  @keyframes vsl-pulse-scale { 0%,100% { transform: scale(1); opacity:0.5; } 50% { transform: scale(1.15); opacity:1; } }
  @keyframes vsl-pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
`;
