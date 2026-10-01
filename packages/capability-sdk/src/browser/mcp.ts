import { browserRuntimeSkill } from './runtime-skill.ts';
import { validateBrowserVisualInput } from './interaction-schema.ts';
import { browserSessionCommandShape, executeBrowserSessionOperation, type BrowserSessionCommand } from './node/interaction.ts';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  createCapabilityMcpHandler,
  createCapabilityMcpServer,
  serveCapabilityMcpStdio,
  type CapabilityMcpServerOptions,
} from '../adapters/mcp/index.ts';
import {
  defineCapabilityInput,
  defineCapabilityTool,
  raceWithAbort,
  type CapabilityProvider,
  type CapabilityResult,
  type CapabilityRunContext,
} from '../index.ts';
import { z } from 'zod';
import { browserOperationSummary } from './index.ts';
import {
  BrowserSession,
  type BrowserActionResult,
  type BrowserSessionOptions,
} from './node/browser-session.ts';

const browserSessionId = z.string().uuid();
const browserParser = z.object({
  ...browserSessionCommandShape,
  action: z.enum(['open','close',...browserSessionCommandShape.action.options]),
  browserSessionId: browserSessionId.optional().describe('Required except open. Use the exact id returned by open.'),
}).strict().superRefine((input, ctx) => {
  if (input.action !== 'open' && !input.browserSessionId) ctx.addIssue({code:'custom',path:['browserSessionId'],message:'This action requires browserSessionId from open.'});
  if (input.action === 'code' && !input.code) ctx.addIssue({code:'custom',path:['code'],message:'code requires JavaScript.'});
  validateBrowserVisualInput(input, ctx);
});
const browserInput = defineCapabilityInput(z.toJSONSchema(browserParser), (value) => browserParser.parse(value));
type BrowserObservation = Awaited<ReturnType<BrowserSession['captureBrowserObservation']>>;

type ManagedBrowserSession = {
  runId: string;
  session: BrowserSession;
  stepIndex: number;
  queue: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  closing: boolean;
  observations: Map<string, BrowserObservation>;
};

export type BrowserMcpSessionManagerOptions = {
  maxSessions?: number;
  /** Closes forgotten sessions after inactivity. Set to 0 to disable expiry. */
  idleTimeoutMs?: number;
  sessionOptions?: BrowserSessionOptions;
};

async function browserResult(
  id: string,
  result: BrowserActionResult,
): Promise<CapabilityResult> {
  const data = {
    browserSessionId: id,
    ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data : {result: result.data ?? result.actual}),
    ...(result.manualVerification ? { manualVerification: result.manualVerification, waitingForClient: true } : {}),
    ...(result.browserObservation ? { observation: result.browserObservation } : {}),
  };
  const imagePaths = [...new Set([...(result.referenceImagePaths || []), result.referenceImagePath, result.browserObservation?.path].filter((value): value is string => Boolean(value)))];
  const content = await Promise.all(imagePaths.map(async imagePath => {
    try { return { type: 'image' as const, artifactId: imagePath, mediaType: /\.jpe?g$/i.test(imagePath) ? 'image/jpeg' : /\.webp$/i.test(imagePath) ? 'image/webp' : 'image/png', data: (await readFile(imagePath)).toString('base64') }; }
    catch { return { type: 'text' as const, text: 'Screenshot unavailable. No image pixels were attached for this observation; inspect current state before continuing.' }; }
  }));
  return result.ok
    ? { ok: true, summary: (result.manualVerification ? 'Human verification requested. The MCP client must ask the user to complete verification in the browser, then observe the current state before resuming; this response does not confirm verification.' : browserOperationSummary(result)), data, content }
    : {
        ok: false,
        content,
        error: {
          code: result.failureCategory || 'browser-operation-failed',
          message: browserOperationSummary(result),
          details: data,
        },
      };
}

/** Owns explicit browser session ids so MCP clients never depend on an implicit run id. */
export class BrowserMcpSessionManager {
  readonly #sessions = new Map<string, ManagedBrowserSession>();
  readonly #maxSessions: number;
  readonly #idleTimeoutMs: number;
  #openingSessions = 0;

  constructor(private readonly options: BrowserMcpSessionManagerOptions = {}) {
    const configuredMaxSessions = Number(options.maxSessions ?? 8);
    this.#maxSessions = Number.isFinite(configuredMaxSessions)
      ? Math.max(1, Math.min(100, Math.floor(configuredMaxSessions)))
      : 8;
    const configuredIdleTimeout = Number(options.idleTimeoutMs ?? 15 * 60_000);
    this.#idleTimeoutMs = Number.isFinite(configuredIdleTimeout)
      ? Math.max(0, Math.min(24 * 60 * 60_000, Math.floor(configuredIdleTimeout)))
      : 15 * 60_000;
  }

