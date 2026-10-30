type SessionListIdentity = { id: string; createdAt?: string };

/** Streamed updates must not change sidebar position or date grouping. */
export function browserChatSessionListTimestamp(session: SessionListIdentity) {
  return session.createdAt || '';
}

/** Match the persisted created_at DESC, id DESC pagination order. */
export function compareBrowserChatSessionCreation(left: SessionListIdentity, right: SessionListIdentity) {
  const leftTime = browserChatSessionListTimestamp(left);
  const rightTime = browserChatSessionListTimestamp(right);
  if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
  return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}

export function upsertBrowserChatSessionByCreation<T extends SessionListIdentity>(current: T[], incoming: T) {
  const existingIndex = current.findIndex(item => item.id === incoming.id);
  if (existingIndex >= 0 && current[existingIndex].createdAt === incoming.createdAt) {
    if (current[existingIndex] === incoming) return current;
    const next = [...current];
    next[existingIndex] = incoming;
    return next;
  }
  const next = current.filter(item => item.id !== incoming.id);
  const insertionIndex = next.findIndex(item => compareBrowserChatSessionCreation(incoming, item) < 0);
  next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, incoming);
  return next;
}
