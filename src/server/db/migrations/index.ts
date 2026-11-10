import { InitialBackendSchema1788307200000 } from './1788307200000-initial-backend-schema';
import { BrowserChatContextRecords1788566400000 } from './1788566400000-browser-chat-context-records';
import { RuntimeReadIndexes1788652800000 } from './1788652800000-runtime-read-indexes';
import { CommunicationConversations1788832800000 } from './1788832800000-communication-conversations';
import { PersonalMemoryReceipts1789084800000 } from './1789084800000-personal-memory-receipts';
import { HybridRuntime1790000200000 } from './1790000200000-hybrid-runtime';
import { MemoryJobResults1790600000000 } from './1790600000000-memory-job-results';
import { RuntimeExecutionOwners1793836800000 } from './1793836800000-runtime-execution-owners';
import { UserCookieIdentity1793923200000 } from './1793923200000-user-cookie-identity';
import { ConsolidatedRecords1794268800000 } from './1794268800000-consolidated-records';

export const applicationMigrations = [InitialBackendSchema1788307200000, BrowserChatContextRecords1788566400000,
  RuntimeReadIndexes1788652800000, CommunicationConversations1788832800000, PersonalMemoryReceipts1789084800000,
  HybridRuntime1790000200000, MemoryJobResults1790600000000, RuntimeExecutionOwners1793836800000, UserCookieIdentity1793923200000,
  ConsolidatedRecords1794268800000];
