import { createHash } from 'node:crypto';
import { browserInteractionSkill } from './runtime-browser-interaction';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import type { CapabilitySkill } from '@cjfclonedeep/capability-sdk';
import { browserCapabilityManifest } from '@cjfclonedeep/capability-sdk/browser';
import { fileCapabilityManifest } from '@cjfclonedeep/capability-sdk/file';
import { chartCapabilityManifest } from '@cjfclonedeep/capability-sdk/chart';
import { mapsCapabilityManifest } from '@cjfclonedeep/capability-sdk/maps';
import { codeSandboxCapabilityManifest } from '@cjfclonedeep/capability-sdk/execution/code';
import { communicationCapabilityManifest } from '@cjfclonedeep/capability-sdk/integrations/communication';
import { computerCapabilityManifest } from '@cjfclonedeep/capability-sdk/computer';
import { connectorsCapabilityManifest } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { dataCapabilityManifest } from '@cjfclonedeep/capability-sdk/data';
import { terminalCapabilityManifest } from '@cjfclonedeep/capability-sdk/execution/terminal';
import { knowledgeCapabilityManifest } from '@cjfclonedeep/capability-sdk/knowledge';
import { mediaCapabilityManifest } from '@cjfclonedeep/capability-sdk/media';
import { novelCapabilityManifest } from '@cjfclonedeep/capability-sdk/novel';
import { subagentRuntimeSkill } from './subagent-runtime-skill';
import { fileToolSourceOutputMarker } from './browser-chat-file-model-output';

function manifestRuntimeSkill(manifest: { id: string; skills?: readonly CapabilitySkill[] }) {
  const skill = manifest.skills?.[0];
  if (!skill) throw new Error(`Capability ${manifest.id} does not export a runtime Skill.`);
  return skill;
}

const browserRuntimeSkill = browserInteractionSkill;
const capabilityRuntimeSkills = [
  browserCapabilityManifest,
  fileCapabilityManifest,
  chartCapabilityManifest,
  mapsCapabilityManifest,
  codeSandboxCapabilityManifest,
  connectorsCapabilityManifest,
  knowledgeCapabilityManifest,
  dataCapabilityManifest,
  mediaCapabilityManifest,
  novelCapabilityManifest,
  communicationCapabilityManifest,
  terminalCapabilityManifest,
  computerCapabilityManifest,
].flatMap((manifest) => {
  manifestRuntimeSkill(manifest);
  return manifest.id === browserCapabilityManifest.id ? [browserInteractionSkill, ...manifest.skills!.slice(1)] : manifest.skills!;
});

// These capability tools are always visible to the model. Skill enforcement is
// owned by the Agent runtime below, not by the capability packages themselves.
const defaultVisibleCapabilityToolNames: ReadonlySet<string> = new Set(
  capabilityRuntimeSkills.flatMap((skill) => (skill.activation || []).map((activation) => activation.toolName)),
);

type HiddenRuntimeSkillPolicy = {
  skillId: string;
  requires: (input: unknown) => boolean;
};

function actionFromInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const action = (input as Record<string, unknown>).action;
  return typeof action === 'string' ? action : undefined;
}

const hiddenRuntimeSkills: Readonly<Record<string, CapabilitySkill>> = Object.freeze(Object.fromEntries([
  ...capabilityRuntimeSkills,
  subagentRuntimeSkill,
].map((skill) => [skill.id, skill])));

export const hiddenRuntimeSkillPolicies: Readonly<Record<string, HiddenRuntimeSkillPolicy>> = Object.freeze(
  Object.fromEntries(Object.values(hiddenRuntimeSkills).flatMap((skill) => (
    (skill.activation || []).map((activation) => [activation.toolName, {
      skillId: skill.id,
      requires: activation.actions?.length
        ? (input: unknown) => activation.actions!.includes(actionFromInput(input) || '')
        : () => true,
    } satisfies HiddenRuntimeSkillPolicy])
  ))),
);

export function activeBrowserRuntimeSkillId() {
  return browserRuntimeSkill.id;
}

export function hiddenRuntimeSkillIds() {
  return Object.keys(hiddenRuntimeSkills);
}

export function hiddenRuntimeSkillContent(skillId: string) {
  return hiddenRuntimeSkills[skillId as keyof typeof hiddenRuntimeSkills]?.content;
}

export function hiddenRuntimeToolCatalog() {
  return toolCatalogFromSkills(Object.values(hiddenRuntimeSkills));
}

export function capabilityRuntimeToolCatalog() {
  return toolCatalogFromSkills(capabilityRuntimeSkills);
}

function toolCatalogFromSkills(skills: readonly CapabilitySkill[]) {
  return skills.flatMap((skill) => (skill.activation || []).map((activation) => ({
    name: activation.toolName,
    label: skill.summary.match(/<title>([\s\S]*?)<\/title>/)?.[1] || activation.toolName,
    description: skill.summary.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '',
  })));
}

function runtimeSkillResultRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    const text = value;
    try { value = JSON.parse(text); } catch {
      // readSource separates its JSON metadata from the exact fenced program.
      const firstLineEnd = text.indexOf('\n');
      if (firstLineEnd < 0 || !text.startsWith(fileToolSourceOutputMarker, firstLineEnd)) return undefined;
      try { value = JSON.parse(text.slice(0, firstLineEnd)); } catch { return undefined; }
      const actual = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).actual : undefined;
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)
        || (actual as Record<string, unknown>).readKind !== 'source') return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Reuse only full, current-version Skill text still present in tool evidence.
 * A summary, user assertion or previous read ID is not sufficient after compaction. */
