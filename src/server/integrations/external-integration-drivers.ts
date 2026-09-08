import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { createMcpStreamableHttpConnector } from '@webpilot/capability-connectors/node';
import type { AgentConnector } from '@webpilot/capability-connectors';
import type { AgentDataSource } from '@webpilot/capability-data';
import { createTypeOrmAgentDataSource } from '@webpilot/capability-data/typeorm';
import {
  createConnectorCommunicationChannel,
  createJsonWebhookChannel,
  createWeComMessageArguments,
  validateWeComMessageContent,
} from '@webpilot/capability-communication/node';
import type { CommunicationChannel, CommunicationDraft, CommunicationMediaOperations, CommunicationReceipt } from '@webpilot/capability-communication';
import { CommunicationDeliveryError } from '@webpilot/capability-communication';
import { getWeComConnection, weComConnectionStatus } from './wecom-connections';
import { listCommunicationConversations } from '@/server/storage/communication-conversation-store';
import type {
  ExternalIntegrationCategory,
  ExternalIntegrationConfiguration,
  ResolvedExternalIntegration,
} from './external-integration-vault';

export type ExternalIntegrationFieldDescriptor = {
  key: string;
  label: string;
  description?: string;
  control: 'text' | 'password' | 'url' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  hidden?: boolean;
  defaultValue?: string;
  options?: Array<{ label: string; value: string }>;
  visibleWhen?: { field: string; value: string };
  picker?: 'file';
};

export type ExternalIntegrationDriverDescriptor = {
  id: string;
  category: ExternalIntegrationCategory;
  label: string;
  description: string;
  testLabel: string;
  testHint?: string;
  fields: ExternalIntegrationFieldDescriptor[];
};

export type ExternalIntegrationPublicSummary = {
  id: string;
  category: ExternalIntegrationCategory;
  driverId: string;
  name: string;
  detailPreview: string;
  configuredFields: string[];
  publicConfiguration: ExternalIntegrationConfiguration;
  enabled: boolean;
  updatedAt: string;
};

export type ExternalIntegrationTestTarget = { kind: 'user' | 'group'; id: string; name?: string; lastMessageTime?: string };

export type ExternalIntegrationTestResult =
  | { kind: 'available-targets'; targets: ExternalIntegrationTestTarget[] }
  | { kind: 'operations'; operationCount: number; operations: string[] }
  | { kind: 'delivered'; deliveryCount: number }
  | { kind: 'target-discovered'; target: { kind: 'user' | 'group'; id: string }; targetBinding: string }
  | { kind: 'data-source'; tableCount: number; tables: string[] };

export type ExternalIntegrationTestProgress = {
  stage: 'connecting' | 'connected' | 'authenticated' | 'verifying';
};


type ExternalIntegrationDriver = ExternalIntegrationDriverDescriptor & {
  normalize(configuration: ExternalIntegrationConfiguration): ExternalIntegrationConfiguration;
  summarize(configuration: ExternalIntegrationConfiguration): string;
  createConnector?(integration: ResolvedExternalIntegration, timeoutMs: number): AgentConnector;
  createChannel?(integration: ResolvedExternalIntegration, timeoutMs: number, readArtifact?: CommunicationMediaOperations['readArtifact']): CommunicationChannel;
  createDataSource?(integration: ResolvedExternalIntegration, timeoutMs: number): Promise<AgentDataSource>;
  test(
    integration: ResolvedExternalIntegration,
    timeoutMs: number,
    abortSignal?: AbortSignal,
    onProgress?: (progress: ExternalIntegrationTestProgress) => void,
    selectedTarget?: Pick<ExternalIntegrationTestTarget, 'kind' | 'id'>,
  ): Promise<ExternalIntegrationTestResult>;
};

function httpEndpoint(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`请输入有效的${label}。`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${label}仅支持 HTTP 或 HTTPS。`);
  if (url.username || url.password) throw new Error(`${label}不能包含用户名或密码。`);
  return url.href;
}

function endpointPreview(endpoint: string) {
  const url = new URL(endpoint);
  const hiddenPath = url.pathname && url.pathname !== '/' ? '/••••' : '';
  return `${url.protocol}//${url.host}${hiddenPath}`;
}

function authenticationConfiguration(configuration: ExternalIntegrationConfiguration): ExternalIntegrationConfiguration {
  const authentication = configuration.authentication || 'none';
  if (authentication !== 'none' && authentication !== 'bearer') throw new Error('不支持所选认证方式。');
  const token = configuration.token?.trim();
  if (authentication === 'bearer' && !token) throw new Error('使用 Bearer Token 时必须填写访问令牌。');
  return authentication === 'bearer' ? { authentication: 'bearer', token: token! } : { authentication: 'none' };
}

function authorizationHeader(configuration: ExternalIntegrationConfiguration) {
  return configuration.authentication === 'bearer' && configuration.token
    ? { authorization: `Bearer ${configuration.token}` }
    : undefined;
}

function accessConfiguration(configuration: ExternalIntegrationConfiguration) {
  const access = configuration.access || 'read-only';
  if (access !== 'read-only' && access !== 'read-write') throw new Error('不支持所选数据访问权限。');
  return access;
}

