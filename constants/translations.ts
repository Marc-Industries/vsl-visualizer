import { AGENT_TRAINING_SOP } from './agentTraining';

export const TRANSLATIONS = {
  en: {
    titlePrefix: "VSL",
    titleSuffix: "Visualizer",
    subtitle: "Transform SRT transcripts into timed AI images automatically.",
    sourceMaterial: "Source Material (.SRT)",
    transcriptLabel: "Paste .SRT Content",
    transcriptPlaceholder: "1\n00:00:00,000 --> 00:00:02,000\nHello world...",
    wordsDetected: "blocks detected",
    waitingInput: "Waiting for SRT input...",
    agentConfig: "First Agent Prompt Gen Customization",
    promptInterval: "Seconds per Prompt",
    intervalHelp: "System will generate one prompt every X seconds.",
    speakingPace: "Est. Speaking Pace (WPM)",
    paceHelp: "Not used for SRT (uses exact timestamps).",
    systemInstruction: "Prompt Generation Agent Training Data",
    instructionHelp: "Edit this training data to change how the agent generates prompts.",
    processing: "Processing...",
    runWorkflow: "Run Visual Pipeline",
    generatedTimeline: "Visual Workflow Output",
    promptsGenerated: "Assets Created",
    agentWorking: "Generating prompts & images...",
    copyAll: "Copy Prompts",
    copySuccess: "All prompts copied to clipboard!",
    modeSwitch: {
      srt: "From Caption (.SRT)",
      prompts: "Direct Prompts"
    },
    directPrompts: {
      title: "Direct Image Prompts",
      label: "Paste Prompts (One per line)",
      placeholder: "A cinematic shot of a futuristic city...\nA close up of a gold coin...\nA happy family eating dinner...",
      count: "prompts detected",
      waiting: "Waiting for prompt list..."
    },
    timeline: {
      source: "Context / Source",
      generated: "Image Prompt",
      waiting: "Generating...",
      regenerate: "Regenerate Prompt",
      regenerateImage: "Regenerate Image",
      regenerateVideo: "Regenerate Video",
      downloadVideo: "Download Video",
      imageLabel: "Generated Output",
      feedbackPlaceholder: "Describe what to fix (e.g. 'Make it brighter', 'Remove the cat')...",
      applyFix: "Apply Fix",
      cancel: "Cancel",
      videoLabel: "Transition Video (Next Segment)",
      generatingVideo: "Generating transition...",
      downloadClip: "Download Clip"
    },
    videoGen: {
      generateButton: "Generate Video Flow",
      description: "Create smooth transitions between all generated images (A -> B, B -> C).",
      processing: "Generating Videos...",
      missingImages: "Wait for all images to finish before generating video."
    },
    nav: {
      workflow: "Workflow",
      editor: "Video Editor",
      bridge: "Bridge Results",
      settings: "Settings",
      cleanCache: "Clean Session",
      cleanCacheConfirm: "Are you sure you want to clean the session? This will reset all segments and generate a new project ID.",
    },
    editor: {
      title: "Timeline Editor",
      noSegments: "No segments generated yet. Go to Workflow to create assets.",
      trackMain: "Main Track",
      duration: "Duration"
    },
    settings: {
      title: "System Settings",
      driveSection: "Google Drive Integration",
      driveConnect: "Connect Google Drive",
      driveDesc: "Link a folder to auto-save generated assets.",
      videoProvider: "Video Generation Provider",
      providerDesc: "Select the engine for video transitions.",
      save: "Save Settings",
      kieTokenLabel: "Kie.ai API Token",
      kieTokenPlaceholder: "Paste your Kie.ai Bearer token here...",
      webhookSection: "Webhook Configuration",
      webhookDesc: "Configure the webhook URL to send data to your backend.",
      webhookLabel: "Webhook URL",
      webhookPlaceholder: "https://your-webhook-url.com/endpoint"
    },
    defaultInstruction: `Role: You are an Elite VSL Art Director trained on the "Nano Banana" visual system.
Goal: Convert script segments into high-converting, vertical (9:16) image prompts for video generation.

TRAINING SOP (Follow Strictly):
${AGENT_TRAINING_SOP}

Your task is to take the provided script segment and generate a single Nano Banana prompt that fits the time constraints.`
  },
  it: {
    titlePrefix: "Visualizzatore",
    titleSuffix: "VSL",
    subtitle: "Trasforma i sottotitoli SRT in immagini AI temporizzate automaticamente.",
    sourceMaterial: "Materiale Sorgente (.SRT)",
    transcriptLabel: "Incolla Contenuto .SRT",
    transcriptPlaceholder: "1\n00:00:00,000 --> 00:00:02,000\nCiao mondo...",
    wordsDetected: "blocchi rilevati",
    waitingInput: "In attesa di input SRT...",
    agentConfig: "personalizzazione primo agente generazione promt foto",
    promptInterval: "Secondi per Prompt",
    intervalHelp: "Il sistema genererà un prompt ogni X secondi di video.",
    speakingPace: "Velocità Parlato (WPM)",
    paceHelp: "Non usato per SRT (usa timestamp esatti).",
    systemInstruction: "File di Formazione Agente (SOP)",
    instructionHelp: "Modifica questo file di formazione per cambiare il comportamento dell'agente.",
    processing: "Elaborazione...",
    runWorkflow: "Avvia Pipeline Visiva",
    generatedTimeline: "Output Workflow Visivo",
    promptsGenerated: "Asset Creati",
    agentWorking: "Generazione prompt e immagini...",
    copyAll: "Copia Prompt",
    copySuccess: "Tutti i prompt copiati negli appunti!",
    modeSwitch: {
      srt: "Da Sottotitoli (.SRT)",
      prompts: "Da Prompt Diretti"
    },
    directPrompts: {
      title: "Prompt Immagini Diretti",
      label: "Incolla Prompt (Uno per riga)",
      placeholder: "Una ripresa cinematografica di una città futuristica...\nUn primo piano di una moneta d'oro...\nUna famiglia felice che cena...",
      count: "prompt rilevati",
      waiting: "In attesa della lista prompt..."
    },
    timeline: {
      source: "Contesto / Sorgente",
      generated: "Prompt Immagine",
      waiting: "Generazione in corso...",
      regenerate: "Rigenera Prompt",
      regenerateImage: "Rigenera Immagine",
      regenerateVideo: "Rigenera Video",
      downloadVideo: "Scarica Video",
      imageLabel: "Output Generato",
      feedbackPlaceholder: "Descrivi cosa correggere (es. 'Rendilo più luminoso', 'Rimuovi il gatto')...",
      applyFix: "Applica Correzione",
      cancel: "Annulla",
      videoLabel: "Video Transizione (Verso Succ.)",
      generatingVideo: "Generazione transizione...",
      downloadClip: "Scarica Clip"
    },
    videoGen: {
      generateButton: "Genera Flusso Video",
      description: "Crea transizioni fluide tra tutte le immagini generate (A -> B, B -> C).",
      processing: "Generazione Video...",
      missingImages: "Attendi che tutte le immagini siano finite prima di generare il video."
    },
    nav: {
      workflow: "Workflow",
      editor: "Editor Video",
      bridge: "Risultati Bridge",
      settings: "Impostazioni",
      cleanCache: "Pulisci Sessione",
      cleanCacheConfirm: "Sei sicuro di voler pulire la sessione? Questo resetterà tutti i segmenti e genererà un nuovo ID progetto.",
    },
    editor: {
      title: "Timeline Editor (Stile CapCut)",
      noSegments: "Nessun segmento generato. Vai su Workflow per creare gli asset.",
      trackMain: "Traccia Principale",
      duration: "Durata"
    },
    settings: {
      title: "Impostazioni Sistema",
      driveSection: "Integrazione Google Drive",
      driveConnect: "Connetti Cartella Drive",
      driveDesc: "Collega una cartella per il salvataggio automatico degli asset.",
      videoProvider: "Provider Generazione Video",
      providerDesc: "Seleziona il motore per le transizioni video (es. Kling, Veo).",
      save: "Salva Impostazioni",
      kieTokenLabel: "Token API Kie.ai",
      kieTokenPlaceholder: "Incolla il tuo token Kie.ai qui...",
      webhookSection: "Configurazione Webhook",
      webhookDesc: "Configura l'URL del webhook per inviare dati al tuo backend.",
      webhookLabel: "URL Webhook",
      webhookPlaceholder: "https://il-tuo-webhook.com/endpoint"
    },
    defaultInstruction: `Role: Sei un Elite VSL Art Director specializzato nel sistema visivo "Nano Banana".
Goal: Converti i segmenti di script in prompt per immagini verticali (9:16) ad alta conversione.

SOP DI FORMAZIONE (Da seguire rigorosamente):
${AGENT_TRAINING_SOP}

Il tuo compito è prendere il segmento di script fornito e generare un singolo prompt Nano Banana che rispetti i vincoli temporali.`
  }
};
