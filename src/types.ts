
export interface MathSolution {
  text: string;
  steps?: string[];
  finalAnswer?: string;
}

export enum LoadingState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  SOLVING = 'SOLVING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

export interface UploadedImage {
  file: File;
  previewUrl: string;
  base64: string;
}

export interface SavedProblem {
  id: string;
  title: string;       // Usually the first few chars of the question
  questionText: string;
  solutionHtml: string;
  tags: string[];
  isFavorite: boolean;
  timestamp: number;
}