function boundedPort(value: string, fallback: number) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('请输入 1 到 65535 之间的数据库端口。');
  return port;
}

function requiredText(value: string | undefined, label: string, maximum = 500) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`请输入${label}。`);
  if (normalized.length > maximum) throw new Error(`${label}过长。`);
  return normalized;
}

function resultRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function decodedOperationResultValues(value: unknown, depth = 0): unknown[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => decodedOperationResultValues(item, depth + 1));
  const record = resultRecord(value);
  if (!record) return [value];
  const values: unknown[] = [record];
  if (record.type === 'text' && typeof record.text === 'string') {
    try {
      values.push(...decodedOperationResultValues(JSON.parse(record.text), depth + 1));
    } catch {
      values.push(record.text.trim());
    }
  }
  for (const key of ['content', 'structuredContent', 'data', 'result', 'response', 'receipt', 'output']) {
    if (record[key] !== undefined) values.push(...decodedOperationResultValues(record[key], depth + 1));
  }
  return values;
}

function compactOperationResult(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 1_000);
  } catch {
    return String(value).slice(0, 1_000);
  }
}

function verifyWeComMessageSendResult(result: unknown) {
  let accepted = false;
  for (const value of decodedOperationResultValues(result)) {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['ok', 'success', 'sent', 'message sent successfully', '发送成功', '消息发送成功'].includes(normalized)) {
        accepted = true;
      }
      continue;
    }
    const record = resultRecord(value);
    if (!record) continue;
    if (Object.prototype.hasOwnProperty.call(record, 'errcode')) {
      const errcode = Number(record.errcode);
      if (Number.isFinite(errcode) && errcode !== 0) {
        const detail = String(record.errmsg || record.message || '未知错误');
        if (/media[_\s-]?id/i.test(detail)) {
          throw new CommunicationDeliveryError(`企业微信拒绝了媒体标识（errcode ${errcode}）：${detail}。请核对上传接口与发送接口是否属于同一协议和机器人，不能依据 ID 外观断定其真假。`, 'not-sent');
        }
        if (/chat[_\s-]?id|openid/i.test(detail)) {
          throw new CommunicationDeliveryError(`企业微信拒绝了所选会话（errcode ${errcode}）：${detail}。请确认消息 MCP 地址已获得发送权限，刷新接收会话列表后重新选择。`, 'not-sent');
        }
        throw new CommunicationDeliveryError(`企业微信拒绝发送（errcode ${errcode}）：${detail}`, 'not-sent');
      }
      if (errcode === 0) accepted = true;
    }
    if (record.ok === false || record.success === false || record.accepted === false) {
      throw new CommunicationDeliveryError(`企业微信拒绝发送：${String(record.errmsg || record.message || record.error || '未知错误')}`, 'not-sent');
    }
    if (record.ok === true || record.success === true || record.accepted === true) accepted = true;
    if (['msgid', 'message_id', 'messageId', 'delivery_id', 'deliveryId'].some((key) => {
      const identifier = record[key];
      return (typeof identifier === 'string' || typeof identifier === 'number') && String(identifier).trim() !== '';
    })) accepted = true;
  }
  if (!accepted) {
    throw new Error(`企业微信 MCP 未返回可验证的发送回执，不能确认消息已送达。原始返回：${compactOperationResult(result)}`);
  }
}

const weComMessageOperationId = 'message_aibot_send';
const weComSessionsOperationId = 'message_aibot_sessions_list';

function assertWeComOperationSucceeded(result: unknown, label: string) {
  const root = resultRecord(result);
  if (root?.isError === true) {
    const text = Array.isArray(root.content)
      ? root.content.flatMap((item) => {
        const entry = resultRecord(item);
        return typeof entry?.text === 'string' ? [entry.text.trim()] : [];
      }).filter(Boolean).join('\n')
      : '';
    throw new Error(`${label}失败：${text || String(root.message || root.error || '未知错误')}`);
  }
  for (const value of decodedOperationResultValues(result)) {
    const record = resultRecord(value);
    if (!record || !Object.prototype.hasOwnProperty.call(record, 'errcode')) continue;
    const errcode = Number(record.errcode);
    if (Number.isFinite(errcode) && errcode !== 0) {
      throw new Error(`${label}失败（errcode ${errcode}）：${String(record.errmsg || record.message || '未知错误')}`);
    }
  }
}

function weComRecentSessions(result: unknown) {
  assertWeComOperationSucceeded(result, '获取企业微信最近会话');
  for (const value of decodedOperationResultValues(result)) {
    const record = resultRecord(value);
    if (!record || !Array.isArray(record.sessions)) continue;
    return record.sessions.flatMap((item) => {
      const session = resultRecord(item);
      const id = typeof session?.chat_id === 'string' ? session.chat_id.trim() : '';
      const kind = session?.chat_type === 'group'
        ? 'group' as const
        : session?.chat_type === 'single'
          ? 'user' as const
          : undefined;
      if (!session || !id || !kind) return [];
      const name = typeof session.chat_name === 'string' ? session.chat_name.trim() : '';
      const lastMessageTime = typeof session.last_msg_time === 'string' ? session.last_msg_time.trim() : '';
      return [{ kind, id, ...(name ? { name } : {}), ...(lastMessageTime ? { lastMessageTime } : {}) }];
    });
  }
  throw new Error('企业微信最近会话接口没有返回 sessions 列表。');
}

