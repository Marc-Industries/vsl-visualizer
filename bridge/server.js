/**
 * ANTIGRAVITY - THE BRIDGE
 * Micro-backend: Express + Socket.io
 * Riceve webhook da n8n e li spinge al frontend React in tempo reale.
 * Stato volatile in-memory: nessun DB necessario.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────
// HEALTH CHECK — per Render/Railway
// ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─────────────────────────────────────────────
// STATO VOLATILE IN-MEMORY
// Struttura: { [project_id]: { scenes: [...], createdAt, totalScenes } }
// ─────────────────────────────────────────────
const projects = {};

function getOrCreateProject(projectId, totalScenes = 0) {
  if (!projects[projectId]) {
    projects[projectId] = {
      projectId,
      totalScenes,
      scenes: [],
      createdAt: Date.now(),
    };
  }
  return projects[projectId];
}

function upsertScene(projectId, sceneIndex, data) {
  const project = getOrCreateProject(projectId);
  const existing = project.scenes.find(s => s.sceneIndex === sceneIndex);
  if (existing) {
    Object.assign(existing, data, { updatedAt: Date.now() });
    return existing;
  } else {
    const scene = { sceneIndex, status: 'pending', ...data, updatedAt: Date.now() };
    project.scenes.push(scene);
    project.scenes.sort((a, b) => a.sceneIndex - b.sceneIndex);
    return scene;
  }
}

// ─────────────────────────────────────────────
// ENDPOINT WEBHOOK — chiamato da n8n
// ─────────────────────────────────────────────

/**
 * POST /update-scene
 * Body da n8n:
 *   - type: "master_image_ready" | "video_job_started" | "scene_prompt_ready"
 *   - project_id: string
 *   - scene_index: number
 *   - image_url?: string       (quando l'immagine master è pronta su Drive)
 *   - job_id?: string          (quando Kie.ai ha accettato il job)
 *   - prompt?: string          (testo del prompt della scena)
 *   - total_scenes?: number
 */
app.post('/update-scene', (req, res) => {
  const {
    type,
    project_id, projectId,
    scene_index, sceneIndex,
    image_url, imageUrl,
    video_url, videoUrl,
    job_id, jobId,
    prompt,
    total_scenes, totalScenes
  } = req.body;

  const pId = project_id || projectId;
  const sIdx = scene_index !== undefined ? scene_index : sceneIndex;
  const imgUrl = image_url || imageUrl;
  const vidUrl = video_url || videoUrl;
  const jId = job_id || jobId;
  const tScenes = total_scenes || totalScenes;

  if (!pId) {
    return res.status(400).json({ error: 'project_id è obbligatorio' });
  }

  // Se è un segnale di completamento globale
  if (type === 'project_completed') {
    io.to(`project:${pId}`).emit('project_completed', { projectId: pId });
    console.log(`[Bridge] PROJECT COMPLETED | project=${pId}`);
    return res.json({ ok: true, status: 'completed' });
  }

  if (sIdx === undefined) {
    return res.status(400).json({ error: 'scene_index è obbligatorio per gli aggiornamenti di scena' });
  }

  const project = getOrCreateProject(pId, tScenes || 0);
  if (tScenes) project.totalScenes = tScenes;

  let sceneUpdate = { prompt };
  if (imgUrl) sceneUpdate.imageUrl = imgUrl;
  if (vidUrl) sceneUpdate.videoUrl = vidUrl;
  if (jId) sceneUpdate.jobId = jId;

  if (type === 'master_image_ready' || type === 'image_ready') {
    sceneUpdate = { ...sceneUpdate, status: 'image_ready', isMaster: sIdx === 0 };
  } else if (type === 'video_job_started' || type === 'generating_video') {
    sceneUpdate = { ...sceneUpdate, status: 'generating_video' };
  } else if (type === 'scene_prompt_ready' || type === 'processing') {
    sceneUpdate = { ...sceneUpdate, status: 'processing' };
  } else if (type === 'video_ready' || vidUrl) {
    sceneUpdate = { ...sceneUpdate, status: 'completed' };
  }

  const scene = upsertScene(pId, sIdx, sceneUpdate);

  // Emetti a tutti i client che "guardano" questo progetto
  io.to(`project:${pId}`).emit('scene_update', {
    projectId: pId,
    scene,
    totalScenes: project.totalScenes,
  });

  console.log(`[Bridge] ${type || 'update'} | project=${pId} | scene=${sIdx} | video=${!!vidUrl}`);
  res.json({ ok: true, scene });
});

