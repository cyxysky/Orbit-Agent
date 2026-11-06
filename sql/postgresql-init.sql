-- Generated from applicationMigrations. For a new empty PostgreSQL database.
-- Regenerate: npm run db:postgres:init-sql

BEGIN;

CREATE TABLE typeorm_migration ("id" SERIAL PRIMARY KEY, "timestamp" BIGINT NOT NULL, "name" VARCHAR NOT NULL);

-- InitialBackendSchema1788307200000

CREATE TABLE IF NOT EXISTS app_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    runtime_env_json TEXT NOT NULL DEFAULT '[]',
    model_config_json TEXT,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS runtime_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS skill (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shared BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS skill_updated_at_idx ON skill(updated_at DESC);

CREATE INDEX IF NOT EXISTS skill_user_updated_idx ON skill(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS skill_shared_updated_idx ON skill(shared, updated_at DESC);

CREATE TABLE IF NOT EXISTS browser_chat_session (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS browser_chat_session_user_id_idx ON browser_chat_session(user_id);

CREATE INDEX IF NOT EXISTS browser_chat_session_updated_at_idx ON browser_chat_session(updated_at DESC);

CREATE INDEX IF NOT EXISTS browser_chat_session_user_updated_id_idx ON browser_chat_session(user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS browser_chat_message (
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    time TEXT NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (session_id, id),
    FOREIGN KEY (session_id) REFERENCES browser_chat_session(id) ON DELETE CASCADE
  );

CREATE INDEX IF NOT EXISTS browser_chat_message_session_time_idx ON browser_chat_message(session_id, time);

CREATE INDEX IF NOT EXISTS browser_chat_message_session_time_id_idx ON browser_chat_message(session_id, time DESC, id DESC);

CREATE TABLE IF NOT EXISTS browser_chat_step (
    session_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    PRIMARY KEY (session_id, step_index),
    FOREIGN KEY (session_id) REFERENCES browser_chat_session(id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS browser_chat_log (
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    time TEXT NOT NULL,
    message_id TEXT,
    record_json TEXT NOT NULL,
    PRIMARY KEY (session_id, id),
    FOREIGN KEY (session_id) REFERENCES browser_chat_session(id) ON DELETE CASCADE
  );

CREATE INDEX IF NOT EXISTS browser_chat_log_session_time_idx ON browser_chat_log(session_id, time);

CREATE INDEX IF NOT EXISTS browser_chat_log_session_time_id_idx ON browser_chat_log(session_id, time DESC, id DESC);

CREATE INDEX IF NOT EXISTS browser_chat_log_session_message_time_idx ON browser_chat_log(session_id, message_id, time DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_operations_chat_archive (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    first_event_at TEXT NOT NULL,
    last_event_at TEXT NOT NULL,
    archived_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS ai_operations_chat_archive_user_last_event_idx ON ai_operations_chat_archive(user_id, last_event_at DESC);

CREATE INDEX IF NOT EXISTS ai_operations_chat_archive_last_event_idx ON ai_operations_chat_archive(last_event_at DESC);

CREATE TABLE IF NOT EXISTS personal_memory_item (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shared BOOLEAN NOT NULL DEFAULT FALSE,
    scope TEXT NOT NULL,
    domain TEXT NOT NULL,
    type TEXT NOT NULL,
    memory_key TEXT NOT NULL,
    status TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS personal_memory_identity_idx ON personal_memory_item(user_id, scope, domain, type, memory_key);

CREATE INDEX IF NOT EXISTS personal_memory_updated_at_idx ON personal_memory_item(updated_at DESC);

CREATE TABLE IF NOT EXISTS user_onboarding_state (
    user_id TEXT PRIMARY KEY,
    tutorial_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    completed_steps_json TEXT NOT NULL DEFAULT '[]',
    dismissed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS login_account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shared BOOLEAN NOT NULL DEFAULT FALSE,
    domain TEXT NOT NULL,
    username TEXT NOT NULL,
    label TEXT NOT NULL,
    login_url TEXT NOT NULL,
    status TEXT NOT NULL,
    password_envelope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, domain, username)
  );

CREATE INDEX IF NOT EXISTS login_account_user_domain_idx ON login_account(user_id, domain);

CREATE INDEX IF NOT EXISTS login_account_updated_at_idx ON login_account(updated_at DESC);

CREATE TABLE IF NOT EXISTS websocket_ticket (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    session_id TEXT,
    scope TEXT NOT NULL,
    origin TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    consumed_at TEXT
  );

CREATE INDEX IF NOT EXISTS websocket_ticket_token_idx ON websocket_ticket(token_hash, expires_at);

CREATE TABLE IF NOT EXISTS browser_code_runtime_state (
    session_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'conversation',
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    PRIMARY KEY (session_id, namespace, key)
  );

CREATE INDEX IF NOT EXISTS browser_code_runtime_state_expiry_idx ON browser_code_runtime_state(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS automation_case (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    target_url TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS automation_case_user_updated_at_idx ON automation_case(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS automation_case_source_session_idx ON automation_case(source_session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS automation_schedule (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    title TEXT NOT NULL,
    recurrence TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    next_run_at TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES automation_case(id) ON DELETE CASCADE
  );

CREATE INDEX IF NOT EXISTS automation_schedule_user_updated_at_idx ON automation_schedule(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS automation_schedule_case_idx ON automation_schedule(case_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS automation_schedule_due_idx ON automation_schedule(enabled, next_run_at ASC);

CREATE TABLE IF NOT EXISTS automation_run (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    case_id TEXT NOT NULL,
    schedule_id TEXT,
    occurrence_key TEXT,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    lease_expires_at TEXT,
    record_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES automation_case(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES automation_schedule(id) ON DELETE SET NULL
  );

CREATE INDEX IF NOT EXISTS automation_run_user_created_at_idx ON automation_run(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS automation_run_case_created_at_idx ON automation_run(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS automation_run_schedule_created_at_idx ON automation_run(schedule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS automation_run_status_created_at_idx ON automation_run(status, created_at ASC);

CREATE INDEX IF NOT EXISTS automation_run_lease_idx ON automation_run(status, lease_expires_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS automation_run_occurrence_idx ON automation_run(schedule_id, occurrence_key) WHERE schedule_id IS NOT NULL AND occurrence_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_idempotency (
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    status_code INTEGER,
    response_json TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, scope, idempotency_key)
  );

CREATE INDEX IF NOT EXISTS api_idempotency_expires_idx ON api_idempotency(expires_at);

CREATE TABLE IF NOT EXISTS browser_domain_cookie (
    user_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    cookie_envelope TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, domain)
  );

CREATE INDEX IF NOT EXISTS browser_domain_cookie_updated_idx ON browser_domain_cookie(updated_at DESC);

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788307200000, 'InitialBackendSchema1788307200000');

-- BrowserChatContextRecords1788566400000

CREATE TABLE IF NOT EXISTS browser_chat_context_record (
      session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      record_json TEXT NOT NULL,
      PRIMARY KEY (session_id, id)
    );

CREATE TABLE IF NOT EXISTS browser_chat_context_request (
      session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      PRIMARY KEY (session_id, id)
    );

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788566400000, 'BrowserChatContextRecords1788566400000');

-- RuntimeReadIndexes1788652800000

CREATE TABLE browser_chat_file_message (
      session_id TEXT NOT NULL, id TEXT NOT NULL, time TEXT NOT NULL, record_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id),
      FOREIGN KEY(session_id, id) REFERENCES browser_chat_message(session_id, id) ON DELETE CASCADE
    );

CREATE INDEX browser_chat_file_message_time ON browser_chat_file_message(session_id, time, id);

INSERT INTO browser_chat_file_message SELECT m.session_id, m.id, m.time, jsonb_build_object('id', m.id, 'role', CAST(m.record_json AS jsonb)->'role', 'createdAt', CAST(m.record_json AS jsonb)->'createdAt', 'updatedAt', CAST(m.record_json AS jsonb)->'updatedAt', 'content', '', 'attachments', CAST(m.record_json AS jsonb)->'attachments', 'artifacts', CAST(m.record_json AS jsonb)->'artifacts')::text FROM browser_chat_message m WHERE (COALESCE(CAST(m.record_json AS jsonb)->'attachments', '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) OR COALESCE(CAST(m.record_json AS jsonb)->'artifacts', '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb));

CREATE FUNCTION webpilot_index_message_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (COALESCE(CAST(NEW.record_json AS jsonb)->'attachments', '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) OR COALESCE(CAST(NEW.record_json AS jsonb)->'artifacts', '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb)) THEN INSERT INTO browser_chat_file_message VALUES (NEW.session_id, NEW.id, NEW.time, jsonb_build_object('id', NEW.id, 'role', CAST(NEW.record_json AS jsonb)->'role', 'createdAt', CAST(NEW.record_json AS jsonb)->'createdAt', 'updatedAt', CAST(NEW.record_json AS jsonb)->'updatedAt', 'content', '', 'attachments', CAST(NEW.record_json AS jsonb)->'attachments', 'artifacts', CAST(NEW.record_json AS jsonb)->'artifacts')::text)
      ON CONFLICT(session_id,id) DO UPDATE SET time=excluded.time, record_json=excluded.record_json;
        ELSE DELETE FROM browser_chat_file_message WHERE session_id=NEW.session_id AND id=NEW.id; END IF;
        RETURN NULL; END $$;

CREATE TRIGGER webpilot_message_files AFTER INSERT OR UPDATE OF record_json ON browser_chat_message FOR EACH ROW EXECUTE FUNCTION webpilot_index_message_files();

CREATE TABLE runtime_knowledge_revision (scope TEXT NOT NULL, kind TEXT NOT NULL, revision BIGINT NOT NULL, PRIMARY KEY(scope,kind));

CREATE FUNCTION webpilot_revision_skill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP <> 'INSERT' THEN INSERT INTO runtime_knowledge_revision(scope,kind,revision) VALUES ('user:' || OLD.user_id, 'skills', 1)
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1;
        INSERT INTO runtime_knowledge_revision(scope,kind,revision) SELECT 'shared', 'skills', 1 WHERE OLD.shared = true
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1; END IF;
          IF TG_OP <> 'DELETE' THEN INSERT INTO runtime_knowledge_revision(scope,kind,revision) VALUES ('user:' || NEW.user_id, 'skills', 1)
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1;
        INSERT INTO runtime_knowledge_revision(scope,kind,revision) SELECT 'shared', 'skills', 1 WHERE NEW.shared = true
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1; END IF;
          RETURN NULL; END $$;

CREATE TRIGGER webpilot_revision_skill AFTER INSERT OR UPDATE OR DELETE ON skill FOR EACH ROW EXECUTE FUNCTION webpilot_revision_skill();

CREATE FUNCTION webpilot_revision_personal_memory_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP <> 'INSERT' THEN INSERT INTO runtime_knowledge_revision(scope,kind,revision) VALUES ('user:' || OLD.user_id, 'memories', 1)
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1;
        INSERT INTO runtime_knowledge_revision(scope,kind,revision) SELECT 'shared', 'memories', 1 WHERE OLD.shared = true
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1; END IF;
          IF TG_OP <> 'DELETE' THEN INSERT INTO runtime_knowledge_revision(scope,kind,revision) VALUES ('user:' || NEW.user_id, 'memories', 1)
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1;
        INSERT INTO runtime_knowledge_revision(scope,kind,revision) SELECT 'shared', 'memories', 1 WHERE NEW.shared = true
        ON CONFLICT(scope,kind) DO UPDATE SET revision=runtime_knowledge_revision.revision+1; END IF;
          RETURN NULL; END $$;

CREATE TRIGGER webpilot_revision_personal_memory_item AFTER INSERT OR UPDATE OR DELETE ON personal_memory_item FOR EACH ROW EXECUTE FUNCTION webpilot_revision_personal_memory_item();

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788652800000, 'RuntimeReadIndexes1788652800000');

-- CommunicationConversations1788832800000

CREATE TABLE communication_conversation (
      id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, bot_id TEXT NOT NULL, user_id TEXT NOT NULL,
      record_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );

CREATE TABLE communication_inbound (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, status TEXT NOT NULL,
      record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

CREATE INDEX communication_inbound_pending ON communication_inbound(status, created_at);

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788832800000, 'CommunicationConversations1788832800000');

-- PersonalMemoryReceipts1789084800000

CREATE TABLE personal_memory_receipt (
      user_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, source_key)
    );

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1789084800000, 'PersonalMemoryReceipts1789084800000');

-- HybridRuntime1790000200000

CREATE TABLE agent_runtime_state (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id));

CREATE TABLE agent_runtime_event (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, revision INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, revision));

CREATE TABLE agent_runtime_call (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, call_id TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, call_id));

CREATE TABLE agent_runtime_compaction (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, epoch INTEGER NOT NULL, snapshot_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, epoch));

CREATE TABLE agent_memory_candidate (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, source_key TEXT NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL, UNIQUE(user_id, source_key));

CREATE TABLE agent_memory_job (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at BIGINT NOT NULL, lease_until BIGINT NOT NULL, lease_id TEXT, payload_json TEXT NOT NULL, error TEXT);

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790000200000, 'HybridRuntime1790000200000');

-- MemoryJobResults1790600000000

ALTER TABLE agent_memory_job ADD COLUMN result_json TEXT;

CREATE INDEX agent_memory_job_pending ON agent_memory_job (status, available_at);

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790600000000, 'MemoryJobResults1790600000000');

-- RuntimeExecutionOwners1793836800000

CREATE TABLE agent_runtime_owner (id TEXT PRIMARY KEY);

INSERT INTO agent_runtime_owner (id) SELECT DISTINCT session_id FROM agent_runtime_state WHERE 1 = 1 ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_runtime_owner (id) SELECT DISTINCT session_id FROM agent_runtime_event WHERE 1 = 1 ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_runtime_owner (id) SELECT DISTINCT session_id FROM agent_runtime_call WHERE 1 = 1 ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_runtime_owner (id) SELECT DISTINCT session_id FROM agent_runtime_compaction WHERE 1 = 1 ON CONFLICT (id) DO NOTHING;

ALTER TABLE "agent_runtime_state" DROP CONSTRAINT "agent_runtime_state_session_id_fkey";

ALTER TABLE "agent_runtime_state" ADD CONSTRAINT "agent_runtime_state_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_runtime_owner" ("id") ON DELETE CASCADE;

ALTER TABLE "agent_runtime_event" DROP CONSTRAINT "agent_runtime_event_session_id_fkey";

ALTER TABLE "agent_runtime_event" ADD CONSTRAINT "agent_runtime_event_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_runtime_owner" ("id") ON DELETE CASCADE;

ALTER TABLE "agent_runtime_call" DROP CONSTRAINT "agent_runtime_call_session_id_fkey";

ALTER TABLE "agent_runtime_call" ADD CONSTRAINT "agent_runtime_call_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_runtime_owner" ("id") ON DELETE CASCADE;

ALTER TABLE "agent_runtime_compaction" DROP CONSTRAINT "agent_runtime_compaction_session_id_fkey";

ALTER TABLE "agent_runtime_compaction" ADD CONSTRAINT "agent_runtime_compaction_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_runtime_owner" ("id") ON DELETE CASCADE;

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1793836800000, 'RuntimeExecutionOwners1793836800000');

-- UserCookieIdentity1793923200000

CREATE TABLE application_user (
      id TEXT PRIMARY KEY,
      cookie TEXT,
      cookie_domain TEXT,
      cookie_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE UNIQUE INDEX application_user_cookie_identity ON application_user(cookie_domain, cookie_fingerprint) WHERE cookie_fingerprint IS NOT NULL;

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1793923200000, 'UserCookieIdentity1793923200000');

COMMIT;