async function resolveWeComTargets(
  connector: AgentConnector,
  targets: readonly { kind: string; id: string; name?: string }[],
  context: Parameters<AgentConnector['call']>[2],
) {
  const result = await connector.call(weComSessionsOperationId, {}, context);
  const sessions = weComRecentSessions(result);
  if (!sessions.length) {
    throw new Error('企业微信最近会话列表为空。请先给机器人发送一条消息，群聊中需要先 @机器人。');
  }
  return targets.map((target) => {
    const expectedKind = target.kind === 'group' ? 'group' : 'user';
    const matches = sessions.filter((item) => item.kind === expectedKind && item.id === target.id);
    if (matches.length !== 1) {
      throw new Error('接收会话已不在当前可发送列表中，或存在多个匹配。请刷新会话列表并重新选择。');
    }
    return matches[0];
  });
}

function weComTargetBinding(input: {
  endpoint: string;
  target: { kind: 'user' | 'group'; id: string };
}) {
  return createHash('sha256')
    .update(`${input.endpoint}\0${input.target.kind}\0${input.target.id}`)
    .digest('hex');
}

function verifiedWeComTarget(configuration: ExternalIntegrationConfiguration) {
  const id = configuration.defaultTarget?.trim();
  if (!id) return undefined;
  const kind = configuration.defaultTargetKind === 'group' ? 'group' as const : 'user' as const;
  const expectedBinding = weComTargetBinding({
    endpoint: configuration.endpoint,
    target: { kind, id },
  });
  return configuration.defaultTargetBinding === expectedBinding ? { kind, id } : undefined;
}

async function weComBotTargets(integration: ResolvedExternalIntegration) {
  const conversations = await listCommunicationConversations(integration.id, integration.configuration.botId);
  return [...new Map(conversations.map(({ target }) => [`${target.kind}:${target.id}`, {
    ...target, transport: 'wecom-websocket', name: `${target.kind === 'group' ? '群聊' : '单聊'} · ${target.id}（可上传附件）`,
  }])).values()];
}

function createWeComWebSocketChannel(integration: ResolvedExternalIntegration, readArtifact?: CommunicationMediaOperations['readArtifact']): CommunicationChannel {
  return {
    id: integration.id, name: integration.name, driverId: 'wecom-aibot-websocket',
    capabilities: {
      targetKinds: ['user', 'group'], contentFormats: ['text', 'markdown', 'image', 'file', 'voice', 'video'],
      mediaSources: readArtifact ? ['artifactId', 'mediaId'] : ['mediaId'],
      requiresExplicitTargets: true,
      mediaConfigurationHint: '媒体通过同一机器人长连接上传和发送；mediaId 仅接受该机器人的长连接上传结果，不接受 MCP 媒体标识。',
    },
    validateContent: validateWeComMessageContent,
    listTargets: () => weComBotTargets(integration),
    async health() {
      try { await getWeComConnection(integration).ready(); return { status: 'healthy' }; }
      catch { return { status: 'unhealthy', message: '机器人长连接不可用。' }; }
    },
    async send(draft, context) {
      let attempted = false;
      let accepted = false;
      try {
        validateWeComMessageContent(draft.content);
        const requested = draft.targets;
        const available = await weComBotTargets(integration);
        const targets = [...new Map(requested.map(target => [`${target.kind}:${target.id}`, target])).values()];
        if (!targets.length) throw new Error('请从渠道 availableTargets 选择支持上传附件的接收对象。');
        if (targets.some(target => !available.some(item => item.kind === target.kind && item.id === target.id))) {
          throw new Error('接收对象不在此机器人的长连接会话记录中。请让接收者给机器人发消息，再从 availableTargets 选择支持上传附件的会话。');
        }
        const bot = getWeComConnection(integration);
        const uploads: Array<{ artifactId?: string; mediaId: string; transport: string }> = [];
        const args = await createWeComMessageArguments({
          content: draft.content, target: targets[0], context,
          media: readArtifact ? {
            readArtifact,
            async upload(file, format, execution) {
              const mediaId = await bot.upload(file, format, execution);
              uploads.push({ artifactId: 'artifactId' in draft.content ? draft.content.artifactId : undefined, mediaId, transport: 'aibot_upload_media_init/chunk/finish' });
              return mediaId;
            },
          } : undefined,
        }).catch((error: unknown) => {
          const result = resultRecord(error);
          const detail = error instanceof Error ? error.message : String(result?.errmsg || '读取或上传失败');
          throw new Error(`企业微信准备消息失败${result?.errcode === undefined ? '' : `（errcode ${result.errcode}）`}：${detail}。尚未调用发送接口。`);
        });
        const deliveries = [];
        for (const target of targets) {
          context.abortSignal?.throwIfAborted();
          try {
            attempted = true;
            const result = 'body' in draft.content
              ? await bot.sendText(target.id, (args.markdown as { content: string }).content)
              : await bot.sendMedia(target.id, draft.content.format,
                (args[draft.content.format] as { media_id: string }).media_id,
                args[draft.content.format] as { title?: string; description?: string });
            accepted = true;
            deliveries.push({ target, result });
          } catch (error) {
            const result = resultRecord(error);
            const detail = error instanceof Error ? error.message : String(result?.errmsg || '发送失败');
            throw new CommunicationDeliveryError(`企业微信长连接发送失败${result?.errcode === undefined ? '' : `（errcode ${result.errcode}）`}：${detail}。${uploads.length ? '文件已通过官方长连接上传并取得 media_id；失败发生在发送阶段。' : ''}`,
              error instanceof CommunicationDeliveryError ? error.outcome : 'unknown', { cause: error });
          }
        }
        return {
          channelId: integration.id, acceptedAt: new Date().toISOString(),
          deliveryIds: deliveries.map(({ result }) => result.headers?.req_id).filter((id): id is string => Boolean(id)),
          details: { transport: 'wecom-websocket', uploads, deliveries },
        };
      } catch (error) {
        throw new CommunicationDeliveryError(error instanceof Error ? error.message : String(error),
          accepted ? 'unknown' : !attempted || (error instanceof CommunicationDeliveryError && error.outcome === 'not-sent') ? 'not-sent' : 'unknown',
          { cause: error });
      }
    },
  };
}