/**
 * GET /project/:id
 * Restituisce lo stato attuale del progetto (per il reload della pagina).
 */
app.get('/project/:id', (req, res) => {
  const project = projects[req.params.id];
  if (!project) return res.status(404).json({ error: 'Progetto non trovato' });
  res.json(project);
});

/**
 * POST /start-project
 * Chiamato dal frontend quando l'utente fa submit dello script.
 * Invia il webhook a n8n e registra il progetto in memoria.
 */
app.post('/start-project', async (req, res) => {
  const { project_id, type, content, sampling_sec, user_agent_prompt, n8n_webhook_url } = req.body;

  // Priorità: URL inviato dal frontend (Impostazioni > URL Webhook) → fallback .env
  const N8N_WEBHOOK_URL = n8n_webhook_url || process.env.N8N_WEBHOOK_URL;

  if (!N8N_WEBHOOK_URL) {
    return res.status(500).json({ error: 'URL Webhook non configurato. Impostalo in Impostazioni > URL Webhook oppure nel file .env del Bridge.' });
  }

  try {
    getOrCreateProject(project_id);

    const payload = {
      type: type || 'SRT',
      content,
      project_id,
      sampling_sec: sampling_sec || 5,
      user_agent_prompt: user_agent_prompt || '',
      callback_url: `${process.env.BRIDGE_URL || 'http://localhost:3001'}/update-scene`,
    };

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: payload }),
    });

    if (!response.ok) {
      throw new Error(`n8n ha risposto con status ${response.status}`);
    }

    res.json({ ok: true, project_id });
  } catch (err) {
    console.error('[Bridge] Errore invio a n8n:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SOCKET.IO — gestione connessioni
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connesso: ${socket.id}`);

  // Il client invia il project_id per "abbonarsi" agli aggiornamenti
  socket.on('join_project', (projectId) => {
    socket.join(`project:${projectId}`);
    console.log(`[Socket] ${socket.id} unito a project:${projectId}`);

    // Invia subito lo stato corrente (utile al reload)
    const project = projects[projectId];
    if (project) {
      socket.emit('project_state', project);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnesso: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────
// PROXY Kie.ai — evita problemi CORS dal frontend
// ─────────────────────────────────────────────
app.get('/proxy/kie-status/:jobId', async (req, res) => {
  const KIE_API_KEY = process.env.KIE_API_KEY;
  if (!KIE_API_KEY) return res.status(500).json({ error: 'KIE_API_KEY non configurata' });

  try {
    const response = await fetch(`https://api.kie.ai/api/v1/veo/record-info?taskId=${req.params.jobId}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    const data = await response.json();

    // Kie.ai response structure handling (from logs):
    // data.data.response.resultUrls[0] contains the mp4 link
    // data.data.successFlag === 1 indicates completion

    const kData = data.data || data;
    const resultUrls = kData.response?.resultUrls || kData.resultUrls || [];
    const videoUrl = resultUrls[0] || kData.videoUrl || kData.video_url || null;

    let status = kData.status?.toUpperCase() || 'PENDING';
    if (kData.successFlag === 1) status = 'COMPLETED';
    if (videoUrl && status === 'PENDING') status = 'COMPLETED';

    res.json({ status, video_url: videoUrl, raw: data });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PROXY Immagini Drive — bypassa il 403 Forbidden (Hotlinking)
// ─────────────────────────────────────────────
app.get('/proxy/image-drive', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL mancante' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Drive ha risposto con status ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    // Pipe del body della risposta
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('[Bridge] Errore proxy immagine:', err.message);
    res.status(502).json({ error: 'Errore nel recupero dell\'immagine da Drive' });
  }
});

// ─────────────────────────────────────────────
// PULIZIA memoria dopo 4 ore (progetto inattivo)
// ─────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const TTL = 4 * 60 * 60 * 1000;
  for (const [id, project] of Object.entries(projects)) {
    if (now - project.createdAt > TTL) {
      delete projects[id];
      console.log(`[Bridge] Progetto ${id} rimosso dalla memoria (TTL scaduto)`);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  const bridgeUrl = process.env.BRIDGE_URL || `http://localhost:${PORT}`;
  console.log(`\n🚀 Antigravity Bridge in ascolto su ${bridgeUrl}`);
  console.log(`   Frontend URL atteso: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`   n8n Webhook URL: ${process.env.N8N_WEBHOOK_URL || '⚠️  NON CONFIGURATO'}\n`);
});
