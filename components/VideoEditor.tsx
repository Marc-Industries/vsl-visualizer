import React, { useState, useRef, useEffect } from 'react';
import { TimelineSegment } from '../types';
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, Scissors, Download, AlertCircle, Film, Image as ImageIcon } from 'lucide-react';

interface VideoEditorProps {
  segments: TimelineSegment[];
  labels: {
    title: string;
    noSegments: string;
    trackMain: string;
    duration: string;
  }
}

export const VideoEditor: React.FC<VideoEditorProps> = ({ segments, labels }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeoutRef = useRef<number | null>(null);

  // Reset when segments change
  useEffect(() => {
    if (activeIndex >= segments.length) {
      setActiveIndex(0);
    }
  }, [segments.length]);

  // Handle Playback Logic (Auto-advance)
  useEffect(() => {
    if (!isPlaying) {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      if (videoRef.current) videoRef.current.pause();
      return;
    }

    const currentSegment = segments[activeIndex];
    
    // CASE A: It has a generated VIDEO
    if (currentSegment?.videoUrl) {
      if (videoRef.current) {
        videoRef.current.src = currentSegment.videoUrl;
        videoRef.current.play().catch(e => {
            console.error("Auto-play failed:", e);
            setIsPlaying(false);
        });
      }
    } 
    // CASE B: It is an IMAGE only (Simulate duration)
    else if (currentSegment?.imageUrl) {
      // Default duration for static images (e.g., 3 seconds)
      timeoutRef.current = window.setTimeout(() => {
        handleNext();
      }, 3000); 
    }
  }, [activeIndex, isPlaying]);

  const handleVideoEnded = () => {
    handleNext();
  };

  const handleNext = () => {
    if (activeIndex < segments.length - 1) {
      setActiveIndex(prev => prev + 1);
      // isPlaying remains true, triggering the effect for the next segment
    } else {
      setIsPlaying(false); // End of timeline
      setActiveIndex(0); // Reset to start
    }
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveIndex(prev => prev - 1);
    }
  };

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  const handleTimelineClick = (index: number) => {
    setActiveIndex(index);
    setIsPlaying(false); // Stop playback when jumping manually
  };

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500">
        <AlertCircle size={48} className="mb-4 opacity-50" />
        <p className="text-lg">{labels.noSegments}</p>
      </div>
    );
  }

  const currentSegment = segments[activeIndex];
  const totalDuration = segments.length * 3; // Approx duration for ruler

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      
      {/* 1. Preview Area (Top) */}
      <div className="flex-1 bg-black relative flex items-center justify-center min-h-[400px] border-b border-slate-800">
        
        {/* The Player Container */}
        <div className="aspect-[9/16] h-[90%] bg-slate-900 border border-slate-700 rounded-lg overflow-hidden relative shadow-2xl ring-1 ring-white/10">
           
           {currentSegment?.videoUrl ? (
             <video 
                ref={videoRef}
                className="w-full h-full object-cover"
                src={currentSegment.videoUrl}
                onEnded={handleVideoEnded}
                controls={false} // Custom controls below
                playsInline
             />
           ) : currentSegment?.imageUrl ? (
             <img 
                src={currentSegment.imageUrl} 
                className="w-full h-full object-cover" 
                alt="Preview" 
             />
           ) : (
             <div className="w-full h-full flex items-center justify-center flex-col gap-2 text-slate-600">
                <AlertCircle size={32}/>
                <span className="text-xs">Media Generating...</span>
             </div>
           )}

            {/* Overlay Status Info */}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur px-2 py-1 rounded text-[10px] font-mono text-white/70">
                SEGMENT {activeIndex + 1}/{segments.length} | {currentSegment?.videoUrl ? "VIDEO" : "IMAGE"}
            </div>
           
           {/* Player Controls Overlay */}
           <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-6 items-center z-20">
              <button 
                onClick={handlePrev}
                className="p-2 bg-black/40 hover:bg-white/20 backdrop-blur rounded-full text-white transition-all"
              >
                <SkipBack size={20}/>
              </button>
              
              <button 
                onClick={togglePlay}
                className={`p-4 rounded-full text-white shadow-lg transition-all transform hover:scale-110 ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/80'}`}
              >
                {isPlaying ? <Pause size={24} fill="currentColor"/> : <Play size={24} fill="currentColor" className="ml-1"/>}
              </button>
              
              <button 
                onClick={handleNext}
                className="p-2 bg-black/40 hover:bg-white/20 backdrop-blur rounded-full text-white transition-all"
              >
                <SkipForward size={20}/>
              </button>
           </div>
        </div>
      </div>

      {/* 2. Timeline Controls (Middle) */}
      <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-10">
         <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span className={isPlaying ? "text-accent animate-pulse" : ""}>
                00:{(activeIndex * 3).toString().padStart(2, '0')}
            </span>
            <span className="text-slate-600">/</span>
            <span>Est. {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}</span>
         </div>
         
         <div className="flex items-center gap-2">
            <button className="p-1.5 text-slate-400 hover:text-white"><Scissors size={14} /></button>
            <div className="w-px h-4 bg-slate-700 mx-2"></div>
            <button className="p-1.5 text-slate-400 hover:text-white"><ZoomOut size={14} /></button>
            <button className="p-1.5 text-slate-400 hover:text-white"><ZoomIn size={14} /></button>
         </div>

         <button className="flex items-center gap-2 text-xs font-bold bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-500 transition-colors">
            <Download size={14} /> Export Timeline
         </button>
      </div>

      {/* 3. Tracks Area (Bottom) */}
      <div className="h-64 bg-slate-900 overflow-x-auto overflow-y-hidden custom-scrollbar relative p-4 select-none">
         
         {/* Time Ruler */}
         <div className="flex h-6 border-b border-slate-800 mb-2 min-w-max">
            {segments.map((_, i) => (
                <div key={i} className="flex-shrink-0 w-32 text-[10px] text-slate-600 border-l border-slate-800 pl-1">
                    {i * 3}s
                </div>
            ))}
            {/* Extra space */}
            <div className="w-96"></div>
         </div>

         {/* Main Video Track */}
         <div className="flex items-center gap-1 min-w-max pb-4">
             {segments.map((seg, idx) => {
                 const isActive = idx === activeIndex;
                 const hasVid = !!seg.videoUrl;
                 
                 return (
                    <div 
                        key={seg.id}
                        onClick={() => handleTimelineClick(idx)}
                        className={`
                            relative group h-32 w-32 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer transition-all duration-200
                            ${isActive ? 'ring-2 ring-accent scale-105 z-10 shadow-xl' : 'border border-slate-700 hover:border-slate-500 opacity-80 hover:opacity-100'}
                        `}
                    >
                        {seg.imageUrl ? (
                            <>
                                <img src={seg.imageUrl} className="w-full h-full object-cover" draggable={false} />
                                {hasVid && (
                                    <div className="absolute top-1 right-1 bg-black/60 p-1 rounded-full text-green-400">
                                        <Film size={12} />
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-500 gap-2">
                                <div className="w-4 h-4 rounded-full border-2 border-slate-600 border-t-transparent animate-spin"></div>
                            </div>
                        )}
                        
                        {/* Segment Label Overlay */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-4">
                            <p className="text-[10px] text-white font-medium truncate">
                                {idx + 1}. {seg.generatedPrompt ? seg.generatedPrompt.substring(0, 15) : "Processing..."}
                            </p>
                        </div>
                    </div>
                 );
             })}
         </div>

         {/* Audio Track Placeholder */}
         <div className="mt-2 h-10 bg-indigo-900/20 border border-indigo-500/20 rounded-lg flex items-center px-4 text-xs text-indigo-400 min-w-[max-content] w-full border-dashed">
            <span className="mr-2">🎵</span> Audio Track (Sync coming soon)
         </div>

      </div>
    </div>
  );
};