function createWeComAiBotChannel(
  integration: ResolvedExternalIntegration,
  timeoutMs: number,
  existingConnector?: AgentConnector,
  readArtifact?: CommunicationMediaOperations['readArtifact'],
): CommunicationChannel {
  const connector = existingConnector || createMcpStreamableHttpConnector({
    id: integration.id,
    name: integration.name,
    url: integration.configuration.endpoint,
    timeoutMs,
  });
  const defaultTarget = verifiedWeComTarget(integration.configuration);
  const remote = createConnectorCommunicationChannel({
    id: integration.id,
    name: integration.name,
    driverId: 'wecom-aibot-mcp',
    connector,
    operationId: weComMessageOperationId,
    requiredOperationIds: [weComSessionsOperationId],
    capabilities: {
      targetKinds: ['user', 'group'],
      contentFormats: ['text', 'markdown', 'image', 'file', 'voice', 'video'],
      mediaSources: ['mediaId'],
      mediaConfigurationHint: '在此渠道配置同一机器人的 Bot ID 和 Secret，即可通过官方长连接上传媒体；无需 HTTP 上传地址。',
    },
    validateContent: validateWeComMessageContent,
    defaultTargets: defaultTarget ? [defaultTarget] : [],
    resolveTargets(targets, _draft, context) {
      return resolveWeComTargets(connector, targets, context);
    },
    mapArguments(draft, target, context) {
      return createWeComMessageArguments({ content: draft.content, target, context });
    },
    verifyResult(result) {
      verifyWeComMessageSendResult(result);
    },
  });
  const native = integration.configuration.botId && integration.configuration.botSecret
    ? createWeComWebSocketChannel(integration, readArtifact) : undefined;
  return {
    ...remote,
    capabilities: {
      ...remote.capabilities,
      mediaSources: native?.capabilities.mediaSources || remote.capabilities.mediaSources,
      mediaConfigurationHint: '从企微拉取的会话使用消息 MCP 发送。上传 artifactId 请选择 availableTargets 中支持上传附件的会话；复制其 transport 和 id。收到消息后的附件回复通过机器人长连接发送。',
    },
    async listTargets() {
      const result = await connector.call(weComSessionsOperationId, {}, { invocationId: `wecom-sessions-${randomUUID()}` });
      const targets = weComRecentSessions(result).map(target => ({ ...target, transport: 'wecom-mcp' }));
      return [...targets, ...(native ? await weComBotTargets(integration) : [])];
    },
    async send(draft, context) {
      const targets: CommunicationDraft['targets'] = draft.targets.length ? draft.targets : defaultTarget ? [defaultTarget] : [];
      const groups = new Map<string, CommunicationDraft['targets']>();
      for (const target of targets) {
        const transport = target.transport || 'wecom-mcp';
        if (transport !== 'wecom-mcp' && (transport !== 'wecom-websocket' || !native)) {
          throw new CommunicationDeliveryError('接收对象的发送方式不可用，请重新读取 availableTargets。', 'not-sent');
        }
        const group = groups.get(transport) || [];
        group.push(target); groups.set(transport, group);
      }
      if (!groups.size) throw new CommunicationDeliveryError('请先选择接收会话。', 'not-sent');
      if (groups.has('wecom-mcp') && 'artifactId' in draft.content && draft.content.artifactId) {
        throw new CommunicationDeliveryError('此接收会话通过消息 MCP 发送，不能使用长连接上传的附件。请从 availableTargets 选择支持上传附件的会话；若尚未出现，请先向机器人发送消息。', 'not-sent');
      }
      const receipts: CommunicationReceipt[] = [];
      try {
        for (const [transport, group] of groups) {
          receipts.push(await (transport === 'wecom-websocket' ? native! : remote).send({ ...draft, targets: group }, context));
        }
      } catch (error) {
        if (!receipts.length) throw error;
        throw new CommunicationDeliveryError(error instanceof Error ? error.message : String(error), 'unknown', { cause: error });
      }
      return {
        channelId: integration.id, acceptedAt: new Date().toISOString(),
        deliveryIds: receipts.flatMap(receipt => receipt.deliveryIds), details: { receipts },
      };
    },
  };
}

