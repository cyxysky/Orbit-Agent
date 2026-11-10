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

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788307200000, 'InitialBackendSchema1788307200000');

-- BrowserChatContextRecords1788566400000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788566400000, 'BrowserChatContextRecords1788566400000');

-- RuntimeReadIndexes1788652800000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788652800000, 'RuntimeReadIndexes1788652800000');

-- CommunicationConversations1788832800000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1788832800000, 'CommunicationConversations1788832800000');

-- PersonalMemoryReceipts1789084800000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1789084800000, 'PersonalMemoryReceipts1789084800000');

-- HybridRuntime1790000200000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790000200000, 'HybridRuntime1790000200000');

-- MemoryJobResults1790600000000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1790600000000, 'MemoryJobResults1790600000000');

-- RuntimeExecutionOwners1793836800000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1793836800000, 'RuntimeExecutionOwners1793836800000');

-- UserCookieIdentity1793923200000

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1793923200000, 'UserCookieIdentity1793923200000');

-- ConsolidatedRecords1794268800000

DROP FUNCTION IF EXISTS webpilot_index_message_files();

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1794268800000, 'ConsolidatedRecords1794268800000');

-- CompactOperationalStorage1794272400000

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

DROP FUNCTION IF EXISTS webpilot_revision_skill();

DROP FUNCTION IF EXISTS webpilot_revision_personal_memory_item();

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1794272400000, 'CompactOperationalStorage1794272400000');

-- WorkspaceStorage1794276000000

CREATE TABLE workspace_entity (
      kind TEXT NOT NULL CHECK(kind IN ('chat','archive','case','schedule','run','communication','runtime')),
      id TEXT NOT NULL, user_id TEXT, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 0, record_json TEXT NOT NULL DEFAULT '{}', summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', source_session_id TEXT, target_url TEXT,
      parent_kind TEXT, parent_id TEXT, link_kind TEXT, link_id TEXT,
      recurrence TEXT, enabled BOOLEAN, next_run_at TEXT, occurrence_key TEXT, trigger TEXT, lease_expires_at TEXT,
      integration_id TEXT, bot_id TEXT, first_event_at TEXT, last_event_at TEXT, archived_at TEXT,
      PRIMARY KEY(kind,id),
      FOREIGN KEY(parent_kind,parent_id) REFERENCES workspace_entity(kind,id) ON DELETE CASCADE,
      FOREIGN KEY(link_kind,link_id) REFERENCES workspace_entity(kind,id) ON DELETE SET NULL,
      CHECK ((kind IN ('schedule','run') AND parent_kind IS NOT NULL AND parent_kind='case' AND parent_id IS NOT NULL)
        OR (kind NOT IN ('schedule','run') AND parent_kind IS NULL AND parent_id IS NULL)),
      CHECK (kind='run' OR (link_kind IS NULL AND link_id IS NULL)),
      CHECK (link_kind IS NULL OR link_kind='schedule'),
      CHECK (link_id IS NULL OR (link_kind IS NOT NULL AND link_kind='schedule'))
    );

CREATE INDEX workspace_entity_owner_updated ON workspace_entity(kind,user_id,updated_at DESC,id DESC);

CREATE INDEX workspace_entity_owner_created ON workspace_entity(kind,user_id,created_at DESC,id DESC);

CREATE INDEX workspace_entity_updated ON workspace_entity(kind,updated_at DESC,id DESC);

CREATE INDEX workspace_entity_source ON workspace_entity(kind,source_session_id,updated_at DESC);

CREATE INDEX workspace_entity_parent ON workspace_entity(parent_kind,parent_id);

CREATE INDEX workspace_entity_parent_created ON workspace_entity(kind,parent_id,created_at DESC);

CREATE INDEX workspace_entity_link ON workspace_entity(link_kind,link_id);

CREATE INDEX workspace_entity_link_created ON workspace_entity(kind,link_id,created_at DESC);

CREATE INDEX workspace_entity_due ON workspace_entity(kind,enabled,next_run_at);

CREATE INDEX workspace_entity_status_created ON workspace_entity(kind,status,created_at);

CREATE INDEX workspace_entity_lease ON workspace_entity(kind,status,lease_expires_at);

CREATE INDEX workspace_entity_archive_time ON workspace_entity(kind,last_event_at DESC);

CREATE INDEX workspace_entity_archive_owner_time ON workspace_entity(kind,user_id,last_event_at DESC);

CREATE INDEX workspace_entity_communication ON workspace_entity(kind,integration_id,bot_id,updated_at DESC);

CREATE UNIQUE INDEX workspace_entity_occurrence ON workspace_entity(link_id,occurrence_key) WHERE kind='run' AND link_id IS NOT NULL AND occurrence_key IS NOT NULL;

