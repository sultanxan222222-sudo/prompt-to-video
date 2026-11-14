export interface GenerationRecord {
  id: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  durationSeconds: number;
  guidanceScale: number;
  seedUsed: number;
  videoUrl: string;
  createdAt: number;
}

export const ASPECT_PRESETS = {
  landscape: { label: "Альбомный 16:9", width: 768, height: 432 },
  portrait: { label: "Вертикальный", width: 512, height: 704 },
  square: { label: "Квадратный", width: 576, height: 576 },
} as const;

export type AspectKey = keyof typeof ASPECT_PRESETS;
