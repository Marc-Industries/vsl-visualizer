import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || "http://localhost:3001";
const KIE_AI_BASE = "https://api.kie.ai/api/v1";

// ─── Polling Kie.ai per stato video ───────────────────────────────────────────
function useVideoPolling(scenes, setScenes) {
  const pollingRefs = useRef({});

  const pollJobStatus = useCallback(async (jobId, sceneIndex) => {
    if (pollingRefs.current[jobId]) return; // già in polling

    pollingRefs.current[jobId] = true;

    const check = async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/proxy/kie-status/${jobId}`);
        const data = await res.json();

        if (data.status === "SUCCESS" && data.video_url) {
          setScenes(prev =>
            prev.map(s =>
              s.sceneIndex === sceneIndex
                ? { ...s, status: "video_ready", videoUrl: data.video_url }
                : s
            )
          );
          delete pollingRefs.current[jobId];
        } else if (data.status === "FAILED") {
          setScenes(prev =>
            prev.map(s =>
              s.sceneIndex === sceneIndex ? { ...s, status: "error" } : s
            )
          );
          delete pollingRefs.current[jobId];
        } else {
          // Ancora in lavorazione, riprova tra 8 secondi
          setTimeout(check, 8000);
        }
      } catch {
        setTimeout(check, 12000);
      }
    };

    setTimeout(check, 5000);
  }, [setScenes]);

  useEffect(() => {
    scenes.forEach(scene => {
      if (scene.status === "generating_video" && scene.jobId) {
        pollJobStatus(scene.jobId, scene.sceneIndex);
      }
    });
  }, [scenes, pollJobStatus]);
}

// ─── Card singola scena ───────────────────────────────────────────────────────
function SceneCard({ scene, index }) {
  const { status, imageUrl, videoUrl, prompt, isMaster, sceneIndex } = scene;
  const isReady = status === "video_ready";
  const isGenerating = status === "generating_video";
  const hasImage = status === "image_ready" || isGenerating || isReady;

  return (
    <div className={`scene-card ${status} ${isMaster ? "master" : ""}`}>
      <div className="scene-badge">
        {isMaster ? (
          <span className="badge master-badge">★ MASTER</span>
        ) : (
          <span className="badge index-badge">S{String(sceneIndex).padStart(2, "0")}</span>
        )}
        <span className={`status-dot status-${status}`} />
      </div>

      <div className="scene-media">
        {/* VIDEO pronto */}
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

        {/* IMMAGINE con overlay spinner se sta generando video */}
        {hasImage && !isReady && imageUrl && (
          <div className="image-wrapper">
            <img src={imageUrl} alt={`Scene ${sceneIndex}`} className="media-element" />
            {isGenerating && (
              <div className="generating-overlay">
                <div className="spinner-ring" />
                <p className="spinner-label">Generazione<br />Video…</p>
              </div>
            )}
          </div>
        )}

        {/* PLACEHOLDER se ancora in attesa */}
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
function UploadForm({ onSubmit, isLoading }) {
  const [type, setType] = useState("SRT");
  const [content, setContent] = useState("");
  const [samplingInterval, setSamplingInterval] = useState(5);

  const handleSubmit = (e) => {
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
            {["SRT", "PROMPTS"].map(t => (
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
            onChange={e => setSamplingInterval(Number(e.target.value))}
            className="num-input"
          />
        </div>
      </div>

      <div className="input-group full">
        <label>{type === "SRT" ? "Contenuto SRT" : "Prompt (uno per riga)"}</label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={
            type === "SRT"
              ? "1\n00:00:00,000 --> 00:00:05,000\nCiao mondo!"
              : "Scena 1: uomo che cammina in città\nScena 2: barista che prepara caffè"
          }
          className="script-textarea"
          rows={8}
        />
      </div>

      <button type="submit" className="submit-btn" disabled={isLoading || !content.trim()}>
        {isLoading ? (
          <><span className="btn-spinner" /> Avvio elaborazione…</>
        ) : (
          <>⚡ Genera VSL</>
        )}
      </button>
    </form>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ scenes, totalScenes }) {
  const completed = scenes.filter(s => s.status === "video_ready").length;
  const withImage = scenes.filter(s => ["image_ready", "generating_video", "video_ready"].includes(s.status)).length;
  const pct = totalScenes > 0 ? Math.round((completed / totalScenes) * 100) : 0;

  return (
    <div className="progress-container">
      <div className="progress-stats">
        <span>Scene totali: <strong>{totalScenes || "—"}</strong></span>
        <span>Immagini: <strong>{withImage}</strong></span>
        <span>Video pronti: <strong>{completed}</strong></span>
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
  const [projectId] = useState(() => `proj_${Date.now()}`);
  const [scenes, setScenes] = useState([]);
  const [totalScenes, setTotalScenes] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | uploading | processing | done
  const socketRef = useRef(null);

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

    // Stato iniziale (utile al reload)
    socket.on("project_state", (project) => {
      setScenes(project.scenes || []);
      setTotalScenes(project.totalScenes || 0);
    });

    // Aggiornamento singola scena
    socket.on("scene_update", ({ scene, totalScenes: ts }) => {
      if (ts) setTotalScenes(ts);
      setScenes(prev => {
        const exists = prev.find(s => s.sceneIndex === scene.sceneIndex);
        if (exists) {
          return prev.map(s => s.sceneIndex === scene.sceneIndex ? { ...s, ...scene } : s);
        }
        return [...prev, scene].sort((a, b) => a.sceneIndex - b.sceneIndex);
      });
      setPhase("processing");
      setIsLoading(false);
    });

    return () => socket.disconnect();
  }, [projectId]);

  // ── Avvio progetto ──────────────────────────────────────────────────────────
  const handleSubmit = async ({ type, content, sampling_sec }) => {
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
      alert("Errore avvio progetto: " + err.message);
    }
  };

  const allDone = totalScenes > 0 && scenes.filter(s => s.status === "video_ready").length === totalScenes;

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        {/* HEADER */}
        <header className="app-header">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">ANTIGRAVITY</span>
            <span className="logo-sub">VSL Studio</span>
          </div>
          <div className="connection-status">
            <span className={`conn-dot ${isConnected ? "connected" : "disconnected"}`} />
            <span>{isConnected ? "Bridge connesso" : "Disconnesso"}</span>
          </div>
        </header>

        <main className="app-main">
          {/* FORM */}
          {phase === "idle" && (
            <section className="upload-section">
              <h1 className="hero-title">
                Trasforma lo script<br />in un video professionale
              </h1>
              <p className="hero-sub">
                Carica il tuo SRT o una lista di prompt. Ogni scena verrà generata in tempo reale.
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
                    {phase === "uploading" ? "Avvio generazione…" : "Generazione in corso"}
                  </h2>
                  <p className="canvas-sub">
                    {phase === "uploading"
                      ? "n8n sta analizzando lo script"
                      : "Le scene appaiono man mano che vengono completate"}
                  </p>
                </div>
                <button className="reset-btn" onClick={() => { setPhase("idle"); setScenes([]); }}>
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
                  {scenes.map(scene => (
                    <SceneCard key={scene.sceneIndex} scene={scene} index={scene.sceneIndex} />
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

// ─── STYLES ────────────────────────────────────────────────────────────────────
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #080a0e;
    --surface: #0e1117;
    --surface2: #161b24;
    --border: rgba(255,255,255,0.07);
    --accent: #e8ff47;
    --accent2: #47c5ff;
    --text: #f0f4ff;
    --text-dim: rgba(240,244,255,0.45);
    --success: #47ffa0;
    --warn: #ffa747;
    --error: #ff4747;
    --radius: 12px;
  }

  body { background: var(--bg); color: var(--text); font-family: 'Syne', sans-serif; min-height: 100vh; }

  .app { min-height: 100vh; display: flex; flex-direction: column; }

  /* ── Header ── */
  .app-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 2rem; border-bottom: 1px solid var(--border);
    background: rgba(8,10,14,0.95); backdrop-filter: blur(20px);
    position: sticky; top: 0; z-index: 100;
  }
  .logo { display: flex; align-items: center; gap: 0.75rem; }
  .logo-icon { font-size: 1.4rem; }
  .logo-text { font-size: 1.1rem; font-weight: 800; letter-spacing: 0.15em; color: var(--accent); }
  .logo-sub { font-size: 0.7rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); letter-spacing: 0.1em; margin-top: 2px; }
  .connection-status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); }
  .conn-dot { width: 8px; height: 8px; border-radius: 50%; }
  .conn-dot.connected { background: var(--success); box-shadow: 0 0 8px var(--success); animation: pulse-dot 2s infinite; }
  .conn-dot.disconnected { background: var(--error); }

  /* ── Main ── */
  .app-main { flex: 1; padding: 2rem; max-width: 1400px; margin: 0 auto; width: 100%; }

  /* ── Upload Section ── */
  .upload-section { max-width: 680px; margin: 4rem auto; }
  .hero-title { font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; line-height: 1.1; margin-bottom: 1rem; }
  .hero-title { background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .hero-sub { color: var(--text-dim); margin-bottom: 2.5rem; line-height: 1.6; }

  .upload-form { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem; }
  .form-row { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .input-group.full { width: 100%; }
  label { font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); letter-spacing: 0.05em; text-transform: uppercase; }

  .toggle-group { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .toggle-btn { padding: 0.5rem 1.25rem; background: transparent; border: none; color: var(--text-dim); font-family: 'Syne', sans-serif; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; }
  .toggle-btn.active { background: var(--accent); color: #000; font-weight: 700; }

  .num-input { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.75rem; color: var(--text); font-family: 'JetBrains Mono', monospace; width: 80px; }
  .num-input:focus { outline: none; border-color: var(--accent); }

  .script-textarea { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; resize: vertical; width: 100%; }
  .script-textarea:focus { outline: none; border-color: var(--accent); }
  .script-textarea::placeholder { color: var(--text-dim); }

  .submit-btn { background: var(--accent); color: #000; border: none; border-radius: 8px; padding: 0.9rem 2rem; font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.75rem; }
  .submit-btn:hover:not(:disabled) { background: #f5ff70; transform: translateY(-1px); }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(0,0,0,0.3); border-top-color: #000; border-radius: 50%; animation: spin 0.8s linear infinite; }

  /* ── Canvas Section ── */
  .canvas-section { }
  .canvas-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
  .canvas-title { font-size: 1.5rem; font-weight: 700; }
  .canvas-sub { color: var(--text-dim); font-size: 0.85rem; margin-top: 0.25rem; }
  .reset-btn { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 1rem; color: var(--text-dim); font-family: 'Syne', sans-serif; cursor: pointer; font-size: 0.85rem; }
  .reset-btn:hover { color: var(--text); border-color: rgba(255,255,255,0.15); }

  /* ── Progress ── */
  .progress-container { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem 1.5rem; margin-bottom: 2rem; }
  .progress-stats { display: flex; gap: 2rem; font-size: 0.8rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .progress-stats strong { color: var(--text); }
  .pct-label { margin-left: auto; color: var(--accent); font-weight: 600; }
  .progress-track { height: 4px; background: var(--surface2); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 2px; transition: width 0.6s ease; }

  /* ── Scenes Grid ── */
  .scenes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }

  /* ── Scene Card ── */
  .scene-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.3s; }
  .scene-card.master { border-color: var(--accent); box-shadow: 0 0 20px rgba(232,255,71,0.1); }
  .scene-card.video_ready { border-color: var(--success); }
  .scene-card.error { border-color: var(--error); }

  .scene-badge { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  .badge { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; font-weight: 600; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .master-badge { background: var(--accent); color: #000; }
  .index-badge { background: var(--surface2); color: var(--text-dim); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .status-dot.status-pending { background: var(--text-dim); }
  .status-dot.status-processing { background: var(--warn); animation: pulse-dot 1s infinite; }
  .status-dot.status-image_ready { background: var(--accent2); }
  .status-dot.status-generating_video { background: var(--warn); animation: pulse-dot 0.8s infinite; }
  .status-dot.status-video_ready { background: var(--success); }
  .status-dot.status-error { background: var(--error); }

  .scene-media { aspect-ratio: 9/16; background: var(--surface2); position: relative; overflow: hidden; }
  .media-element { width: 100%; height: 100%; object-fit: cover; display: block; }
  .image-wrapper { position: relative; width: 100%; height: 100%; }

  .generating-overlay { position: absolute; inset: 0; background: rgba(8,10,14,0.65); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; }
  .spinner-ring { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--warn); border-radius: 50%; animation: spin 1s linear infinite; }
  .spinner-label { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); text-align: center; line-height: 1.4; }

  .placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; }
  .placeholder-pulse { width: 40px; height: 40px; border-radius: 50%; background: var(--surface); animation: pulse-scale 1.5s ease-in-out infinite; }
  .placeholder-label { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); }

  .scene-prompt { padding: 0.75rem; border-top: 1px solid var(--border); }
  .scene-prompt p { font-size: 0.7rem; color: var(--text-dim); line-height: 1.4; }

  .scene-status-bar { padding: 0.4rem 0.75rem; background: var(--surface2); }
  .status-text { font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; color: var(--text-dim); }

  /* ── Waiting State ── */
  .waiting-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5rem 2rem; gap: 1.5rem; color: var(--text-dim); }
  .pulse-ring { width: 60px; height: 60px; border: 2px solid var(--accent); border-radius: 50%; animation: pulse-ring 1.5s ease-out infinite; }

  /* ── Done Banner ── */
  .done-banner { background: rgba(71,255,160,0.1); border: 1px solid var(--success); border-radius: var(--radius); padding: 1rem 1.5rem; margin-top: 2rem; color: var(--success); font-weight: 600; text-align: center; }

  /* ── Animations ── */
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse-dot { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
  @keyframes pulse-scale { 0%,100% { transform: scale(1); opacity:0.5; } 50% { transform: scale(1.15); opacity:1; } }
  @keyframes pulse-ring { 0% { transform: scale(0.8); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
`;
