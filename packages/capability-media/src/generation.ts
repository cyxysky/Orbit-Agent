import type { CapabilityExecutionContext } from '@webpilot/capability-sdk';
import type { MediaArtifact } from './index.ts';
import type { MediaModelKind } from './models.ts';

export type MediaGenerationInput = {
  prompt: string;
  /** Stable configuration id from listModels, not a provider's model id. */
  modelRef?: string;
  sourceRefs?: string[];
  maskRef?: string;
  size?: `${number}x${number}`;
  aspectRatio?: `${number}:${number}`;
  count?: number;
  duration?: number;
  voice?: string;
  outputFormat?: string;
  language?: string;
};
export type MediaGenerationOperations = {
  listModels?(): Promise<Array<{ id: string; kind: MediaModelKind; name: string; model: string; default: boolean }>>;
  generateImage?(input: MediaGenerationInput, context: CapabilityExecutionContext): Promise<MediaArtifact[]>;
  generateVideo?(input: MediaGenerationInput, context: CapabilityExecutionContext): Promise<MediaArtifact[]>;
  generateSpeech?(input: MediaGenerationInput, context: CapabilityExecutionContext): Promise<MediaArtifact[]>;
};
