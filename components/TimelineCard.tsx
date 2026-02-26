import React, { useState } from 'react';
import { TimelineSegment } from '../types';
import { Image as ImageIcon, Loader2, RefreshCw, Wand2, X, Film, Download } from 'lucide-react';
import { getProxiedImageUrl } from '@/utils/imageUtils';

interface TimelineCardProps {
    segment: TimelineSegment;
    onRegeneratePrompt: (id: string) => void;
    onRegenerateVideo: (id: string) => void;
    onDownloadVideo: (url: string) => void;
    labels: {
        source: string;
        generated: string;
        waiting: string;
        regenerate: string;
        regenerateVideo: string;
        downloadVideo: string;
        imageLabel: string;
        videoLabel: string;
        generatingVideo: string;
    }
}

export const TimelineCard: React.FC<TimelineCardProps> = ({
    segment,
    onRegeneratePrompt,
    onRegenerateVideo,
    onDownloadVideo,
    labels
}) => {

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };


    return (
        <div className="flex gap-4 mb-8 relative">
            {/* Timeline Indicator */}
            <div className="flex flex-col items-center min-w-[70px] pt-2">
                <span className="text-xs font-mono text-emerald-400 bg-slate-800 px-2 py-1 rounded-full border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                    {formatTime(segment.startTime)}
                </span>
                <div className="w-0.5 h-full bg-slate-800 my-2"></div>
            </div>

            {/* Node Content */}
            <div className="flex-1 flex flex-col gap-2">

                {/* Main Card */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 shadow-lg relative overflow-hidden group">

                    {/* Input Connector decoration */}
                    <div className="absolute left-[-6px] top-6 w-3 h-3 bg-slate-600 rounded-full border-2 border-slate-900"></div>

                    {/* Top Section: Script */}
                    <div className="mb-4">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <FileIcon /> {labels.source}
                        </p>
                        <p className="text-slate-200 text-sm italic border-l-2 border-blue-500/50 pl-3 py-1 bg-blue-900/10 rounded-r">
                            "{segment.originalText}"
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Left Column: Prompt */}
                        <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700/50 flex flex-col">
                            <div className="flex items-center justify-between mb-2">
                                <p className="text-xs text-blue-400 font-bold uppercase tracking-wider">
                                    {labels.generated}
                                </p>
                                {!segment.isProcessingPrompt && (
                                    <button
                                        onClick={() => onRegeneratePrompt(segment.id)}
                                        className="text-slate-500 hover:text-white transition-colors p-1"
                                        title={labels.regenerate}
                                    >
                                        <RefreshCw size={12} />
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 min-h-[80px]">
                                {segment.isProcessingPrompt ? (
                                    <div className="space-y-2 animate-pulse">
                                        <div className="h-2 bg-slate-700 rounded w-3/4"></div>
                                        <div className="h-2 bg-slate-700 rounded w-full"></div>
                                        <div className="h-2 bg-slate-700 rounded w-5/6"></div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-300 font-mono leading-relaxed overflow-y-auto max-h-[120px] custom-scrollbar">
                                        {segment.generatedPrompt || labels.waiting}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Image */}
                        <div className="bg-slate-900/60 rounded-lg p-1 border border-slate-700/50 flex flex-col relative min-h-[200px]">
                            {/* Image Generation Overlay/Loader */}
                            {segment.isProcessingImage && (
                                <div className="absolute inset-0 z-10 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg">
                                    <Loader2 className="animate-spin text-accent mb-2" size={24} />
                                    <span className="text-xs text-accent font-medium animate-pulse">Rendering...</span>
                                </div>
                            )}

                            {segment.imageUrl ? (
                                <div className="relative group/image h-full w-full">
                                    <img
                                        src={getProxiedImageUrl(segment.imageUrl)}
                                        alt="Generated Asset"
                                        className="w-full h-full object-cover rounded-md shadow-inner"
                                    />

                                    {/* Hover Actions: Video Download & Regen */}
                                    <div className="absolute inset-x-0 bottom-0 bg-black/60 opacity-0 group-hover/image:opacity-100 transition-opacity p-2 flex justify-around items-center backdrop-blur-sm rounded-b-md">
                                        {segment.videoUrl ? (
                                            <button
                                                onClick={() => onDownloadVideo(segment.videoUrl!)}
                                                className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded-lg transition-all border border-emerald-500/30 flex items-center gap-1.5 text-[10px] font-bold"
                                                title={labels.downloadVideo}
                                            >
                                                <Download size={14} /> {labels.downloadVideo}
                                            </button>
                                        ) : (
                                            <div className="text-[9px] text-slate-500 italic">No video yet</div>
                                        )}

                                        <button
                                            onClick={() => onRegenerateVideo(segment.id)}
                                            className="p-1.5 bg-indigo-500/20 hover:bg-indigo-500 text-indigo-400 hover:text-white rounded-lg transition-all border border-indigo-500/30 flex items-center gap-1.5 text-[10px] font-bold"
                                            title={labels.regenerateVideo}
                                        >
                                            <RefreshCw size={14} className={segment.isProcessingVideo ? 'animate-spin' : ''} /> {labels.regenerateVideo}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-slate-600 border-2 border-dashed border-slate-700/50 rounded-md m-2">
                                    <ImageIcon size={24} className="opacity-20" />
                                </div>
                            )}
                        </div>
                    </div>

                </div>

                {/* Video Transition Section (Outside main card to look like a connector) */}
                {(segment.videoUrl || segment.isProcessingVideo) && (
                    <div className="mx-auto w-full max-w-[80%] bg-black/40 border-x border-b border-slate-700/50 rounded-b-lg p-2 flex flex-col items-center">
                        <div className="flex items-center gap-2 mb-2 text-xs text-slate-400 font-mono">
                            <Film size={12} className={segment.isProcessingVideo ? "animate-pulse text-accent" : "text-green-500"} />
                            {segment.isProcessingVideo ? labels.generatingVideo : labels.videoLabel}
                        </div>

                        {segment.isProcessingVideo ? (
                            <div className="w-full h-1 bg-slate-800 rounded overflow-hidden">
                                <div className="h-full bg-accent animate-progress w-1/2"></div>
                            </div>
                        ) : segment.videoUrl ? (
                            <video
                                controls
                                className="w-full rounded border border-slate-800 shadow-lg"
                                src={segment.videoUrl}
                            ></video>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
};

const FileIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
    </svg>
);
