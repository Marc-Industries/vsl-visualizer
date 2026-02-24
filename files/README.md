# ANTIGRAVITY VSL Studio — Guida al Deploy Completo

## Architettura del Sistema

```
[Utente] 
   │  carica SRT / prompts
   ▼
[React Frontend] ──POST /start-project──▶ [Bridge Node.js]
   │                                            │
   │ WebSocket (Socket.io)                      │ POST webhook
   │ riceve aggiornamenti in RT                 ▼
   │                                      [n8n Workflow]
   │                                            │
   │                    ┌───────────────────────┤
   │                    │  Loop per ogni scena  │
   │                    │                       │
   │                    │  Scena 0 (MASTER):    │
   │                    │  Gemini genera img    │
   │                    │  → Drive → Public     │
   │                    │  → Bridge notifica    │
   │                    │                       │
   │                    │  Scena 1-N:           │
   │                    │  Scarica Master       │
   │                    │  Gemini analizza      │
   │                    │  → Kie.ai job         │
   │                    │  → Bridge notifica    │
   │                    └───────────────────────┘
   │
   │◀── socket.emit('scene_update') ─── [Bridge]
   │
   ▼
[Dashboard aggiorna in RT]
   │
   └─▶ Polling /proxy/kie-status/:jobId ogni 8s
       finché video non è pronto
```

---

## PASSO 1: Micro-Backend "The Bridge"

### Setup
```bash
cd backend/
cp .env.example .env
# Edita .env con i tuoi valori reali
npm install
npm run dev     # sviluppo
npm start       # produzione
```

### Variabili .env da configurare
| Variabile | Esempio | Descrizione |
|-----------|---------|-------------|
| `N8N_WEBHOOK_URL` | `https://app.fantasticane.com/webhook/aee2dcbc...` | URL webhook n8n |
| `BRIDGE_URL` | `https://bridge.tuodominio.com` | URL pubblico del bridge (usato da n8n) |
| `FRONTEND_URL` | `https://antigravity.tuodominio.com` | URL frontend React (CORS) |
| `KIE_API_KEY` | `sk-...` | API Key di Kie.ai |
| `PORT` | `3001` | Porta del server |

### Deploy Consigliato: Railway
1. Crea un progetto Railway
2. Collega la cartella `backend/`
3. Imposta le variabili d'ambiente nel pannello Railway
4. Il servizio ottiene un URL pubblico tipo `https://antigravity-bridge.railway.app`

---

## PASSO 2: Frontend React

### Setup
```bash
cd frontend/
cp .env.example .env   # crea VITE_BRIDGE_URL=http://localhost:3001
npm install
npm run dev
```

### Variabili d'ambiente frontend
```
VITE_BRIDGE_URL=https://bridge.tuodominio.com
```

### Struttura file da aggiungere al tuo progetto Vite/React
```
src/
  VSLCanvas.jsx     ← componente principale (già creato)
  main.jsx          ← importa e usa <VSLCanvas />
```

Nel tuo `main.jsx` o `App.jsx`:
```jsx
import VSLCanvas from './VSLCanvas';
export default function App() { return <VSLCanvas />; }
```

Installa le dipendenze:
```bash
npm install socket.io-client
```

---

## PASSO 3: n8n Workflow

### Come importare
1. Apri n8n → **Workflows** → **Import from file**
2. Seleziona `antigravity-n8n-workflow-v2.json`

### Configurazioni obbligatorie post-import

#### A) Nodo "Upload Master su Drive"
- Imposta le tue credenziali Google Drive
- Nel campo `folderId`: inserisci l'ID della cartella Drive dove salvare le immagini
  - Apri la cartella su drive.google.com → l'ID è nella URL: `drive.google.com/drive/folders/**QUESTO_È_L_ID**`

#### B) Nodi HTTP Request verso il Bridge
Cerca tutti i nodi con `callback_url` dinamico — il valore arriva già dal frontend tramite il campo `callback_url` nel body. 
**Assicurati che il frontend invii `BRIDGE_URL + '/update-scene'` come `callback_url`.**

#### C) Credenziali
| Credenziale | Dove configurarla |
|-------------|-------------------|
| Google Gemini (PaLM) API | n8n → Settings → Credentials → Google PaLM |
| Google Drive OAuth2 | n8n → Settings → Credentials → Google Drive OAuth2 |
| Kie.ai Header Auth | n8n → Settings → Credentials → Header Auth → Header: `Authorization`, Value: `Bearer TUA_KEY` |

---

## PASSO 4: Collegare tutto (URL da inserire)

### Nel Bridge (.env)
```
N8N_WEBHOOK_URL=https://app.fantasticane.com/webhook/aee2dcbc-8bb2-4498-84a3-960116efbc88
BRIDGE_URL=https://antigravity-bridge.railway.app
```

### Nel Frontend (.env)
```
VITE_BRIDGE_URL=https://antigravity-bridge.railway.app
```

### In n8n (automatico)
Il Bridge, quando riceve `/start-project` dal frontend, invia a n8n il campo `callback_url` con il proprio URL. n8n lo legge dinamicamente da `$json.body.callback_url`. **Non serve hardcodare nulla in n8n.**

---

## Flusso Dati Completo

```
1. Utente incolla SRT → click "Genera VSL"
2. Frontend → POST /start-project al Bridge
   { project_id, type: "SRT", content, callback_url: BRIDGE_URL+"/update-scene" }
3. Bridge → POST webhook n8n (con tutto il body)
4. n8n processa: Switch → Parse → AI Agent (se SRT) → Loop
5. Per ogni scena, n8n chiama POST /update-scene del Bridge con:
   - type: "scene_prompt_ready" (quando inizia)
   - type: "master_image_ready" (immagine Drive pronta)
   - type: "video_job_started" (job Kie.ai avviato)
6. Bridge aggiorna memoria volatile + socket.emit('scene_update')
7. Frontend Socket.io riceve → aggiorna UI in RT
8. Quando arriva job_id → Frontend avvia polling ogni 8s su /proxy/kie-status/:jobId
9. Quando video pronto → mostra <video autoplay loop>
```

---

## Risoluzione Problemi

| Problema | Causa probabile | Soluzione |
|----------|-----------------|-----------|
| Socket non connette | CORS errato | Verifica FRONTEND_URL nel .env del Bridge |
| n8n non riceve il webhook | URL errato | Controlla N8N_WEBHOOK_URL nel Bridge |
| Immagini Drive non accessibili | Cartella non pubblica | Verifica il nodo "Rendi Pubblico Master" |
| Polling Kie.ai sempre PENDING | API key errata | Controlla KIE_API_KEY nel Bridge |
| Scene 1-N non partono | Master Drive ID non trovato | Controlla il nodo "Salva Master Drive ID" e le connessioni |

---

## Note Importanti sulla Coerenza Visiva

Il sistema garantisce identità del personaggio così:
1. **Scena 0**: Gemini genera il Master con descrizione dettagliata del soggetto
2. **Scene 1-N**: Il Master viene scaricato e inviato a Gemini Flash che:
   - Analizza visivamente i tratti del soggetto
   - Scrive un nuovo prompt che li mantiene identici
   - Il prompt aumentato viene passato a Kie.ai con l'immagine Master come riferimento
3. **Kie.ai `REFERENCE_2_VIDEO`**: usa l'immagine come ancora visiva per il video
