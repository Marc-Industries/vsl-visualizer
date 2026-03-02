export type ActiveTab = 'workflow' | 'editor' | 'settings' | 'bridge';

export interface BridgeScene {
  sceneIndex: number;
  status: 'pending' | 'processing' | 'image_ready' | 'generating_video' | 'video_ready' | 'error';
  imageUrl?: string;
  videoUrl?: string;
  prompt?: string;
  jobId?: string;
  isMaster?: boolean;
}

export interface TimelineSegment {
  id: string;
  startTime: number;
  endTime: number;
  originalText: string;
  generatedPrompt?: string;
  imageUrl?: string; // Base64 data URI
  videoUrl?: string; // Blob URL or Remote URI
  isProcessingPrompt: boolean;
  isProcessingImage: boolean;
  isProcessingVideo: boolean;
  jobId?: string;
  error?: string;
}

export interface AgentConfig {
  intervalSeconds: number;
  systemInstruction: string;
  kieApiKey?: string;
  webhookUrl?: string;
  avatarUrl?: string;   // Base64 data URI or external URL
  productUrl?: string;  // Base64 data URI or external URL
}

export enum FlowStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type Language = 'it' | 'en';

export type PipelineMode = 'AVATAR' | 'STANDARD';
export type InputMode = 'SRT' | 'PROMPTS';

export interface SrtEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}