export function hiddenRuntimeSkillIdsInModelContext(messages: ReadonlyArray<{ role: string; content: unknown }>) {
  const loaded = new Set<string>();
  const record = runtimeSkillResultRecord;
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type !== 'tool-result') continue;
      const output = record(part.output);
      const result = record(output?.value);
      if (!result) continue;
      if (part.toolName === 'skill' && result.ok === true) {
        for (const [id, skill] of Object.entries(hiddenRuntimeSkills)) {
          if (result.actual === skill.content) loaded.add(id);
        }
      }
      const gate = record(result.actual);
      if (result.ok === false && gate?.code === 'RUNTIME_SKILL_CONTENT_RETURNED'
        && typeof gate.requiredSkillId === 'string'
        && gate.skillContent === hiddenRuntimeSkillContent(gate.requiredSkillId)
        && typeof gate.skillContent === 'string') loaded.add(gate.requiredSkillId);
      const receipt = record(result.runtimeSkill);
      if (receipt?.readSatisfied === true && typeof receipt.skillId === 'string'
        && typeof receipt.content === 'string'
        && receipt.content === hiddenRuntimeSkillContent(receipt.skillId)) loaded.add(receipt.skillId);
    }
  }
  return loaded;
}

/** Preservation is independent of execution eligibility. An older Skill body
 * is still an exact read receipt, even when it no longer satisfies the current
 * version gate. User Skills must not depend on membership in the system catalog. */
export function skillBodyKeysForPreservation(messages: ReadonlyArray<{ role: string; content: unknown }>) {
  const record = runtimeSkillResultRecord;
  const calls = new Map<string, string>();
  for (const message of messages) if (message.role === 'assistant' && Array.isArray(message.content)) {
    for (const part of message.content) {
      const input = record(part.input);
      if (part.type === 'tool-call' && part.toolName === 'skill' && typeof input?.skillId === 'string') calls.set(part.toolCallId, input.skillId);
    }
  }
  const ids = new Set<string>();
  const add = (id: string, body: string) => ids.add(`${id}:${createHash('sha256').update(body).digest('hex')}`);
  for (const message of messages) if (['assistant', 'tool'].includes(message.role) && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      const result = record(record(part.output)?.value), actual = record(result?.actual);
      if (part.toolName === 'skill' && result?.ok === true && typeof result.actual === 'string' && result.actual.trim()) {
        const id = calls.get(part.toolCallId) || (typeof actual?.skillId === 'string' ? actual.skillId : undefined);
        if (id) add(id, typeof actual?.content === 'string' ? actual.content : result.actual);
      }
      if (result?.ok === false && actual?.code === 'RUNTIME_SKILL_CONTENT_RETURNED'
        && typeof actual.requiredSkillId === 'string' && typeof actual.skillContent === 'string' && actual.skillContent.trim()) add(actual.requiredSkillId, actual.skillContent);
      const receipt = record(result?.runtimeSkill);
      if (receipt?.readSatisfied === true && typeof receipt.skillId === 'string'
        && typeof receipt.content === 'string' && receipt.content.trim()) add(receipt.skillId, receipt.content);
    }
  }
  return ids;
}

export function requiredHiddenRuntimeSkillId(
  toolName: string,
  input: unknown,
) {
  const policy = hiddenRuntimeSkillPolicies[toolName];
  if (!policy?.requires(input)) return undefined;
  return policy.skillId;
}

export function requireHiddenRuntimeSkillRead(
  toolName: string,
  input: unknown,
  loadedSkillIds: Set<string>,
): BrowserActionResult | undefined {
  const requiredSkillId = requiredHiddenRuntimeSkillId(toolName, input);
  if (!requiredSkillId || loadedSkillIds.has(requiredSkillId)) return undefined;
  const skillContent = hiddenRuntimeSkillContent(requiredSkillId);
  // Available instructions accompany the actual operation's result. Only a
  // missing registration prevents execution; an unread Skill does not.
  if (skillContent) return undefined;
  return {
    ok: false,
    actual: JSON.stringify({
      ok: false,
      code: 'RUNTIME_SKILL_READ_REQUIRED',
      error: `Required runtime Skill ${requiredSkillId} is unavailable. Restore its registration before calling ${toolName}. The governed operation was not executed.`,
      requiredSkillId,
    }, null, 2),
    failureCategory: 'skill-read-required',
    requiredSkillId,
  };
}

export function hiddenRuntimeSkillForToolCall(
  toolName: string,
  input: unknown,
  loadedSkillIds: ReadonlySet<string>,
): BrowserActionResult['runtimeSkill'] {
  const skillId = requiredHiddenRuntimeSkillId(toolName, input);
  if (!skillId || loadedSkillIds.has(skillId)) return undefined;
  const content = hiddenRuntimeSkillContent(skillId);
  return content ? { skillId, content, readSatisfied: true } : undefined;
}

export function runtimeToolTypesWithLoadedSkills(
  toolTypes: readonly string[],
  loadedSkillIds: ReadonlySet<string>,
) {
  return toolTypes.filter((toolName) => {
    if (defaultVisibleCapabilityToolNames.has(toolName)) return true;
    const policy = hiddenRuntimeSkillPolicies[toolName];
    return !policy || loadedSkillIds.has(policy.skillId) || Boolean(hiddenRuntimeSkillContent(policy.skillId));
  });
}