  async open(inputValue: {url?: string}, abortSignal?: AbortSignal): Promise<CapabilityResult> {
    if (this.#sessions.size + this.#openingSessions >= this.#maxSessions) {
      return {
        ok: false,
        error: {
          code: 'browser-session-capacity-reached',
          message: `This MCP server allows at most ${this.#maxSessions} open browser sessions. Close one before opening another.`,
        },
      };
    }
    this.#openingSessions += 1;
    const id = randomUUID();
    const runId = `mcp-browser-${id}`;
    const session = new BrowserSession({
      headless: true,
      isolated: true,
      ...this.options.sessionOptions,
      runId,
      browserCodeStateSessionId: id,
    });
    try {
      await raceWithAbort(session.start(), abortSignal);
      if (inputValue.url) {
        const result = await session.open(inputValue.url, { abortSignal });
        if (!result.ok) {
          await session.close({ force: true }).catch(() => undefined);
          return browserResult(id, result);
        }
      }
      const managed: ManagedBrowserSession = {
        runId,
        session,
        stepIndex: 0,
        queue: Promise.resolve(),
        closing: false,
        observations: new Map(),
      };
      this.#sessions.set(id, managed);
      this.#armIdleTimer(id, managed);
      const observation = await session.captureBrowserObservation(runId, abortSignal).catch(() => undefined);
      if (observation?.id) managed.observations.set(observation.id, observation);
      const postActionState = await session.readBrowserState({scope:'active', maxOutputChars:4000, abortSignal})
        .catch(() => undefined);
      return browserResult(id, {ok:true, summary: 'Opened browser session ' + id + '.',
        data: {url:session.currentUrl(), postActionState}, ...(observation ? {browserObservation:observation} : {})});
    } catch (error) {
      await session.close({ force: true }).catch(() => undefined);
      return {
        ok: false,
        error: {
          code: 'browser-open-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      this.#openingSessions -= 1;
    }
  }

  async operate(input: z.infer<typeof browserParser>, abortSignal?: AbortSignal): Promise<CapabilityResult> {
    return this.#enqueue(input.browserSessionId!, async managed => {
      managed.stepIndex += 1;
      if (input.action === 'images') {
        const requested = input.imageIds || [];
        const missing = requested.filter(id => !managed.observations.has(id));
        if (missing.length) return {ok:false,error:{code:'browser-image-not-found',message:'Unknown or expired image IDs: '+missing.join(', ')}};
        const latest = [...managed.observations.values()].at(-1);
        const images = [...new Set([...requested, ...(latest?.id ? [latest.id] : [])])].map(id => managed.observations.get(id)!);
        return browserResult(input.browserSessionId!, {ok:true, actual:'Selected browser image evidence; only the latest observation can authorize interaction.',
          data:{observations:images}, referenceImagePaths:images.flatMap(image => image.path ? [image.path] : [])});
      }
      let result = await executeBrowserSessionOperation(managed.session, input as BrowserSessionCommand, {
        mode:'hybrid', runId:managed.runId, stepIndex:managed.stepIndex, abortSignal,
      });
      if (['navigate','tabs'].includes(input.action) && !(input.action === 'tabs' && input.tabOperation === 'list')) {
        const observation = await managed.session.captureBrowserObservation(managed.runId, abortSignal).catch(() => undefined);
        if (observation) result = {...result, browserObservation:observation};
      }
      if (result.browserObservation?.id) {
        managed.observations.set(result.browserObservation.id, result.browserObservation);
        while(managed.observations.size > 12) managed.observations.delete(managed.observations.keys().next().value!);
      }
      return browserResult(input.browserSessionId!, result);
    });
  }