function connectorDriver(): ExternalIntegrationDriver {
  return {
    id: 'mcp-streamable-http',
    category: 'connector',
    label: 'MCP Streamable HTTP',
    description: '连接遵循 MCP Streamable HTTP 标准的业务系统或工具服务。',
    testLabel: '测试并发现操作',
    fields: [
      { key: 'endpoint', label: 'MCP 服务地址', control: 'url', placeholder: 'https://example.com/mcp', required: true, secret: true },
      {
        key: 'authentication',
        label: '认证方式',
        control: 'select',
        defaultValue: 'none',
        options: [{ label: '无需认证', value: 'none' }, { label: 'Bearer Token', value: 'bearer' }],
      },
      { key: 'token', label: '访问令牌', control: 'password', placeholder: '输入访问令牌', required: true, secret: true, visibleWhen: { field: 'authentication', value: 'bearer' } },
    ],
    normalize(configuration) {
      return {
        endpoint: httpEndpoint(configuration.endpoint, 'MCP 服务地址'),
        ...authenticationConfiguration(configuration),
      };
    },
    summarize(configuration) {
      return endpointPreview(configuration.endpoint);
    },
    createConnector(integration, timeoutMs) {
      return createMcpStreamableHttpConnector({
        id: integration.id,
        name: integration.name,
        url: integration.configuration.endpoint,
        headers: authorizationHeader(integration.configuration),
        timeoutMs,
      });
    },
    async test(integration, timeoutMs) {
      const connector = this.createConnector!(integration, timeoutMs);
      try {
        const operations = await connector.listOperations({ invocationId: `settings-test-${randomUUID()}` });
        return {
          kind: 'operations',
          operationCount: operations.length,
          operations: operations.slice(0, 10).map((item) => item.title || item.id),
        };
      } finally {
        await connector.dispose?.();
      }
    },
  };
}

function sqliteDataDriver(): ExternalIntegrationDriver {
  return {
    id: 'sqlite',
    category: 'data',
    label: 'SQLite',
    description: '连接 Orbit 运行主机上的 SQLite 数据库文件。',
    testLabel: '测试并读取表结构',
    fields: [
      {
        key: 'database',
        label: '数据库文件',
        description: '填写运行 Orbit 的这台主机上的 .db、.sqlite 或 .sqlite3 文件路径；桌面版可直接选择文件。',
        control: 'text',
        placeholder: 'C:\\data\\analytics.db',
        required: true,
        picker: 'file',
      },
      {
        key: 'access',
        label: '访问权限',
        control: 'select',
        defaultValue: 'read-only',
        options: [{ label: '只读（推荐）', value: 'read-only' }, { label: '允许写入', value: 'read-write' }],
      },
    ],
    normalize(configuration) {
      const database = requiredText(configuration.database, '数据库文件', 4_000);
      return { database: path.resolve(database), access: accessConfiguration(configuration) };
    },
    summarize(configuration) {
      return `${path.basename(configuration.database)} · ${configuration.access === 'read-write' ? '可写' : '只读'}`;
    },
    async createDataSource(integration, timeoutMs) {
      const readOnly = integration.configuration.access !== 'read-write';
      const databaseStat = await stat(integration.configuration.database).catch(() => undefined);
      if (!databaseStat?.isFile()) throw new Error('找不到所选 SQLite 数据库文件。');
      const source = new DataSource({
        type: 'better-sqlite3',
        database: integration.configuration.database,
        readonly: readOnly,
        logging: false,
        synchronize: false,
      });
      await source.initialize();
      const adapter = createTypeOrmAgentDataSource({
        id: integration.id,
        name: integration.name,
        source,
        readOnly,
        timeoutMs,
      });
      return {
        ...adapter,
        async dispose() {
          if (source.isInitialized) await source.destroy();
        },
      };
    },
    async test(integration, timeoutMs) {
      const source = await this.createDataSource!(integration, timeoutMs);
      try {
        const tables = await source.schema({ invocationId: `settings-test-${randomUUID()}` });
        return {
          kind: 'data-source',
          tableCount: tables.length,
          tables: tables.slice(0, 10).map((table) => table.name),
        };
      } finally {
        await source.dispose?.();
      }
    },
  };
}