CREATE TABLE workspace_record (
      collection TEXT NOT NULL, partition_id TEXT NOT NULL, kind TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', id TEXT NOT NULL,
      owner_kind TEXT, container_kind TEXT, container_id TEXT, parent_kind TEXT, parent_id TEXT,
      step_index INTEGER, time TEXT NOT NULL DEFAULT '', message_id TEXT,
      record_json TEXT NOT NULL DEFAULT '{}', record_gzip BYTEA,
      revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', expires_at TEXT,
      status TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
      available_at BIGINT NOT NULL DEFAULT 0, lease_until BIGINT NOT NULL DEFAULT 0, lease_id TEXT,
      result_json TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(collection,partition_id,kind,scope_id,id),
      FOREIGN KEY(owner_kind,partition_id) REFERENCES workspace_entity(kind,id) ON DELETE CASCADE,
      FOREIGN KEY(container_kind,container_id) REFERENCES workspace_entity(kind,id) ON DELETE CASCADE,
      FOREIGN KEY(collection,partition_id,parent_kind,scope_id,parent_id)
        REFERENCES workspace_record(collection,partition_id,kind,scope_id,id) ON DELETE CASCADE,
      CHECK (
        (collection='conversation' AND kind IN ('message','step','log','context','request','file') AND scope_id=''
          AND owner_kind IS NOT NULL AND owner_kind='chat' AND container_kind IS NULL AND container_id IS NULL) OR
        (collection='execution' AND kind IN ('state','call','variable') AND owner_kind IS NOT NULL AND owner_kind='runtime'
          AND container_kind IS NULL AND container_id IS NULL) OR
        (collection='memory' AND kind IN ('candidate','job','receipt') AND scope_id='' AND owner_kind IS NULL AND (
          (kind='receipt' AND container_kind IS NULL AND container_id IS NULL AND status='completed') OR
          (kind='candidate' AND container_kind IS NOT NULL AND container_kind='chat' AND container_id IS NOT NULL AND status IN ('candidate','approved','deleted')) OR
          (kind='job' AND container_kind IS NOT NULL AND container_kind='chat' AND container_id IS NOT NULL AND status IN ('queued','running','completed','failed')))) OR
        (collection='communication' AND kind='inbound' AND scope_id='' AND owner_kind IS NULL AND container_kind IS NULL AND container_id IS NULL)),
      CHECK ((collection='conversation' AND kind='file' AND parent_kind IS NOT NULL AND parent_kind='message' AND parent_id IS NOT NULL AND parent_id=id)
        OR (NOT (collection='conversation' AND kind='file') AND parent_kind IS NULL AND parent_id IS NULL))
    );

CREATE INDEX workspace_record_owner ON workspace_record(owner_kind,partition_id) WHERE owner_kind IS NOT NULL;

CREATE INDEX workspace_record_container ON workspace_record(container_kind,container_id) WHERE container_kind IS NOT NULL;

CREATE INDEX workspace_record_parent ON workspace_record(collection,partition_id,parent_kind,scope_id,parent_id) WHERE parent_kind IS NOT NULL;

CREATE INDEX workspace_record_time ON workspace_record(partition_id,kind,time DESC,id DESC) WHERE collection='conversation';

CREATE INDEX workspace_record_step ON workspace_record(partition_id,kind,step_index DESC) WHERE collection='conversation';

CREATE INDEX workspace_record_message ON workspace_record(partition_id,kind,message_id,time DESC) WHERE collection='conversation';

CREATE INDEX workspace_record_expiry ON workspace_record(expires_at) WHERE collection='execution' AND expires_at IS NOT NULL;

CREATE INDEX workspace_record_memory_session ON workspace_record(container_id,partition_id,kind,status,available_at DESC) WHERE collection='memory';

CREATE INDEX workspace_record_memory_pending ON workspace_record(status,available_at) WHERE collection='memory' AND kind='job';

CREATE INDEX workspace_record_memory_lease ON workspace_record(partition_id,lease_until) WHERE collection='memory' AND kind='job' AND status='running';

CREATE UNIQUE INDEX workspace_record_inbound_id ON workspace_record(id) WHERE collection='communication';

CREATE INDEX workspace_record_inbound_pending ON workspace_record(status,created_at,id) WHERE collection='communication';

CREATE INDEX workspace_record_inbound_conversation ON workspace_record(partition_id,status,created_at,id) WHERE collection='communication';

CREATE TABLE knowledge_record (
      kind TEXT NOT NULL CHECK(kind IN ('skill','memory')), id TEXT NOT NULL, user_id TEXT NOT NULL,
      shared BOOLEAN NOT NULL DEFAULT FALSE, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      scope TEXT, domain TEXT, type TEXT, memory_key TEXT, record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(kind,id),
      CHECK(kind<>'memory' OR (scope IS NOT NULL AND domain IS NOT NULL AND type IS NOT NULL AND memory_key IS NOT NULL))
    );

CREATE UNIQUE INDEX knowledge_record_memory_identity ON knowledge_record(user_id,scope,domain,type,memory_key) WHERE kind='memory';

CREATE INDEX knowledge_record_updated ON knowledge_record(kind,updated_at DESC,id DESC);

CREATE INDEX knowledge_record_user_updated ON knowledge_record(kind,user_id,updated_at DESC,id DESC);

CREATE INDEX knowledge_record_shared_updated ON knowledge_record(kind,shared,updated_at DESC,id DESC);

