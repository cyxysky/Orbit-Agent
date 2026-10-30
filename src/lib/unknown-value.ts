export { jsonRecordFromUnknown as asRecord } from '@cjfclonedeep/capability-sdk';

export function finiteNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
