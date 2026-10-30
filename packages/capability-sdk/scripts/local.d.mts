import type { CapabilityRunContext } from '../dist/index.js';
import type { MountedCapabilities } from '../dist/host/index.js';
import type { OpenAIAdapterOptions } from './openai.mjs';
export type LocalToolGroup = 'browser' | 'terminal' | 'code' | 'file' | 'chart' | 'knowledge' | 'media' | 'computer' | 'maps';
export declare function createLocalCapabilities(options?: {
  projectRoot?: string;
  configFile?: string;
  tools?: LocalToolGroup[];
  context?: Partial<CapabilityRunContext>;
}): Promise<{
  snapshot: MountedCapabilities;
  projectRoot: string;
  stateDirectory: string;
  instructions: string;
  resolveImage: NonNullable<OpenAIAdapterOptions['resolveImage']>;
  dispose(): Promise<void>;
}>;