function postgresDataDriver(): ExternalIntegrationDriver {
  return {
    id: 'postgresql',
    category: 'data',
    label: 'PostgreSQL',
    description: '使用主机、端口、数据库和账号信息连接 PostgreSQL，无需拼接连接字符串。',
    testLabel: '测试并读取表结构',
    fields: [
      { key: 'host', label: '主机地址', control: 'text', placeholder: 'db.example.com', required: true },
      { key: 'port', label: '端口', control: 'text', placeholder: '5432', defaultValue: '5432', required: true },
      { key: 'database', label: '数据库名称', control: 'text', placeholder: 'analytics', required: true },
      { key: 'username', label: '用户名', control: 'text', placeholder: 'webpilot', required: true },
      { key: 'password', label: '密码', control: 'password', placeholder: '输入数据库密码', required: true, secret: true },
      {
        key: 'sslMode',
        label: 'SSL 模式',
        control: 'select',
        defaultValue: 'disable',
        options: [
          { label: '不使用 SSL', value: 'disable' },
          { label: '使用 SSL', value: 'require' },
          { label: 'SSL 并验证证书', value: 'verify-full' },
        ],
      },
      {
        key: 'access',
        label: '访问权限',
        control: 'select',
        defaultValue: 'read-only',
        options: [{ label: '只读（推荐）', value: 'read-only' }, { label: '允许写入', value: 'read-write' }],
      },
    ],
    normalize(configuration) {
      const sslMode = configuration.sslMode || 'disable';
      if (sslMode !== 'disable' && sslMode !== 'require' && sslMode !== 'verify-full') throw new Error('不支持所选 SSL 模式。');
      return {
        host: requiredText(configuration.host, '主机地址'),
        port: String(boundedPort(configuration.port, 5432)),
        database: requiredText(configuration.database, '数据库名称'),
        username: requiredText(configuration.username, '用户名'),
        password: requiredText(configuration.password, '密码', 20_000),
        sslMode,
        access: accessConfiguration(configuration),
      };
    },
    summarize(configuration) {
      return `${configuration.host}:${configuration.port}/${configuration.database} · ${configuration.access === 'read-write' ? '可写' : '只读'}`;
    },
    async createDataSource(integration, timeoutMs) {
      const readOnly = integration.configuration.access !== 'read-write';
      const sslMode = integration.configuration.sslMode;
      const source = new DataSource({
        type: 'postgres',
        host: integration.configuration.host,
        port: Number(integration.configuration.port),
        database: integration.configuration.database,
        username: integration.configuration.username,
        password: integration.configuration.password,
        ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
        connectTimeoutMS: timeoutMs,
        applicationName: 'Orbit',
        logging: false,
        synchronize: false,
      });
      await source.initialize();
      const adapter = createTypeOrmAgentDataSource({
        id: integration.id,
        name: integration.name,
        source,
        readOnly,
        timeoutMs,
      });
      return {
        ...adapter,
        async dispose() {
          if (source.isInitialized) await source.destroy();
        },
      };
    },
    async test(integration, timeoutMs) {
      const source = await this.createDataSource!(integration, timeoutMs);
      try {
        const tables = await source.schema({ invocationId: `settings-test-${randomUUID()}` });
        return {
          kind: 'data-source',
          tableCount: tables.length,
          tables: tables.slice(0, 10).map((table) => table.name),
        };
      } finally {
        await source.dispose?.();
      }
    },
  };
}

function canonicalWebhookDriver(): ExternalIntegrationDriver {
  return {
    id: 'canonical-http-webhook',
    category: 'communication',
    label: '标准消息 Webhook',
    description: '向能够接收 Orbit 标准消息结构的 HTTP 服务发送消息。',
    testLabel: '发送测试消息',
    fields: [
      { key: 'endpoint', label: 'Webhook 地址', control: 'url', placeholder: 'https://example.com/webhook', required: true, secret: true },
      {
        key: 'authentication',
        label: '认证方式',
        control: 'select',
        defaultValue: 'none',
        options: [{ label: '无需认证', value: 'none' }, { label: 'Bearer Token', value: 'bearer' }],
      },
      { key: 'token', label: '访问令牌', control: 'password', placeholder: '输入访问令牌', required: true, secret: true, visibleWhen: { field: 'authentication', value: 'bearer' } },
    ],
    normalize(configuration) {
      return {
        endpoint: httpEndpoint(configuration.endpoint, 'Webhook 地址'),
        ...authenticationConfiguration(configuration),
      };
    },
    summarize(configuration) {
      return endpointPreview(configuration.endpoint);
    },
    createChannel(integration, timeoutMs) {
      return createJsonWebhookChannel({
        id: integration.id,
        name: integration.name,
        url: integration.configuration.endpoint,
        headers: authorizationHeader(integration.configuration),
        timeoutMs,
      });
    },
    async test(integration, timeoutMs) {
      const channel = this.createChannel!(integration, timeoutMs);
      const draft: CommunicationDraft = {
        id: randomUUID(),
        channelId: integration.id,
        targets: [],
        content: { format: 'text', title: 'Orbit 渠道测试', body: '这是一条由管理员主动发送的 Orbit 渠道测试消息。' },
        metadata: { type: 'configuration-test' },
        createdAt: new Date().toISOString(),
      };
      const receipt = await channel.send(draft, { invocationId: `settings-test-${randomUUID()}` });
      await channel.dispose?.();
      return { kind: 'delivered', deliveryCount: receipt.deliveryIds.length };
    },
  };
}

