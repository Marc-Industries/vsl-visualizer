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
  const { type, project_id, scene_index, image_url, video_url, job_id, prompt, total_scenes } = req.body;

  if (!project_id) {
    return res.status(400).json({ error: 'project_id è obbligatorio' });
  }

  // Se è un segnale di completamento globale
  if (type === 'project_completed') {
    io.to(`project:${project_id}`).emit('project_completed', { projectId: project_id });
    console.log(`[Bridge] PROJECT COMPLETED | project=${project_id}`);
    return res.json({ ok: true, status: 'completed' });
  }

  if (scene_index === undefined) {
    return res.status(400).json({ error: 'scene_index è obbligatorio per gli aggiornamenti di scena' });
  }

  const project = getOrCreateProject(project_id, total_scenes || 0);
  if (total_scenes) project.totalScenes = total_scenes;

  let sceneUpdate = { prompt };
  if (image_url) sceneUpdate.imageUrl = image_url;
  if (video_url) sceneUpdate.videoUrl = video_url;
  if (job_id) sceneUpdate.jobId = job_id;

  if (type === 'master_image_ready') {
    sceneUpdate = { ...sceneUpdate, status: 'image_ready', isMaster: scene_index === 0 };
  } else if (type === 'video_job_started') {
    sceneUpdate = { ...sceneUpdate, status: 'generating_video' };
  } else if (type === 'scene_prompt_ready') {
    sceneUpdate = { ...sceneUpdate, status: 'processing' };
  } else if (type === 'video_ready' || video_url) {
    sceneUpdate = { ...sceneUpdate, status: 'completed' };
  }

  const scene = upsertScene(project_id, scene_index, sceneUpdate);

  // Emetti a tutti i client che "guardano" questo progetto
  io.to(`project:${project_id}`).emit('scene_update', {
    projectId: project_id,
    scene,
    totalScenes: project.totalScenes,
  });

  console.log(`[Bridge] ${type || 'update'} | project=${project_id} | scene=${scene_index} | video=${!!video_url}`);
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

    // Normalizza la risposta Kie.ai al formato che il frontend si aspetta
    const status = data.data?.status || data.status || 'PENDING';
    const videoUrl = data.data?.videoUrl || data.video_url || null;

    res.json({ status, video_url: videoUrl, raw: data });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
