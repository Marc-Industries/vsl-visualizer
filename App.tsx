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
    WifiOff,
    Trash2,
    Download,
    Upload,
    X,
    User,
    Package,
    Link,
    RefreshCw,
    Film
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
    ActiveTab,
    PipelineMode,
    InputMode
} from './types';

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:3001';

function App() {
    // State
    const [lang, setLang] = useState<Language>('it');
    const [pipelineMode, setPipelineMode] = useState<PipelineMode>('AVATAR');
    const [inputMode, setInputMode] = useState<InputMode>('SRT');
    const [activeTab, setActiveTab] = useState<ActiveTab>('workflow');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Input States
    const [srtInput, setSrtInput] = useState<string>('');
    const [promptInput, setPromptInput] = useState<string>('');
    const [avatarPreview, setAvatarPreview] = useState<string>('');
    const [productPreview, setProductPreview] = useState<string>('');
    const [avatarUrlInput, setAvatarUrlInput] = useState<string>('');
    const [productUrlInput, setProductUrlInput] = useState<string>('');
    const avatarFileRef = useRef<HTMLInputElement>(null);
    const productFileRef = useRef<HTMLInputElement>(null);

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
        let finalAvatarUrl = '';
        let finalProductUrl = '';

        if (pipelineMode === 'AVATAR') {
            finalAvatarUrl = avatarPreview || avatarUrlInput;
            if (!finalAvatarUrl) {
                alert(t.avatar.required);
                return;
            }
            finalProductUrl = productPreview || productUrlInput;
        }

        setStatus(FlowStatus.PROCESSING);
        setSegments([]);

        let newSegments: TimelineSegment[] = [];

        if (pipelineMode === 'AVATAR' || (pipelineMode === 'STANDARD' && inputMode === 'SRT')) {
            if (!srtInput.trim()) {
                setStatus(FlowStatus.IDLE);
                return;
            }
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
        } else if (pipelineMode === 'STANDARD' && inputMode === 'PROMPTS') {
            if (!promptInput.trim()) {
                setStatus(FlowStatus.IDLE);
                return;
            }
            const rawPrompts = promptInput.split('\n').filter(p => p.trim() !== '');
            if (rawPrompts.length === 0) {
                alert("No valid prompts found.");
                setStatus(FlowStatus.ERROR);
                return;
            }
            newSegments = rawPrompts.map((prompt, index) => ({
                id: generateUUID(),
                startTime: index * config.intervalSeconds,
                endTime: (index + 1) * config.intervalSeconds,
                originalText: `Prompt #${index + 1}`,
                isProcessingPrompt: false,
                isProcessingImage: true,
                isProcessingVideo: false,
                generatedPrompt: prompt.trim()
            }));
        }

        setSegments(newSegments);
        setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);

        // ─── CHIAMATA DIRETTA A N8N (se webhook configurato) ─────────
        if (config.webhookUrl && config.webhookUrl.trim().length > 0) {
            try {
                const callbackUrl = isBridgeConnected
                    ? `${BRIDGE_URL}/update-scene`
                    : undefined;

                // Prepare payload based on pipeline mode
                let payloadBody: any = {
                    project_id: projectId,
                    type: pipelineMode === 'AVATAR' ? 'SRT' : inputMode,
                    content: pipelineMode === 'AVATAR' ? srtInput : (inputMode === 'SRT' ? srtInput : promptInput.split('\n').filter(p => p.trim() !== '')),
                    sampling_sec: config.intervalSeconds,
                    user_agent_prompt: config.systemInstruction,
                    required_frames: newSegments.length,
                    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
                };

                if (pipelineMode === 'AVATAR') {
                    payloadBody.avatar_url = finalAvatarUrl;
                    if (finalProductUrl) payloadBody.product_url = finalProductUrl;
                }

                const res = await fetch(config.webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: payloadBody }),
                });

                if (!res.ok) {
                    throw new Error(`n8n ha risposto con status ${res.status}`);
                }

                console.log(`[Workflow] Richiesta inviata a n8n con successo (Mode: ${pipelineMode}).`);

                if (isBridgeConnected) return;

            } catch (err) {
                setStatus(FlowStatus.ERROR);
                const msg = err instanceof Error ? err.message : 'Errore sconosciuto';
                alert(`❌ Errore nell'invio a n8n:\n\n${msg}\n\nIl workflow è stato interrotto.`);
                return;
            }
        }

        // ─── MODALITÀ LOCALE (Gemini) — Fallback quando Bridge non disponibile ───
        let styleBible = "Cinematic, photorealistic, consistent character.";

        if (newSegments.length > 0) {
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

                // 1. Generate Prompt from SRT
                currentPrompt = await generatePromptForSegment(
                    seg,
                    config.systemInstruction,
                    styleBible,
                    previousContext
                );

                if (currentPrompt && !currentPrompt.includes("Error")) {
                    previousContext = currentPrompt;
                }

                setSegments(prev => prev.map(s =>
                    s.id === seg.id
                        ? { ...s, isProcessingPrompt: false, generatedPrompt: currentPrompt, isProcessingImage: true }
                        : s
                ));

                // 2. Generate Image
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
    }, [pipelineMode, inputMode, srtInput, promptInput, avatarPreview, avatarUrlInput, productPreview, productUrlInput, config, isBridgeConnected, projectId, t.avatar.required]);




    // --- Actions ---
    const cleanCache = () => {
        if (window.confirm(t.cleanCacheConfirm)) {
            localStorage.clear();
            setSegments([]);
            const newId = `proj_${Date.now()}`;
            localStorage.setItem('vsl_project_id', newId);
            window.location.reload();
        }
    };

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

        const prevPrompt = segments[segmentIndex - 1]?.generatedPrompt || "";
        newPrompt = await generatePromptForSegment(
            segment,
            config.systemInstruction,
            "Maintain consistency with previous shots.",
            prevPrompt
        );

        setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingPrompt: false, generatedPrompt: newPrompt, isProcessingImage: true } : s));

        if (newPrompt && !newPrompt.includes("Error")) {
            const img = await generateImageFromPrompt(newPrompt);
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false, imageUrl: img } : s));
        } else {
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingImage: false } : s));
        }
    };


    // Handler: Regenerate Just Video
    const handleRegenerateVideo = async (id: string) => {
        const segmentIndex = segments.findIndex(s => s.id === id);
        if (segmentIndex === -1) return;

        setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingVideo: true, videoUrl: undefined } : s));

        try {
            await sendToWebhook(config.webhookUrl || '', {
                type: 'SRT', // Dummy type to satisfy interface, Bridge will handle the logic
                content: segments[segmentIndex].generatedPrompt || '',
                callback_url: `${BRIDGE_URL}/update-scene`,
                project_id: projectId,
                scene_index: segmentIndex,
                regen_type: 'video'
            } as any);
        } catch (err) {
            console.error("Regen Video Error:", err);
            setSegments(prev => prev.map(s => s.id === id ? { ...s, isProcessingVideo: false, error: 'Regen Failed' } : s));
        }
    };

    const handleDownloadVideo = (url: string) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `video-segment-${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleRemoveSegment = (index: number) => {
        if (window.confirm("Rimuovere questo segmento dalla timeline?")) {
            setSegments(prev => prev.filter((_, i) => i !== index));
        }
    };



    const copyAllPrompts = () => {
        const allText = segments.map(s => `[${s.startTime}s]: ${s.generatedPrompt}`).join('\n\n');
        navigator.clipboard.writeText(allText);
        alert(t.copySuccess);
    };

    const isReady = srtInput.trim().length > 0;
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
                    {/* Pipeline Mode Switcher */}
                    <div className="flex bg-slate-900 border border-slate-700/50 rounded-lg p-1 mr-4">
                        <button
                            onClick={() => setPipelineMode('AVATAR')}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${pipelineMode === 'AVATAR' ? 'bg-indigo-600 shadow-md text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                        >
                            {t.pipelineMode.avatar}
                        </button>
                        <button
                            onClick={() => setPipelineMode('STANDARD')}
                            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${pipelineMode === 'STANDARD' ? 'bg-slate-700 shadow-md text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                        >
                            {t.pipelineMode.standard}
                        </button>
                    </div>

                    <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border shadow-sm ${isBridgeConnected
                        ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-400'
                        : 'bg-amber-950/40 border-amber-700/40 text-amber-400'
                        }`}>
                        {isBridgeConnected
                            ? <><Wifi size={12} /> Bridge connesso · Modalità n8n + Drive</>
                            : <><WifiOff size={12} /> Bridge offline · Modalità locale Gemini</>
                        }
                    </div>
                </div>

            </header>

            {pipelineMode === 'AVATAR' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* Avatar Upload Card */}
                    <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-6 backdrop-blur">
                        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                            <User size={16} className="text-blue-400" />
                            {t.avatar.avatarLabel}
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">{t.avatar.avatarHelp}</p>

                        {avatarPreview ? (
                            <div className="relative group">
                                <img src={avatarPreview} alt="Avatar" className="w-full h-48 object-cover rounded-lg border border-slate-600" />
                                <button
                                    onClick={() => { setAvatarPreview(''); setAvatarUrlInput(''); }}
                                    className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <input type="file" ref={avatarFileRef} accept="image/*" className="hidden" onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => setAvatarPreview(reader.result as string);
                                        reader.readAsDataURL(file);
                                    }
                                }} />
                                <button
                                    onClick={() => avatarFileRef.current?.click()}
                                    className="w-full h-32 border-2 border-dashed border-slate-600 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-all cursor-pointer bg-slate-950/50"
                                >
                                    <Upload size={24} />
                                    <span className="text-xs font-bold">{t.avatar.uploadBtn}</span>
                                </button>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-600 uppercase font-bold">{t.avatar.pasteUrl}</span>
                                    <div className="flex-1 h-px bg-slate-700"></div>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="https://..."
                                        value={avatarUrlInput}
                                        onChange={(e) => setAvatarUrlInput(e.target.value)}
                                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500 transition-colors"
                                    />
                                    {avatarUrlInput && (
                                        <button onClick={() => setAvatarPreview(avatarUrlInput)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg text-xs font-bold transition-all">
                                            <Link size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Product Upload Card */}
                    <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-6 backdrop-blur">
                        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                            <Package size={16} className="text-emerald-400" />
                            {t.avatar.productLabel}
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">{t.avatar.productHelp}</p>

                        {productPreview ? (
                            <div className="relative group">
                                <img src={productPreview} alt="Product" className="w-full h-48 object-cover rounded-lg border border-slate-600" />
                                <button
                                    onClick={() => { setProductPreview(''); setProductUrlInput(''); }}
                                    className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <input type="file" ref={productFileRef} accept="image/*" className="hidden" onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => setProductPreview(reader.result as string);
                                        reader.readAsDataURL(file);
                                    }
                                }} />
                                <button
                                    onClick={() => productFileRef.current?.click()}
                                    className="w-full h-32 border-2 border-dashed border-slate-600 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-500 hover:text-emerald-400 transition-all cursor-pointer bg-slate-950/50"
                                >
                                    <Upload size={24} />
                                    <span className="text-xs font-bold">{t.avatar.uploadBtn}</span>
                                </button>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-600 uppercase font-bold">{t.avatar.pasteUrl}</span>
                                    <div className="flex-1 h-px bg-slate-700"></div>
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="https://..."
                                        value={productUrlInput}
                                        onChange={(e) => setProductUrlInput(e.target.value)}
                                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500 transition-colors"
                                    />
                                    {productUrlInput && (
                                        <button onClick={() => setProductPreview(productUrlInput)} className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded-lg text-xs font-bold transition-all">
                                            <Link size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {pipelineMode === 'STANDARD' && (
                <div className="flex bg-slate-900 border border-slate-700/50 rounded-lg p-1 w-fit mb-6">
                    <button
                        onClick={() => setInputMode('SRT')}
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${inputMode === 'SRT' ? 'bg-blue-600 shadow-md text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        {t.modeSwitch.srt}
                    </button>
                    <button
                        onClick={() => setInputMode('PROMPTS')}
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${inputMode === 'PROMPTS' ? 'bg-purple-600 shadow-md text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        {t.modeSwitch.prompts}
                    </button>
                </div>
            )
            }

            {
                (pipelineMode === 'AVATAR' || inputMode === 'SRT') && (
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
                        />
                        <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                            <span>{srtInput.trim() ? parseSRT(srtInput).length : 0} {t.wordsDetected}</span>
                            {!srtInput.trim() && <span className="animate-pulse">{t.waitingInput}</span>}
                        </div>
                    </Node>
                )
            }

            {
                pipelineMode === 'STANDARD' && inputMode === 'PROMPTS' && (
                    <Node
                        title={t.directPrompts.title}
                        color="purple"
                        icon={<FileText size={20} />}
                        isActive={true}
                    >
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                            {t.directPrompts.label}
                        </label>
                        <textarea
                            className="w-full h-40 bg-slate-900/50 border border-slate-700/50 rounded-lg p-4 text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all placeholder-slate-600 resize-y font-mono"
                            placeholder={t.directPrompts.placeholder}
                            value={promptInput}
                            onChange={(e) => setPromptInput(e.target.value)}
                        />
                        <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                            <span>
                                {promptInput.trim() ? promptInput.split('\n').filter(p => p.trim() !== '').length : 0} {t.directPrompts.count}
                            </span>
                            {!promptInput.trim() && <span className="animate-pulse">{t.directPrompts.waiting}</span>}
                        </div>
                    </Node>
                )
            }

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

            {
                segments.length > 0 && (
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
                                        onRegeneratePrompt={handleRegeneratePrompt}
                                        onRegenerateVideo={handleRegenerateVideo}
                                        onDownloadVideo={handleDownloadVideo}
                                        labels={t.timeline}
                                    />
                                ))}
                            </div>


                        </Node>
                    </div>
                )
            }
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


                <div className="mt-8 flex justify-end">
                    <button
                        onClick={() => {
                            // Simuliamo il salvataggio
                            alert(t.settings.save + " OK");
                            setActiveTab('workflow');
                        }}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-emerald-900/40 transform hover:scale-105 transition-all flex items-center gap-2"
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

                <button
                    onClick={cleanCache}
                    title={t.cleanCache}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-red-900/40 border border-slate-700 hover:border-red-500/50 rounded-full px-4 py-2 transition-all shadow-lg hover:shadow-xl text-slate-400 hover:text-red-400 mt-2"
                >
                    <Trash2 size={16} />
                    <span className="text-xs font-bold uppercase">{t.cleanCache}</span>
                </button>

                <div className="mt-4 text-right">
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest block">Project ID</span>
                    <span className="text-xs text-slate-400 font-mono font-bold blur-[2px] hover:blur-none transition-all cursor-help" title="Click to copy fully">
                        {projectId}
                    </span>
                </div>
            </div>

            <main className="relative z-10 md:pl-64 transition-all duration-300">
                <div className="max-w-6xl mx-auto px-6 py-12">
                    {activeTab === 'workflow' && renderWorkflow()}

                    {activeTab === 'editor' && (
                        <div className="pt-6 h-[calc(100vh-100px)]">
                            <div className="mb-6">
                                <h1 className="text-2xl font-bold text-white">{t.editor.title}</h1>
                            </div>
                            <VideoEditor
                                segments={segments}
                                labels={t.editor}
                                onRemoveSegment={handleRemoveSegment}
                            />
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
                                                onRegenerateVideo={() => { }}
                                                onDownloadVideo={() => { }}
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
