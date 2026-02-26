import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Play,
    Settings,
    FileText,
    Database,
    Copy,
    Wand2,
    Clock,
    ListVideo,
    ImagePlus,
    Clapperboard,
    Loader2,
    HardDrive,
    Key,
    Wifi,
    WifiOff
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { FlowCanvas } from './components/FlowCanvas';
import { Node } from './components/Node';
import { TimelineCard } from './components/TimelineCard';
import { Sidebar } from './components/Sidebar';
import { VideoEditor } from './components/VideoEditor';
import {
    generatePromptForSegment,
    generateImageFromPrompt,
    editImageWithFeedback,
    generateStyleBible
} from './services/geminiService';
import {
    sendToWebhook,
    buildSRTPayload,
    buildDirectPromptsPayload
} from './services/webhookService';
import { TRANSLATIONS } from './constants/translations';
import { parseSRT, chunkSrtEntries } from './utils/srtParser';
import { generateUUID } from './utils/uuid';
import {
    TimelineSegment,
    AgentConfig,
    FlowStatus,
    Language,
    InputMode,
    ActiveTab
} from './types';

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:3001';

function App() {
    // State
    const [lang, setLang] = useState<Language>('it');
    const [inputMode, setInputMode] = useState<InputMode>('SRT');
    const [activeTab, setActiveTab] = useState<ActiveTab>('workflow');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Input States
    const [srtInput, setSrtInput] = useState<string>('');
    const [promptInput, setPromptInput] = useState<string>('');

    const [status, setStatus] = useState<FlowStatus>(FlowStatus.IDLE);
    const [segments, setSegments] = useState<TimelineSegment[]>([]);

    const [config, setConfig] = useState<AgentConfig>({
        intervalSeconds: 2.0,
        systemInstruction: TRANSLATIONS['it'].defaultInstruction,
        kieApiKey: ''
    });

    // Bridge / Socket.io state
    const [isBridgeConnected, setIsBridgeConnected] = useState(false);
    const [projectId] = useState<string>(() => {
        const saved = localStorage.getItem('vsl_project_id');
        if (saved) return saved;
        const newId = `proj_${Date.now()}`;
        localStorage.setItem('vsl_project_id', newId);
        return newId;
    });
    const socketRef = useRef<Socket | null>(null);
    const segmentsRef = useRef<TimelineSegment[]>(segments);

    // Sincronizziamo il ref ogni volta che cambiano i segmenti
    useEffect(() => {
        segmentsRef.current = segments;
    }, [segments]);

    const t = TRANSLATIONS[lang];
    const resultsRef = useRef<HTMLDivElement>(null);

    // --- Bridge Socket.io Connection ---
    useEffect(() => {
        const socket = io(BRIDGE_URL, {
            transports: ['websocket'],
            reconnectionAttempts: 5,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            setIsBridgeConnected(true);
            socket.emit('join_project', projectId);
        });
        socket.on('disconnect', () => setIsBridgeConnected(false));

        // RECUPERO STATO INIZIALE (per reload o join tardivo)
        socket.on('project_state', (project: { projectId: string; totalScenes: number; scenes: any[] }) => {
            console.log('[Bridge] Project state received:', project);
            if (project.scenes && project.scenes.length > 0) {
                const recoveredSegments: TimelineSegment[] = project.scenes.map(scene => ({
                    id: generateUUID(),
                    startTime: scene.sceneIndex * config.intervalSeconds,
                    endTime: (scene.sceneIndex + 1) * config.intervalSeconds,
                    originalText: `Scena ${scene.sceneIndex}`,
                    generatedPrompt: scene.prompt || '',
                    imageUrl: scene.imageUrl || '',
                    videoUrl: scene.videoUrl || '',
                    jobId: scene.jobId || '',
                    isProcessingPrompt: false,
                    isProcessingImage: scene.status === 'processing' || scene.status === 'scene_prompt_ready',
                    isProcessingVideo: scene.status === 'generating_video' || (!!scene.jobId && !scene.videoUrl),
                }));
                setSegments(recoveredSegments);
            }
        });

        // Riceve aggiornamenti in tempo reale da n8n tramite il Bridge
        socket.on('scene_update', ({ scene, totalScenes }: { scene: { sceneIndex: number; status: string; imageUrl?: string; videoUrl?: string; prompt?: string; jobId?: string; }, totalScenes?: number }) => {
            setSegments(prev => {
                let current = [...prev];
                const targetIndex = scene.sceneIndex;
                const requiredCount = totalScenes || (targetIndex + 1);

                // Espandi l'array se necessario
                if (current.length < requiredCount) {
                    const extra = Array.from({ length: requiredCount - current.length }).map((_, i) => ({
                        id: generateUUID(),
                        startTime: (current.length + i) * config.intervalSeconds,
                        endTime: (current.length + i + 1) * config.intervalSeconds,
                        originalText: `Scena ${current.length + i}`,
                        generatedPrompt: '',
                        isProcessingPrompt: false,
                        isProcessingImage: false,
                        isProcessingVideo: false,
                    }));
                    current = [...current, ...extra];
                }

                return current.map((seg, index) => {
                    if (index !== targetIndex) return seg;
                    return {
                        ...seg,
                        generatedPrompt: scene.prompt || seg.generatedPrompt,
                        imageUrl: scene.imageUrl || seg.imageUrl,
                        videoUrl: scene.videoUrl || seg.videoUrl,
                        jobId: scene.jobId || seg.jobId,
                        isProcessingPrompt: scene.status === 'processing',
                        isProcessingImage: scene.status === 'processing' || scene.status === 'scene_prompt_ready',
                        isProcessingVideo: scene.status === 'generating_video',
                        error: scene.status === 'error' ? 'Errore dal Bridge' : seg.error,
                    };
                });
            });
        });

        // Riceve il segnale di completamento globale
        socket.on('project_completed', () => {
            console.log('[Bridge] Project Completed received');
            setStatus(FlowStatus.COMPLETED);
        });

        return () => { socket.disconnect(); };
    }, [projectId, config.intervalSeconds]);

    // --- Video Polling Logic (Bridge Proxy) ---
    useEffect(() => {
        const checkVideoStatus = async () => {
            // Usiamo il valore corrente dei segmenti tramite una callback o un ref per evitare loop di dependency
            setSegments(prev => {
                const pendingVideos = prev.filter(s => s.jobId && !s.videoUrl && s.isProcessingVideo !== false);
                if (pendingVideos.length === 0) return prev;

                // Non possiamo fare fetch dentro setSegments, quindi facciamo il polling fuori e aggiorniamo dopo
                return prev;
            });

            const pending = segmentsRef.current.filter(s => s.jobId && !s.videoUrl);
            if (pending.length === 0) return;

            for (const seg of pending) {
                try {
                    const res = await fetch(`${BRIDGE_URL}/proxy/kie-status/${seg.jobId}`);
                    if (!res.ok) continue;

                    const data = await res.json();
                    const status = data.status?.toUpperCase();

                    if ((status === 'COMPLETED' || status === 'SUCCESS') && data.video_url) {
                        setSegments(prev => prev.map(s =>
                            s.id === seg.id ? { ...s, videoUrl: data.video_url, isProcessingVideo: false } : s
                        ));
                    } else if (status === 'FAILED' || status === 'ERROR') {
                        setSegments(prev => prev.map(s =>
                            s.id === seg.id ? { ...s, isProcessingVideo: false, error: 'Kie.ai failed' } : s
                        ));
                    }
                } catch (err) {
                    console.error('Polling error:', err);
                }
            }
        };

        const interval = setInterval(checkVideoStatus, 5000);
        return () => clearInterval(interval);
    }, [projectId]); // Polling legato al progetto, non ai segmenti specifici per stabilità 


    // Toggle Language
    const toggleLanguage = () => {
        const newLang = lang === 'it' ? 'en' : 'it';
        setLang(newLang);
        const oldDefault = TRANSLATIONS[lang].defaultInstruction;
        if (config.systemInstruction === oldDefault || config.systemInstruction.length > 0) {
            setConfig(prev => ({
                ...prev,
                systemInstruction: TRANSLATIONS[newLang].defaultInstruction
            }));
        }
    };

    const handleConfigChange = (key: keyof AgentConfig, value: string | number) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    // --- Workflow Logic ---

    const runWorkflow = useCallback(async () => {
        setStatus(FlowStatus.PROCESSING);
        setSegments([]);

        let newSegments: TimelineSegment[] = [];

        // --- Path A: SRT Mode ---
        if (inputMode === 'SRT') {
            if (!srtInput.trim()) return;
            const rawEntries = parseSRT(srtInput);
            if (rawEntries.length === 0) {
                alert("No valid SRT entries found. Please check format.");
                setStatus(FlowStatus.ERROR);
                return;
            }
            const chunks = chunkSrtEntries(rawEntries, config.intervalSeconds);
            newSegments = chunks.map(chunk => ({
                id: generateUUID(),
                startTime: chunk.startTime,
                endTime: chunk.endTime,
                originalText: chunk.text,
                isProcessingPrompt: true,
                isProcessingImage: false,
                isProcessingVideo: false,
                generatedPrompt: ''
            }));
        }
        // --- Path B: Direct Prompts Mode ---
        else {
            if (!promptInput.trim()) return;
            const lines = promptInput.split('\n').filter(line => line.trim().length > 0);
            newSegments = lines.map((line, index) => ({
                id: generateUUID(),
                startTime: index * config.intervalSeconds,
                endTime: (index + 1) * config.intervalSeconds,
                originalText: "Manual Input",
                generatedPrompt: line.trim(),
                isProcessingPrompt: false,
                isProcessingImage: true,
                isProcessingVideo: false,
            }));
        }

        setSegments(newSegments);
        setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);

        // ─── CHIAMATA DIRETTA A N8N (sempre, se webhook configurato) ─────────
        // Il webhook URL viene dalla sezione Impostazioni > URL Webhook.
        // Il Bridge viene usato SOLO per ricevere gli aggiornamenti in tempo reale via Socket.io.
        if (config.webhookUrl && config.webhookUrl.trim().length > 0) {
            try {
                const content = inputMode === 'SRT' ? srtInput : promptInput;

                // Se il Bridge è attivo, gli diciamo dove mandare i callback
                const callbackUrl = isBridgeConnected
                    ? `${BRIDGE_URL}/update-scene`
                    : undefined;

                const res = await fetch(config.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        body: {
                            project_id: projectId,
                            type: inputMode,
                            content,
                            sampling_sec: config.intervalSeconds,
                            user_agent_prompt: config.systemInstruction,
                            required_frames: newSegments.length,
                            ...(callbackUrl ? { callback_url: callbackUrl } : {}),
                        }
                    }),
                });

                if (!res.ok) {
                    throw new Error(`n8n ha risposto con status ${res.status}`);
                }

                console.log('[Workflow] Richiesta inviata a n8n con successo.');

                // Se il Bridge è attivo, aspetta gli aggiornamenti via Socket.io
                if (isBridgeConnected) return;

            } catch (err) {
                setStatus(FlowStatus.ERROR);
                const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
                alert(`❌ Errore nell\'invio a n8n:\n\n${msg}\n\nIl workflow è stato interrotto.`);
                return;
            }
        }

        // ─── MODALITÀ LOCALE (Gemini) — Fallback quando Bridge non disponibile ───
        let styleBible = "Cinematic, photorealistic, consistent character.";

        if (inputMode === 'SRT' && newSegments.length > 0) {
            console.log("Generating Style Bible...");
            styleBible = await generateStyleBible(srtInput, config.systemInstruction);
            console.log("Style Bible:", styleBible);
        }

        let previousContext = "";
        const BATCH_SIZE = 1;

        for (let i = 0; i < newSegments.length; i += BATCH_SIZE) {
            const batch = newSegments.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async (seg) => {
                let currentPrompt = seg.generatedPrompt;

                // 1. Generate Prompt (Only if SRT Mode)
                if (inputMode === 'SRT') {
                    // PASS STYLE BIBLE AND PREVIOUS CONTEXT
                    currentPrompt = await generatePromptForSegment(
                        seg,
                        config.systemInstruction,
                        styleBible,
                        previousContext
                    );

                    // Update previous context for the next iteration
                    if (currentPrompt && !currentPrompt.includes("Error")) {
                        previousContext = currentPrompt;
                    }

                    // Update UI: Prompt Done, Start Image
                    setSegments(prev => prev.map(s =>
                        s.id === seg.id
                            ? { ...s, isProcessingPrompt: false, generatedPrompt: currentPrompt, isProcessingImage: true }
                            : s
                    ));
                }

                // 2. Generate Image (For both modes)
                if (currentPrompt && !currentPrompt.includes("Error")) {
                    try {
                        const base64Image = await generateImageFromPrompt(currentPrompt);
                        setSegments(prev => prev.map(s =>
                            s.id === seg.id
                                ? { ...s, isProcessingImage: false, imageUrl: base64Image }
                                : s
                        ));
                    } catch (e) {
                        setSegments(prev => prev.map(s =>
                            s.id === seg.id
                                ? { ...s, isProcessingImage: false, error: "Image Gen Failed" }
                                : s
                        ));
                    }
                } else {
                    setSegments(prev => prev.map(s => s.id === seg.id ? { ...s, isProcessingImage: false } : s));
                }
            }));
        }

        setStatus(FlowStatus.COMPLETED);
    }, [srtInput, promptInput, config, inputMode, isBridgeConnected, projectId]);



    // Handler: Regenerate Just Prompt
    const handleRegeneratePrompt = async (id: string) => {
        const segmentIndex = segments.findIndex(s => s.id === id);
        if (segmentIndex === -1) return;
        const segment = segments[segmentIndex];

        // Find previous prompt to use as anchor
        const prevSegment = segmentIndex > 0 ? segments[segmentIndex - 1] : null;
        const anchor = prevSegment?.generatedPrompt || "";

        setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingPrompt: true, isProcessingImage: false, imageUrl: undefined, videoUrl: undefined } : s));

        let newPrompt = "";

        if (inputMode === 'SRT') {
            // For regeneration, we might not have the original styleBible handy in scope easily without storing it.
            // For now, we will use a generic directive or try to grab context from neighbors.
            // Ideally, we should store styleBible in state. For this quick fix, we'll infer context.
            const prevPrompt = segments[segmentIndex - 1]?.generatedPrompt || "";
            newPrompt = await generatePromptForSegment(
                segment,
                config.systemInstruction,
                "Maintain consistency with previous shots.", // Fallback style if full bible not available
                prevPrompt
            );
        } else {
            newPrompt = segment.generatedPrompt || "";
            await new Promise(r => setTimeout(r, 500));
        }

        setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingPrompt: false, generatedPrompt: newPrompt, isProcessingImage: true } : s));

        if (newPrompt && !newPrompt.includes("Error")) {
            const img = await generateImageFromPrompt(newPrompt);
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false, imageUrl: img } : s));
        } else {
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false } : s));
        }
    };


    // Handler: Regenerate Image (Edit/Fix)
    const handleRegenerateImage = async (id: string, feedback?: string) => {
        const segment = segments.find(s => s.id === id);
        if (!segment || !segment.generatedPrompt) return;

        setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: true, videoUrl: undefined } : s));

        try {
            let newImage: string | undefined;

            if (feedback && segment.imageUrl) {
                newImage = await editImageWithFeedback(segment.imageUrl, segment.generatedPrompt, feedback);
            } else {
                newImage = await generateImageFromPrompt(segment.generatedPrompt);
            }

            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false, imageUrl: newImage } : s));
        } catch (e) {
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false } : s));
            alert("Failed to regenerate image. Try again.");
        }
    };


    const copyAllPrompts = () => {
        const allText = segments.map(s => `[${s.startTime}s]: ${s.generatedPrompt}`).join('\n\n');
        navigator.clipboard.writeText(allText);
        alert(t.copySuccess);
    };

    const isReady = inputMode === 'SRT' ? srtInput.trim().length > 0 : promptInput.trim().length > 0;
    const allImagesReady = segments.length > 0 && segments.every(s => s.imageUrl && !s.isProcessingImage);

    // --- Render Views ---

    const renderWorkflow = () => (
        <>
            {/* Header */}
            <header className="mb-10 text-center">
                <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
                    {t.titlePrefix} <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">{t.titleSuffix}</span>
                </h1>
                <p className="text-slate-400 mb-4">{t.subtitle}</p>

                {/* Bridge Status Badge */}
                <div className="flex justify-center mb-6">
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${isBridgeConnected
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        : 'bg-amber-950/40 border-amber-700/40 text-amber-400'
                        }`}>
                        {isBridgeConnected
                            ? <><Wifi size={12} /> Bridge connesso · Modalità n8n + Drive</>
                            : <><WifiOff size={12} /> Bridge offline · Modalità locale Gemini</>
                        }
                    </div>
                </div>

                {/* Input Mode Switcher */}
                <div className="inline-flex bg-slate-800/80 backdrop-blur border border-slate-700 p-1 rounded-full shadow-2xl relative">
                    <button
                        onClick={() => setInputMode('SRT')}
                        className={`
                        flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all duration-300
                        ${inputMode === 'SRT'
                                ? 'bg-primary text-white shadow-lg'
                                : 'text-slate-400 hover:text-white'
                            }
                    `}
                    >
                        <ListVideo size={16} />
                        {t.modeSwitch.srt}
                    </button>
                    <button
                        onClick={() => setInputMode('PROMPTS')}
                        className={`
                        flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all duration-300
                        ${inputMode === 'PROMPTS'
                                ? 'bg-accent text-white shadow-lg'
                                : 'text-slate-400 hover:text-white'
                            }
                    `}
                    >
                        <ImagePlus size={16} />
                        {t.modeSwitch.prompts}
                    </button>
                </div>
            </header>

            {/* Inputs */}
            {inputMode === 'SRT' ? (
                <>
                    <Node
                        title={t.sourceMaterial}
                        color="blue"
                        icon={<FileText size={20} />}
                        isActive={true}
                    >
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                            {t.transcriptLabel}
                        </label>
                        <textarea
                            className="w-full h-40 bg-slate-900/50 border border-slate-700 rounded-lg p-4 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder-slate-600 resize-y font-mono"
                            placeholder={t.transcriptPlaceholder}
                            value={srtInput}
                            onChange={(e) => setSrtInput(e.target.value)}
                        ></textarea>
                        <div className="flex justify-end mt-2 text-xs text-slate-500">
                            {srtInput.length > 0 ? `${srtInput.split(/\n\s*\n/).length} ${t.wordsDetected}` : t.waitingInput}
                        </div>
                    </Node>

                    <Node
                        title={t.agentConfig}
                        color="purple"
                        icon={<Settings size={20} />}
                        isActive={srtInput.length > 0}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                                    <Clock size={14} /> {t.promptInterval}
                                </label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="1"
                                    value={config.intervalSeconds}
                                    onChange={(e) => handleConfigChange('intervalSeconds', parseFloat(e.target.value))}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <p className="text-xs text-slate-500 mt-1">{t.intervalHelp}</p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                                <Wand2 size={14} className="text-accent" /> {t.systemInstruction}
                            </label>
                            <textarea
                                className="w-full h-80 bg-slate-900/50 border border-slate-700 rounded-lg p-4 text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
                                value={config.systemInstruction}
                                onChange={(e) => handleConfigChange('systemInstruction', e.target.value)}
                            ></textarea>
                            <p className="text-xs text-slate-500 mt-1">{t.instructionHelp}</p>
                        </div>
                    </Node>
                </>
            ) : (
                <Node
                    title={t.directPrompts.title}
                    color="orange"
                    icon={<ImagePlus size={20} />}
                    isActive={true}
                >
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        {t.directPrompts.label}
                    </label>
                    <textarea
                        className="w-full h-64 bg-slate-900/50 border border-slate-700 rounded-lg p-4 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all placeholder-slate-600 resize-y font-mono"
                        placeholder={t.directPrompts.placeholder}
                        value={promptInput}
                        onChange={(e) => setPromptInput(e.target.value)}
                    ></textarea>
                    <div className="flex justify-end mt-2 text-xs text-slate-500">
                        {promptInput.trim().length > 0
                            ? `${promptInput.split('\n').filter(l => l.trim()).length} ${t.directPrompts.count}`
                            : t.directPrompts.waiting}
                    </div>
                </Node>
            )}

            <div className="flex justify-center -mt-6 mb-12 relative z-20">
                <button
                    onClick={runWorkflow}
                    disabled={!isReady || status === FlowStatus.PROCESSING}
                    className={`
                    flex items-center gap-3 px-8 py-4 rounded-full font-bold text-white shadow-2xl hover:shadow-primary/50 transition-all transform hover:scale-105
                    ${status === FlowStatus.PROCESSING
                            ? 'bg-slate-700 cursor-not-allowed'
                            : 'bg-gradient-to-r from-primary to-accent'
                        }
                `}
                >
                    {status === FlowStatus.PROCESSING ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            {t.processing}
                        </>
                    ) : (
                        <>
                            <Play size={20} fill="currentColor" />
                            {t.runWorkflow}
                        </>
                    )}
                </button>
            </div>

            {segments.length > 0 && (
                <div ref={resultsRef}>
                    <Node
                        title={t.generatedTimeline}
                        color="green"
                        icon={<Database size={20} />}
                        isActive={true}
                        className="animate-in fade-in slide-in-from-bottom-8 duration-700"
                    >
                        <div className="flex justify-between items-center mb-6 px-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-emerald-400 bg-emerald-950/50 px-3 py-1 rounded-full border border-emerald-500/30">
                                    {segments.length} {t.promptsGenerated}
                                </span>
                                {status === FlowStatus.PROCESSING && (
                                    <span className="text-xs text-slate-400 animate-pulse">
                                        {t.agentWorking}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={copyAllPrompts}
                                className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-md transition-colors"
                            >
                                <Copy size={14} /> {t.copyAll}
                            </button>
                        </div>

                        <div className="space-y-4 max-h-[1000px] overflow-y-auto pr-2 custom-scrollbar">
                            {segments.map((segment) => (
                                <TimelineCard
                                    key={segment.id}
                                    segment={segment}
                                    onRegeneratePrompt={inputMode === 'SRT' ? handleRegeneratePrompt : () => { }}
                                    onRegenerateImage={handleRegenerateImage}
                                    labels={t.timeline}
                                />
                            ))}
                        </div>


                    </Node>
                </div>
            )}
        </>
    );

    const renderSettings = () => (
        <div className="max-w-2xl mx-auto pt-10">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
                <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                    <Settings className="text-slate-400" /> {t.settings.title}
                </h2>

                {/* Webhook Configuration */}
                <div className="mb-8 border-b border-slate-800 pb-8">
                    <h3 className="text-lg font-semibold text-slate-200 mb-2 flex items-center gap-2">
                        <Database size={18} className="text-blue-400" />
                        {t.settings.webhookSection}
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">{t.settings.webhookDesc}</p>

                    <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-2">{t.settings.webhookLabel}</label>
                        <input
                            type="text"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                            placeholder={t.settings.webhookPlaceholder}
                            value={config.webhookUrl || ''}
                            onChange={(e) => handleConfigChange('webhookUrl', e.target.value)}
                        />
                        {config.webhookUrl && (
                            <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                                <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                                Webhook configurato
                            </p>
                        )}
                    </div>
                </div>

                {/* Drive Integration */}
                <div>
                    <h3 className="text-lg font-semibold text-slate-200 mb-2">{t.settings.driveSection}</h3>
                    <p className="text-sm text-slate-500 mb-4">{t.settings.driveDesc}</p>
                    <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                        <HardDrive size={18} />
                        {t.settings.driveConnect}
                    </button>
                    <p className="text-xs text-slate-600 mt-2 italic">Feature coming soon (Mockup)</p>
                </div>

                <div className="mt-8 flex justify-end">
                    <button
                        onClick={() => setActiveTab('workflow')}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-emerald-900/20"
                    >
                        {t.settings.save}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="relative min-h-screen font-sans text-slate-300 selection:bg-accent/30 selection:text-white pb-20 bg-canvas">
            <FlowCanvas />

            {/* Sidebar */}
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isOpen={isSidebarOpen}
                setIsOpen={setIsSidebarOpen}
                labels={t.nav}
            />

            {/* Language Switcher */}
            <div className="absolute top-6 right-6 z-50">
                <button
                    onClick={toggleLanguage}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full px-4 py-2 transition-all shadow-lg hover:shadow-xl"
                >
                    <span className="text-xl leading-none">{lang === 'it' ? '🇮🇹' : '🇺🇸'}</span>
                    <span className="text-sm font-bold text-white uppercase">{lang}</span>
                </button>
            </div>

            <main className="relative z-10 md:pl-64 transition-all duration-300">
                <div className="max-w-6xl mx-auto px-6 py-12">
                    {activeTab === 'workflow' && renderWorkflow()}

                    {activeTab === 'editor' && (
                        <div className="pt-6 h-[calc(100vh-100px)]">
                            <div className="mb-6">
                                <h1 className="text-2xl font-bold text-white">{t.editor.title}</h1>
                            </div>
                            <VideoEditor segments={segments} labels={t.editor} />
                        </div>
                    )}

                    {activeTab === 'settings' && renderSettings()}

                    {activeTab === 'bridge' && (
                        <div className="animate-in fade-in duration-700">
                            <header className="mb-10 text-center">
                                <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
                                    {t.nav.bridge} <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-primary">Live</span>
                                </h1>
                                <p className="text-slate-400">Visualizzazione in tempo reale degli asset generati tramite n8n + Bridge.</p>

                                <div className="flex flex-col items-center gap-4 mt-6">
                                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${isBridgeConnected
                                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                                        : 'bg-red-950/40 border-red-700/40 text-red-400'
                                        }`}>
                                        {isBridgeConnected
                                            ? <><Wifi size={12} /> Bridge attivo</>
                                            : <><WifiOff size={12} /> Disconnesso dal Bridge</>
                                        }
                                    </div>

                                    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs">
                                        <span className="text-slate-500 uppercase font-bold tracking-widest">Project ID:</span>
                                        <code className="text-blue-400 font-mono font-bold">{projectId}</code>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(projectId);
                                                alert('Project ID copiato!');
                                            }}
                                            className="ml-2 text-slate-400 hover:text-white"
                                            title="Copia ID"
                                        >
                                            <Copy size={14} />
                                        </button>
                                    </div>
                                </div>
                            </header>

                            {segments.length === 0 ? (
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center">
                                    <Database size={48} className="mx-auto text-slate-700 mb-4 opacity-50" />
                                    <h3 className="text-lg font-bold text-slate-300 mb-2">In attesa di dati...</h3>
                                    <p className="text-slate-500 max-w-md mx-auto">
                                        Avvia un workflow dalla scheda "Workflow" per iniziare a ricevere aggiornamenti in tempo reale in questa sezione.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col">
                                                <span className="text-xs text-slate-500 uppercase font-bold tracking-widest">Status Progetto</span>
                                                <span className={`text-sm font-bold ${status === FlowStatus.COMPLETED ? 'text-emerald-400' : 'text-blue-400'}`}>
                                                    {status === FlowStatus.COMPLETED ? '✓ COMPLETATO' : '⚡ IN ELABORAZIONE...'}
                                                </span>
                                            </div>
                                            <div className="w-px h-8 bg-slate-700 mx-2"></div>
                                            <div className="flex flex-col">
                                                <span className="text-xs text-slate-500 uppercase font-bold tracking-widest">Asset</span>
                                                <span className="text-sm font-bold text-white">{segments.filter(s => s.imageUrl).length} / {segments.length}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={copyAllPrompts}
                                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold transition-all"
                                        >
                                            {t.copyAll}
                                        </button>
                                    </div>

                                    <div className="grid gap-6">
                                        {segments.map((segment) => (
                                            <TimelineCard
                                                key={segment.id}
                                                segment={segment}
                                                onRegeneratePrompt={() => { }}
                                                onRegenerateImage={() => { }}
                                                labels={t.timeline}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;
