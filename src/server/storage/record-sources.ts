/** Domain projections over shared physical storage; both databases flatten these simple filters. */
export function workspaceEntities(kind: 'chat' | 'archive' | 'case' | 'schedule' | 'run' | 'communication' | 'runtime') {
  const aliases = kind === 'chat' ? ',record_json AS snapshot_json' : kind === 'archive' ? ',id AS session_id'
    : kind === 'schedule' || kind === 'run' ? ',parent_id AS case_id,link_id AS schedule_id' : '';
  return `(SELECT *${aliases} FROM workspace_entity WHERE kind='${kind}')`;
}

export function knowledgeRecords(kind: 'skill' | 'memory') {
  return `(SELECT * FROM knowledge_record WHERE kind='${kind}')`;
}

export function userRecords(kind: 'profile' | 'account' | 'cookie') {
  return `(SELECT * FROM user_record WHERE kind='${kind}')`;
}

export function workspaceRecords(collection: 'conversation' | 'execution' | 'memory' | 'communication') {
  const aliases = collection === 'memory' ? ',partition_id AS user_id,container_id AS session_id'
    : collection === 'communication' ? ',partition_id AS conversation_id' : ',partition_id AS session_id';
  const scope = collection === 'execution' ? '' : " AND scope_id=''";
  return `(SELECT *${aliases} FROM workspace_record WHERE collection='${collection}'${scope})`;
}

export function conversationRecords(kind: 'message' | 'step' | 'log' | 'context' | 'request' | 'file') {
  return `(SELECT *,partition_id AS session_id FROM workspace_record WHERE collection='conversation' AND kind='${kind}' AND scope_id='')`;
}
