import { createHash } from 'node:crypto';
import type { WeComInboundMessage } from '@cjfclonedeep/capability-sdk/integrations/communication/node';

/** Calendar weeks start Monday at midnight in the channel's operating timezone. */
export function communicationWeek(at: Date = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
  const date = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

/** Delivery destination and shared execution identity are independent of the actor. */
export function communicationContext(input: { integrationId: string; botId: string; ownerUserId: string; message: WeComInboundMessage }, at = new Date()) {
  const { integrationId, botId, ownerUserId, message } = input;
  const scope = message.target.kind === 'group' ? message.target : { kind: 'user' as const, id: message.senderId };
  const id = createHash('sha256').update(JSON.stringify([integrationId, botId, ownerUserId, scope.kind, scope.id])).digest('hex');
  return { id, scope, userId: scope.kind === 'group' ? `wecom_group_${id}` : message.senderId,
    period: scope.kind === 'group' ? communicationWeek(at) : undefined };
}
