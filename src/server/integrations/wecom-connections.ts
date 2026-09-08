import { createHash } from 'node:crypto';
import { createWeComBotConnection, WECOM_BOT_RUNTIME_REVISION, type WeComBotConnection } from '@webpilot/capability-communication/node';
import type { ResolvedExternalIntegration } from './external-integration-vault';

type Connection = { fingerprint: string; integrationId: string; bot: WeComBotConnection };
const connections: Map<string, Connection> = ((globalThis as typeof globalThis & { __orbitWeComConnections?: Map<string, Connection> })
  .__orbitWeComConnections ??= new Map());

export function getWeComConnection(integration: ResolvedExternalIntegration) {
  const { botId, botSecret } = integration.configuration;
  if (!integration.enabled || !botId || !botSecret) throw new Error('请先为此渠道配置 Bot ID 和 Secret，启用机器人连接。');
  const fingerprint = createHash('sha256').update(JSON.stringify([botId, botSecret, WECOM_BOT_RUNTIME_REVISION])).digest('hex');
  const current = connections.get(botId);
  if (current?.fingerprint === fingerprint) return current.bot;
  if (current && current.integrationId !== integration.id) throw new Error('同一机器人的连接凭据不一致，请修改已有渠道。');
  current?.bot.close();
  const bot = createWeComBotConnection({ botId, secret: botSecret });
  connections.set(botId, { fingerprint, integrationId: integration.id, bot });
  return bot;
}

export function closeUnusedWeComConnections(ids: Set<string>) {
  for (const [id, connection] of connections) {
    if (!ids.has(id)) { connection.bot.close(); connections.delete(id); }
  }
}

export function weComConnectionStatus(id: string) { return connections.get(id)?.bot.status; }
