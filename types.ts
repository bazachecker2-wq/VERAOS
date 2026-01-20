
// Global type augmentations for Speech Recognition API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
  interface Navigator {
    connection?: {
      effectiveType: string;
      rtt: number;
      downlink: number;
      saveData: boolean;
      addEventListener: (type: string, listener: any) => void;
      removeEventListener: (type: string, listener: any) => void;
    };
  }
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackedObject {
  id: string | number; 
  class: string; 
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  position3D: Vector3; 
  distance: number; 
  lastSeen: number;
  isRemote?: boolean; 
  remoteUser?: string;
  // Deep Analysis Fields
  scanProgress?: number; // 0 to 1
  isAnalyzed?: boolean;
  codeName?: string; // e.g. "TARGET-ALPHA"
  analysisData?: string; // Summary of parts/deduction
  // Visual State
  isOccluded?: boolean;
  isSelected?: boolean; // New field for active selection
  // Sensor Data
  depthSource?: 'AI_ESTIMATE' | 'LIDAR_FUSION';
  // Gesture Data
  gesture?: string;
}

export interface AiAnnotation {
  id: string;
  x: number; // 0-1 center relative
  y: number; // 0-1 center relative
  label: string;
  timestamp: number;
}

export interface ZoomState {
  level: number;
  x: number; // 0-100% origin
  y: number; // 0-100% origin
}

export interface LogEntry {
  id: number;
  time: string;
  type: 'info' | 'detect' | 'action' | 'ai' | 'sys' | 'net' | 'deduction';
  message: string;
}

export interface TranscriptItem {
  id: number;
  text: string;
  isAi?: boolean;
  timestamp: number;
  user?: string;
}

export type SystemStatus = 'ЗАГРУЗКА' | 'ГОТОВ' | 'СЛЕЖЕНИЕ' | 'АНАЛИЗ' | 'ОШИБКА' | 'СЕТЬ' | 'СТАБИЛИЗАЦИЯ';

export type ViewMode = 'ar' | 'avatar';
export type AnalysisMode = 'AUTO' | 'DETAILED' | 'SILENT';

export type AvatarAction = 'IDLE' | 'TALKING' | 'LISTENING' | 'WAVE' | 'REACT_POS' | 'REACT_NEG';

// Network Types
export interface NetworkPacket {
  type: 'HANDSHAKE' | 'TELEMETRY' | 'CHAT';
  userId: string;
  payload: any;
  timestamp: number;
}

export interface ConnectedUser {
  id: string;
  name: string;
  status: 'online' | 'offline';
  lastPing: number;
  color: string;
}

export interface CameraDevice {
    deviceId: string;
    label: string;
}

export interface TooltipState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
}
