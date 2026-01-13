
export interface Prediction {
  className: string;
  probability: number;
}

export interface ModelMetadata {
  classes: string[];
}

export interface FeedbackHistory {
  timestamp: number;
  originalLabel: string;
  correctedLabel: string;
  type: 'CORRECTION' | 'CONFIRMATION';
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING_MODEL = 'LOADING_MODEL',
  READY = 'READY',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR'
}