function weComAiBotDriver(): ExternalIntegrationDriver {
  return {
    id: 'wecom-aibot-mcp',
    category: 'communication',
    label: '企业微信智能机器人',
    description: '从企业微信读取最近会话并发送消息。配置 Bot ID 和 Secret 后，还可接收消息、运行 Agent 并回复附件。',
    testLabel: '读取接收会话',
    testHint: '每次从企业微信拉取最近最多 20 个会话。请先给机器人发送消息，群聊中需要 @机器人，再读取并选择接收对象。',
    fields: [
      {
        key: 'endpoint', label: '企业微信消息 MCP 地址',
        description: '复制机器人“消息”权限页面中的 StreamableHttp URL。地址内含 API Key，将加密保存。',
        control: 'url', placeholder: 'https://qyapi.weixin.qq.com/mcp/v2/bot/msg?apikey=...', required: true, secret: true,
      },
      {
        key: 'botId', label: 'Bot ID', control: 'text',
        description: '填写同一智能机器人的 Bot ID。与 Secret 一起用于接收消息及官方媒体上传。',
      },
      { key: 'botSecret', label: 'Secret', control: 'password', secret: true, description: '机器人的长连接 Secret，将加密保存。无需额外配置媒体上传地址。' },
      { key: 'receiveMessages', label: '接收消息并运行 Agent', control: 'select', defaultValue: 'false',
        options: [{ label: '关闭', value: 'false' }, { label: '开启', value: 'true' }],
        description: '单聊直接发送，群聊中 @机器人。支持 /start、/delete、/list、/select id；对话归属保存此配置的网页账号，以完全模式运行，无需逐次确认工具操作。' },
      { key: 'ownerUserId', label: '对话所属账号', control: 'text', hidden: true },
      {
        key: 'defaultTargetKind', label: '已验证会话类型', control: 'select', hidden: true,
        defaultValue: 'user', options: [{ label: '单聊', value: 'user' }, { label: '群聊', value: 'group' }],
      },
      { key: 'defaultTarget', label: '接收会话', control: 'text', secret: true, hidden: true },
      { key: 'defaultTargetBinding', label: '已验证会话绑定', control: 'text', secret: true, hidden: true },
    ],
    normalize(configuration) {
      const endpoint = configuration.endpoint?.trim();
      if (!endpoint) throw new Error('请输入企业微信消息 MCP 地址。');
      const defaultTarget = configuration.defaultTarget?.trim();
      const defaultTargetKind = configuration.defaultTargetKind || 'user';
      if (defaultTargetKind !== 'user' && defaultTargetKind !== 'group') throw new Error('已验证会话类型无效。');
      if (defaultTarget && defaultTarget.length > 500) throw new Error('接收会话标识过长。');
      const normalizedEndpoint = httpEndpoint(endpoint, '企业微信消息 MCP 地址');
      const botId = configuration.botId?.trim();
      const botSecret = configuration.botSecret?.trim();
      if (Boolean(botId) !== Boolean(botSecret)) throw new Error('Bot ID 和 Secret 必须一起配置。');
      const receiveMessages = configuration.receiveMessages === 'true';
      if (receiveMessages && !botId) throw new Error('开启接收消息需要配置 Bot ID 和 Secret。');
      const expectedTargetBinding = defaultTarget
        ? weComTargetBinding({ endpoint: normalizedEndpoint, target: { kind: defaultTargetKind, id: defaultTarget } })
        : '';
      const targetIsVerified = Boolean(expectedTargetBinding) && configuration.defaultTargetBinding === expectedTargetBinding;
      return {
        endpoint: normalizedEndpoint,
        ...(botId && botSecret ? { botId, botSecret } : {}),
        receiveMessages: String(receiveMessages),
        ...(configuration.ownerUserId ? { ownerUserId: configuration.ownerUserId } : {}),
        defaultTargetKind,
        ...(targetIsVerified ? { defaultTarget, defaultTargetBinding: expectedTargetBinding } : {}),
      };
    },
    summarize(configuration) {
      const target = verifiedWeComTarget(configuration);
      const status = target ? (target.kind === 'group' ? '已验证群聊' : '已验证单聊') : '待选择接收会话';
      return status + ' · ' + endpointPreview(configuration.endpoint);
    },
    createChannel(integration, timeoutMs, readArtifact) {
      return createWeComAiBotChannel(integration, timeoutMs, undefined, readArtifact);
    },
    async test(integration, timeoutMs, abortSignal, onProgress, selectedTarget) {
      const activeIntegration = { ...integration, enabled: true };
      const connector = createMcpStreamableHttpConnector({
        id: integration.id, name: integration.name, url: integration.configuration.endpoint, timeoutMs,
      });
      const context = { invocationId: 'settings-test-' + randomUUID(), abortSignal };
      try {
        const operations = await connector.listOperations(context);
        const required = [weComSessionsOperationId, weComMessageOperationId];
        const missing = required.filter(id => !operations.some(operation => operation.id === id));
        if (missing.length) throw new Error('这个 MCP 地址缺少必要能力：' + missing.join('、'));
        if (!selectedTarget) {
          const targets = weComRecentSessions(await connector.call(weComSessionsOperationId, {}, context));
          if (!targets.length) throw new Error('当前没有可发送的接收会话。请先给机器人发送消息，群聊中需要 @机器人，然后重新读取。');
          return { kind: 'available-targets', targets };
        }
        onProgress?.({ stage: 'verifying' });
        // The shared channel refreshes sessions and resolves the explicitly chosen target before sending.
        const channel = createWeComAiBotChannel(activeIntegration, timeoutMs, connector);
        await channel.send({
          id: randomUUID(), channelId: integration.id, targets: [selectedTarget],
          content: { format: 'text', body: 'Orbit 企业微信发送渠道已连接成功。' },
          metadata: { type: 'configuration-test' }, createdAt: new Date().toISOString(),
        }, context);
        return {
          kind: 'target-discovered', target: selectedTarget,
          targetBinding: weComTargetBinding({ endpoint: integration.configuration.endpoint, target: selectedTarget }),
        };
      } finally {
        await connector.dispose?.();
      }
    },
  };
}