  async close(id: string): Promise<CapabilityResult> {
    const managed = this.#sessions.get(id);
    if (!managed || managed.closing) return this.#missing(id);
    managed.closing = true;
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    managed.idleTimer = undefined;
    await managed.queue;
    if (this.#sessions.get(id) === managed) this.#sessions.delete(id);
    await managed.session.close({ force: true });
    return {
      ok: true,
      summary: `Closed browser session ${id}.`,
      data: { browserSessionId: id, closed: true },
    };
  }

  async dispose() {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    for (const managed of sessions) {
      managed.closing = true;
      if (managed.idleTimer) clearTimeout(managed.idleTimer);
      managed.idleTimer = undefined;
    }
    await Promise.allSettled(sessions.map(async (managed) => {
      await managed.queue;
      await managed.session.close({ force: true });
    }));
  }

  #enqueue(
    id: string,
    operation: (managed: ManagedBrowserSession) => Promise<CapabilityResult>,
  ): Promise<CapabilityResult> {
    const managed = this.#sessions.get(id);
    if (!managed || managed.closing) return Promise.resolve(this.#missing(id));
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    managed.idleTimer = undefined;
    const scheduled = managed.queue.then(() => operation(managed));
    const tail = scheduled.then(() => undefined, () => undefined);
    managed.queue = tail;
    void tail.then(() => {
      if (managed.queue === tail && !managed.closing && this.#sessions.get(id) === managed) {
        this.#armIdleTimer(id, managed);
      }
    });
    return scheduled;
  }

  #armIdleTimer(id: string, managed: ManagedBrowserSession) {
    if (!this.#idleTimeoutMs || managed.closing || this.#sessions.get(id) !== managed) return;
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    managed.idleTimer = setTimeout(() => {
      managed.idleTimer = undefined;
      void this.close(id).catch(() => undefined);
    }, this.#idleTimeoutMs);
    managed.idleTimer.unref?.();
  }

  #missing(id: string): CapabilityResult {
    return {
      ok: false,
      error: {
        code: 'browser-session-not-found',
        message: `Browser session ${id} does not exist or is already closed. Call browser with action="open" first.`,
      },
    };
  }
}

export type BrowserMcpOptions = {
  context?: CapabilityMcpServerOptions['context'];
  configurations?: CapabilityMcpServerOptions['configurations'];
  configStore?: CapabilityMcpServerOptions['configStore'];
  configScope?: CapabilityMcpServerOptions['configScope'];
  skillMode?: CapabilityMcpServerOptions['skillMode'];
  skillToolName?: CapabilityMcpServerOptions['skillToolName'];
  maxSessions?: number;
  idleTimeoutMs?: number;
  sessionOptions?: BrowserSessionOptions | ((context: CapabilityRunContext) => BrowserSessionOptions | Promise<BrowserSessionOptions>);
};

export function createBrowserMcpCapability(options: BrowserMcpOptions = {}): CapabilityProvider {
  const runtimeSkill = {
    id: 'com.webpilot.browser.mcp/runtime',
    title: 'Explicit browser sessions',
    summary: '<system_skill><id>com.webpilot.browser.mcp/runtime</id><title>Explicit browser sessions</title><required>true</required></system_skill>',
    required: true,
    content: 'Inspect returned DOM and actual screenshot images after actions. Use dismissSurface first for selector/menu option surfaces; it clicks (0,0), and closureConfirmed must be checked. Use Close/Cancel buttons first for dialogs. observe returns observationId for act; coordinates use CSS viewport pixels. act supports complete clicks, drags, scrolls, typing and key chords. state reads AX; snapshot reads interactive DOM plus AX. navigate/tabs manage pages through browser controls. images rereads known observations. Only actions listed in this schema are available. Use the browser tool with action="open" first. Pass its exact browserSessionId to every subsequent action. code executes JavaScript with page, browser and nodeRepl. snapshot reads page/tabs without running code. close releases the session. Do not invent or reuse closed session ids.',
  } as const;
  return {
    manifest: {
      schemaVersion: 1,
      id: 'com.webpilot.browser.mcp',
      name: 'Browser MCP sessions',
      version: '0.1.0',
      description: 'Explicit, isolated Playwright browser sessions for MCP clients.',
      permissions: ['browser:launch', 'browser:cdp', 'network:access', 'artifact:write'],
      runtimeRequirements: { node: '>=22.16', patchright: '1.63.0' },
      skills: [browserRuntimeSkill, runtimeSkill],
    },
    async createRuntime(context) {
      const sessionOptions = typeof options.sessionOptions === 'function'
        ? await options.sessionOptions(context)
        : options.sessionOptions;
      const manager = new BrowserMcpSessionManager({
        maxSessions: options.maxSessions,
        idleTimeoutMs: options.idleTimeoutMs,
        sessionOptions: {
          ...sessionOptions,
          configuration: {
            ...context.configuration,
            ...sessionOptions?.configuration,
          },
        },
      });
      return {
        tools: {
          browser: defineCapabilityTool({
            name: 'browser',
            description: 'Browser sessions with open/close, code, state (AX), snapshot (interactive DOM), navigate, tabs, observe, act, images, dismissSurface and waitForHumanVerification. All except open require browserSessionId. Inspect returned postActionState and actual image content. dismissSurface clicks (0,0) for option popups; use explicit Close/Cancel first for dialogs and verify closureConfirmed.',
            input: browserInput,
            execute: (value, execution) => {
              switch (value.action) {
                case 'open': return manager.open(value, execution.abortSignal);
                case 'close': return manager.close(value.browserSessionId!);
                default: return manager.operate(value, execution.abortSignal);
              }
            },
          }),
        },
        health: async () => ({ status: 'healthy' as const }),
        dispose: () => manager.dispose(),
      };
    },
  };
}

function serverOptions(options: BrowserMcpOptions): CapabilityMcpServerOptions {
  return {
    name: 'webpilot-browser',
    version: '0.1.0',
    context: options.context,
    configurations: options.configurations,
    configStore: options.configStore,
    configScope: options.configScope,
    skillMode: options.skillMode,
    skillToolName: options.skillToolName,
    providers: [createBrowserMcpCapability(options)],
  };
}

export function createBrowserMcpServer(options: BrowserMcpOptions = {}) {
  return createCapabilityMcpServer(serverOptions(options));
}

export function createBrowserMcpHandler(options: BrowserMcpOptions = {}) {
  return createCapabilityMcpHandler(serverOptions(options));
}

export function serveBrowserMcpStdio(options: BrowserMcpOptions = {}) {
  return serveCapabilityMcpStdio(serverOptions(options));
}
