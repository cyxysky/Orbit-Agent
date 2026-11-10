-- Generated from applicationMigrations. For a new empty PostgreSQL database.
-- Regenerate: npm run db:postgres:init-sql

BEGIN;

CREATE TABLE typeorm_migration ("id" SERIAL PRIMARY KEY, "timestamp" BIGINT NOT NULL, "name" VARCHAR NOT NULL);

-- InitialBackendSchema1788307200000

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

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788566400000, 'BrowserChatContextRecords1788566400000');

-- RuntimeReadIndexes1788652800000

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

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1789084800000, 'PersonalMemoryReceipts1789084800000');

-- HybridRuntime1790000200000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790000200000, 'HybridRuntime1790000200000');

-- MemoryJobResults1790600000000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790600000000, 'MemoryJobResults1790600000000');

-- RuntimeExecutionOwners1793836800000

CREATE TABLE agent_runtime_owner (id TEXT PRIMARY KEY);

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

-- ConsolidatedRecords1794268800000

CREATE TABLE conversation_record (
      session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('message','step','log','context','request','file')),
      id TEXT NOT NULL, step_index INTEGER, time TEXT NOT NULL DEFAULT '', message_id TEXT,
      record_json TEXT NOT NULL, parent_kind TEXT, parent_id TEXT,
      PRIMARY KEY(session_id,kind,id),
      FOREIGN KEY(session_id,parent_kind,parent_id) REFERENCES conversation_record(session_id,kind,id) ON DELETE CASCADE
    );

CREATE INDEX conversation_record_time ON conversation_record(session_id,kind,time DESC,id DESC);

CREATE INDEX conversation_record_step ON conversation_record(session_id,kind,step_index DESC);

CREATE INDEX conversation_record_message ON conversation_record(session_id,kind,message_id,time DESC);

CREATE TABLE execution_record (
      session_id TEXT NOT NULL REFERENCES agent_runtime_owner(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('state','event','call','compaction','variable')),
      id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, record_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT '', expires_at TEXT,
      PRIMARY KEY(session_id,scope_id,kind,id)
    );

CREATE INDEX execution_record_expiry ON execution_record(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE application_user ADD COLUMN onboarding_json TEXT;

DROP FUNCTION IF EXISTS webpilot_index_message_files();

CREATE FUNCTION orbit_index_message_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF COALESCE(CAST(NEW.record_json AS jsonb)->'attachments','[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) OR COALESCE(CAST(NEW.record_json AS jsonb)->'artifacts','[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) THEN INSERT INTO conversation_record(session_id,kind,id,time,record_json,parent_kind,parent_id)
      VALUES(NEW.session_id,'file',NEW.id,NEW.time,jsonb_build_object('id',NEW.id,'role',CAST(NEW.record_json AS jsonb)->'role','createdAt',CAST(NEW.record_json AS jsonb)->'createdAt','updatedAt',CAST(NEW.record_json AS jsonb)->'updatedAt','content','','attachments',CAST(NEW.record_json AS jsonb)->'attachments','artifacts',CAST(NEW.record_json AS jsonb)->'artifacts')::text,'message',NEW.id)
      ON CONFLICT(session_id,kind,id) DO UPDATE SET time=excluded.time,record_json=excluded.record_json; ELSE DELETE FROM conversation_record WHERE session_id=NEW.session_id AND kind='file' AND id=NEW.id; END IF; RETURN NULL; END $$;

CREATE TRIGGER orbit_message_files AFTER INSERT OR UPDATE OF record_json ON conversation_record FOR EACH ROW WHEN (NEW.kind='message') EXECUTE FUNCTION orbit_index_message_files();

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1794268800000, 'ConsolidatedRecords1794268800000');

-- CompactOperationalStorage1794272400000

CREATE TABLE memory_operation (
      user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('candidate','job','receipt')), id TEXT NOT NULL,
      session_id TEXT REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      status TEXT NOT NULL, record_json TEXT NOT NULL DEFAULT '{}', result_json TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at BIGINT NOT NULL DEFAULT 0,
      lease_until BIGINT NOT NULL DEFAULT 0, lease_id TEXT, created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,kind,id),
      CHECK ((kind='receipt' AND session_id IS NULL AND status='completed') OR
        (kind='candidate' AND session_id IS NOT NULL AND status IN ('candidate','approved','deleted')) OR
        (kind='job' AND session_id IS NOT NULL AND status IN ('queued','running','completed','failed')))
    );

CREATE INDEX memory_operation_session ON memory_operation(session_id,user_id,kind,status,available_at DESC);

CREATE INDEX memory_operation_pending ON memory_operation(status,available_at) WHERE kind='job';

CREATE INDEX memory_operation_lease ON memory_operation(user_id,lease_until) WHERE kind='job' AND status='running';

CREATE TABLE request_record (
      user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ticket','idempotency')), scope TEXT NOT NULL, id TEXT NOT NULL,
      token_hash TEXT, session_id TEXT, origin TEXT, request_hash TEXT,
      state TEXT NOT NULL, status_code INTEGER, response_json TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,kind,scope,id),
      CHECK ((kind='ticket' AND token_hash IS NOT NULL AND state='issued') OR
        (kind='idempotency' AND request_hash IS NOT NULL AND state IN ('pending','completed')))
    );

CREATE UNIQUE INDEX request_record_token ON request_record(token_hash) WHERE kind='ticket';

CREATE INDEX request_record_expiry ON request_record(expires_at);

DROP TRIGGER IF EXISTS webpilot_revision_skill ON skill;

DROP FUNCTION IF EXISTS webpilot_revision_skill();

CREATE FUNCTION orbit_revision_skill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP <> 'INSERT' THEN INSERT INTO runtime_meta(key,value,updated_at)
        VALUES ('knowledge-revision:skills:user:' || OLD.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at)
        SELECT 'knowledge-revision:skills:shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE OLD.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF;
          IF TG_OP <> 'DELETE' THEN INSERT INTO runtime_meta(key,value,updated_at)
        VALUES ('knowledge-revision:skills:user:' || NEW.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at)
        SELECT 'knowledge-revision:skills:shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE NEW.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF; RETURN NULL; END $$;

CREATE TRIGGER orbit_revision_skill AFTER INSERT OR UPDATE OR DELETE ON skill FOR EACH ROW EXECUTE FUNCTION orbit_revision_skill();

DROP TRIGGER IF EXISTS webpilot_revision_personal_memory_item ON personal_memory_item;

DROP FUNCTION IF EXISTS webpilot_revision_personal_memory_item();

CREATE FUNCTION orbit_revision_personal_memory_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP <> 'INSERT' THEN INSERT INTO runtime_meta(key,value,updated_at)
        VALUES ('knowledge-revision:memories:user:' || OLD.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at)
        SELECT 'knowledge-revision:memories:shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE OLD.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF;
          IF TG_OP <> 'DELETE' THEN INSERT INTO runtime_meta(key,value,updated_at)
        VALUES ('knowledge-revision:memories:user:' || NEW.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at)
        SELECT 'knowledge-revision:memories:shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE NEW.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF; RETURN NULL; END $$;

CREATE TRIGGER orbit_revision_personal_memory_item AFTER INSERT OR UPDATE OR DELETE ON personal_memory_item FOR EACH ROW EXECUTE FUNCTION orbit_revision_personal_memory_item();

DELETE FROM execution_record WHERE kind IN ('event','compaction');

ALTER TABLE conversation_record ADD COLUMN record_gzip BYTEA;

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1794272400000, 'CompactOperationalStorage1794272400000');

COMMIT;