const drivers = [
  connectorDriver(),
  canonicalWebhookDriver(),
  weComAiBotDriver(),
  sqliteDataDriver(),
  postgresDataDriver(),
] as const;
const driversById = new Map(drivers.map((driver) => [driver.id, driver]));

export function listExternalIntegrationDrivers(category?: ExternalIntegrationCategory): ExternalIntegrationDriverDescriptor[] {
  return drivers
    .filter((driver) => !category || driver.category === category)
    .map((driver) => ({
      id: driver.id,
      category: driver.category,
      label: driver.label,
      description: driver.description,
      testLabel: driver.testLabel,
      testHint: driver.testHint,
      fields: driver.fields,
    }));
}

export function externalIntegrationDriver(driverId: string, category?: ExternalIntegrationCategory) {
  const driver = driversById.get(driverId);
  if (!driver || (category && driver.category !== category)) throw new Error('不支持所选外部集成驱动。');
  return driver;
}

export function resolveExternalIntegrationConfiguration(input: {
  driverId: string;
  category: ExternalIntegrationCategory;
  configuration: ExternalIntegrationConfiguration;
  clearFields?: string[];
  existing?: ResolvedExternalIntegration;
}) {
  const driver = externalIntegrationDriver(input.driverId, input.category);
  const allowedFields = new Set(driver.fields.map((field) => field.key));
  for (const key of Object.keys(input.configuration)) {
    if (!allowedFields.has(key)) throw new Error(`配置字段 ${key} 不属于所选驱动。`);
  }
  for (const key of input.clearFields || []) {
    if (!allowedFields.has(key)) throw new Error(`不能清除未知配置字段 ${key}。`);
  }
  const merged: ExternalIntegrationConfiguration = { ...(input.existing?.configuration || {}) };
  for (const key of input.clearFields || []) delete merged[key];
  for (const [key, value] of Object.entries(input.configuration)) {
    const normalized = value.trim();
    if (normalized) merged[key] = normalized;
  }
  for (const field of driver.fields) {
    if (!merged[field.key] && field.defaultValue) merged[field.key] = field.defaultValue;
  }
  return driver.normalize(merged);
}

export function publicExternalIntegrationSummary(integration: ResolvedExternalIntegration): ExternalIntegrationPublicSummary {
  const driver = externalIntegrationDriver(integration.driverId, integration.category);
  const bot = integration.driverId === 'wecom-aibot-mcp' ? weComConnectionStatus(integration.configuration.botId) : undefined;
  return {
    id: integration.id,
    category: integration.category,
    driverId: integration.driverId,
    name: integration.name,
    detailPreview: driver.summarize(integration.configuration) + (bot ? ` · ${bot.error || (bot.connected ? '机器人已连接' : '机器人连接中')}${bot.lastMessageError ? ` · ${bot.lastMessageError}` : ''}` : ''),
    configuredFields: driver.fields.filter((field) => Boolean(integration.configuration[field.key])).map((field) => field.key),
    publicConfiguration: Object.fromEntries(driver.fields
      .filter((field) => !field.secret && integration.configuration[field.key])
      .map((field) => [field.key, integration.configuration[field.key]])),
    enabled: integration.enabled,
    updatedAt: integration.updatedAt,
  };
}

export function createExternalIntegrationConnector(integration: ResolvedExternalIntegration, timeoutMs: number) {
  const driver = externalIntegrationDriver(integration.driverId, 'connector');
  if (!driver.createConnector) throw new Error(`驱动 ${driver.id} 不能创建连接器。`);
  return driver.createConnector(integration, timeoutMs);
}

export function createExternalCommunicationChannel(integration: ResolvedExternalIntegration, timeoutMs: number, readArtifact?: CommunicationMediaOperations['readArtifact']) {
  const driver = externalIntegrationDriver(integration.driverId, 'communication');
  if (!driver.createChannel) throw new Error(`驱动 ${driver.id} 不能创建通信渠道。`);
  return driver.createChannel(integration, timeoutMs, readArtifact);
}

export function createExternalDataSource(integration: ResolvedExternalIntegration, timeoutMs: number) {
  const driver = externalIntegrationDriver(integration.driverId, 'data');
  if (!driver.createDataSource) throw new Error(`驱动 ${driver.id} 不能创建数据源。`);
  return driver.createDataSource(integration, timeoutMs);
}

export async function testExternalIntegration(
  integration: ResolvedExternalIntegration,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  onProgress?: (progress: ExternalIntegrationTestProgress) => void,
  selectedTarget?: Pick<ExternalIntegrationTestTarget, 'kind' | 'id'>,
) {
  return externalIntegrationDriver(integration.driverId, integration.category).test(integration, timeoutMs, abortSignal, onProgress, selectedTarget);
}