CREATE TABLE user_record (
      kind TEXT NOT NULL CHECK(kind IN ('profile','account','cookie')), user_id TEXT NOT NULL, id TEXT NOT NULL,
      shared BOOLEAN NOT NULL DEFAULT FALSE,
      domain TEXT, username TEXT, label TEXT, login_url TEXT, status TEXT, password_envelope TEXT,
      cookie TEXT, cookie_domain TEXT, cookie_fingerprint TEXT, onboarding_json TEXT, cookie_envelope TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0 CHECK(use_count>=0),
      PRIMARY KEY(kind,user_id,id),
      CHECK ((kind='profile' AND id=user_id AND password_envelope IS NULL AND cookie_envelope IS NULL) OR
        (kind='account' AND domain IS NOT NULL AND username IS NOT NULL AND label IS NOT NULL AND login_url IS NOT NULL
          AND status IS NOT NULL AND password_envelope IS NOT NULL AND cookie_envelope IS NULL
          AND cookie IS NULL AND cookie_domain IS NULL AND cookie_fingerprint IS NULL AND onboarding_json IS NULL) OR
        (kind='cookie' AND domain IS NOT NULL AND id=domain AND cookie_envelope IS NOT NULL AND password_envelope IS NULL
          AND cookie IS NULL AND cookie_domain IS NULL AND cookie_fingerprint IS NULL AND onboarding_json IS NULL)),
      CHECK(kind='account' OR shared=FALSE)
    );

CREATE UNIQUE INDEX user_record_account_id ON user_record(id) WHERE kind='account';

CREATE UNIQUE INDEX user_record_account_identity ON user_record(user_id,domain,username) WHERE kind='account';

CREATE UNIQUE INDEX user_record_cookie_identity ON user_record(cookie_domain,cookie_fingerprint) WHERE kind='profile' AND cookie_fingerprint IS NOT NULL;

CREATE INDEX user_record_owner_updated ON user_record(kind,user_id,updated_at DESC,id DESC);

CREATE INDEX user_record_account_shared ON user_record(shared,updated_at DESC) WHERE kind='account';

CREATE INDEX user_record_account_domain ON user_record(domain,updated_at DESC) WHERE kind='account';

DROP FUNCTION IF EXISTS orbit_index_message_files();

DROP FUNCTION IF EXISTS orbit_revision_skill();

DROP FUNCTION IF EXISTS orbit_revision_personal_memory_item();

CREATE FUNCTION orbit_workspace_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF COALESCE(CAST(NEW.record_json AS jsonb)->'attachments','[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) OR COALESCE(CAST(NEW.record_json AS jsonb)->'artifacts','[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) THEN INSERT INTO workspace_record(collection,partition_id,owner_kind,kind,id,time,record_json,parent_kind,parent_id)
      VALUES('conversation',NEW.partition_id,'chat','file',NEW.id,NEW.time,jsonb_build_object('id',NEW.id,'role',CAST(NEW.record_json AS jsonb)->'role','createdAt',CAST(NEW.record_json AS jsonb)->'createdAt','updatedAt',CAST(NEW.record_json AS jsonb)->'updatedAt','content','','attachments',CAST(NEW.record_json AS jsonb)->'attachments','artifacts',CAST(NEW.record_json AS jsonb)->'artifacts')::text,'message',NEW.id)
      ON CONFLICT(collection,partition_id,kind,scope_id,id) DO UPDATE SET time=excluded.time,record_json=excluded.record_json; ELSE DELETE FROM workspace_record WHERE collection='conversation' AND partition_id=NEW.partition_id AND kind='file' AND scope_id='' AND id=NEW.id; END IF; RETURN NULL; END $$;

CREATE TRIGGER orbit_workspace_files AFTER INSERT OR UPDATE OF record_json ON workspace_record FOR EACH ROW WHEN (NEW.collection='conversation' AND NEW.kind='message') EXECUTE FUNCTION orbit_workspace_files();

CREATE FUNCTION orbit_knowledge_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP <> 'INSERT' THEN INSERT INTO runtime_meta(key,value,updated_at) VALUES('knowledge-revision:' || (CASE WHEN OLD.kind='skill' THEN 'skills' ELSE 'memories' END) || ':user:' || OLD.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at) SELECT 'knowledge-revision:' || (CASE WHEN OLD.kind='skill' THEN 'skills' ELSE 'memories' END) || ':shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE OLD.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF;
        IF TG_OP <> 'DELETE' THEN INSERT INTO runtime_meta(key,value,updated_at) VALUES('knowledge-revision:' || (CASE WHEN NEW.kind='skill' THEN 'skills' ELSE 'memories' END) || ':user:' || NEW.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at) SELECT 'knowledge-revision:' || (CASE WHEN NEW.kind='skill' THEN 'skills' ELSE 'memories' END) || ':shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE NEW.shared=true
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at; END IF; RETURN NULL; END $$;

CREATE TRIGGER orbit_knowledge_revision AFTER INSERT OR UPDATE OR DELETE ON knowledge_record FOR EACH ROW EXECUTE FUNCTION orbit_knowledge_revision();

INSERT INTO typeorm_migration("timestamp", "name") VALUES (1794276000000, 'WorkspaceStorage1794276000000');

COMMIT;
