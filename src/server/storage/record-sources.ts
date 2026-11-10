/** Simple filtered sources are flattened by both supported databases, retaining the kind indexes. */
export function conversationRecords(kind: 'message' | 'step' | 'log' | 'context' | 'request' | 'file') {
  return `(SELECT * FROM conversation_record WHERE kind='${kind}')`;
}
