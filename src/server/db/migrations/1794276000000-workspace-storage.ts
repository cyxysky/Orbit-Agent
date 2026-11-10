import type { MigrationInterface, QueryRunner } from 'typeorm';

export const workspaceTables = ['browser_chat_session', 'ai_operations_chat_archive', 'automation_case',
  'automation_schedule', 'automation_run', 'communication_conversation', 'agent_runtime_owner',
  'conversation_record', 'execution_record', 'memory_operation', 'communication_inbound', 'skill', 'personal_memory_item',
  'application_user', 'login_account', 'browser_domain_cookie'] as const;

/** Shared physical storage with typed identities, indexed projections and database-enforced relationships. */
export class WorkspaceStorage1794276000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    const postgres = runner.connection.options.type === 'postgres';
    await runner.query(`CREATE TABLE workspace_entity (
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
    )`);
    for (const [name, columns] of [
      ['owner_updated', 'kind,user_id,updated_at DESC,id DESC'], ['owner_created', 'kind,user_id,created_at DESC,id DESC'],
      ['updated', 'kind,updated_at DESC,id DESC'], ['source', 'kind,source_session_id,updated_at DESC'],
      ['parent', 'parent_kind,parent_id'], ['parent_created', 'kind,parent_id,created_at DESC'],
      ['link', 'link_kind,link_id'], ['link_created', 'kind,link_id,created_at DESC'],
      ['due', 'kind,enabled,next_run_at'], ['status_created', 'kind,status,created_at'],
      ['lease', 'kind,status,lease_expires_at'], ['archive_time', 'kind,last_event_at DESC'],
      ['archive_owner_time', 'kind,user_id,last_event_at DESC'], ['communication', 'kind,integration_id,bot_id,updated_at DESC'],
    ]) await runner.query(`CREATE INDEX workspace_entity_${name} ON workspace_entity(${columns})`);
    await runner.query("CREATE UNIQUE INDEX workspace_entity_occurrence ON workspace_entity(link_id,occurrence_key) WHERE kind='run' AND link_id IS NOT NULL AND occurrence_key IS NOT NULL");

    await runner.query(`CREATE TABLE workspace_record (
      collection TEXT NOT NULL, partition_id TEXT NOT NULL, kind TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', id TEXT NOT NULL,
      owner_kind TEXT, container_kind TEXT, container_id TEXT, parent_kind TEXT, parent_id TEXT,
      step_index INTEGER, time TEXT NOT NULL DEFAULT '', message_id TEXT,
      record_json TEXT NOT NULL DEFAULT '{}', record_gzip ${postgres ? 'BYTEA' : 'BLOB'},
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
    )`);
    await runner.query('CREATE INDEX workspace_record_owner ON workspace_record(owner_kind,partition_id) WHERE owner_kind IS NOT NULL');
    await runner.query('CREATE INDEX workspace_record_container ON workspace_record(container_kind,container_id) WHERE container_kind IS NOT NULL');
    await runner.query('CREATE INDEX workspace_record_parent ON workspace_record(collection,partition_id,parent_kind,scope_id,parent_id) WHERE parent_kind IS NOT NULL');
    await runner.query("CREATE INDEX workspace_record_time ON workspace_record(partition_id,kind,time DESC,id DESC) WHERE collection='conversation'");
    await runner.query("CREATE INDEX workspace_record_step ON workspace_record(partition_id,kind,step_index DESC) WHERE collection='conversation'");
    await runner.query("CREATE INDEX workspace_record_message ON workspace_record(partition_id,kind,message_id,time DESC) WHERE collection='conversation'");
    await runner.query("CREATE INDEX workspace_record_expiry ON workspace_record(expires_at) WHERE collection='execution' AND expires_at IS NOT NULL");
    await runner.query("CREATE INDEX workspace_record_memory_session ON workspace_record(container_id,partition_id,kind,status,available_at DESC) WHERE collection='memory'");
    await runner.query("CREATE INDEX workspace_record_memory_pending ON workspace_record(status,available_at) WHERE collection='memory' AND kind='job'");
    await runner.query("CREATE INDEX workspace_record_memory_lease ON workspace_record(partition_id,lease_until) WHERE collection='memory' AND kind='job' AND status='running'");
    await runner.query("CREATE UNIQUE INDEX workspace_record_inbound_id ON workspace_record(id) WHERE collection='communication'");
    await runner.query("CREATE INDEX workspace_record_inbound_pending ON workspace_record(status,created_at,id) WHERE collection='communication'");
    await runner.query("CREATE INDEX workspace_record_inbound_conversation ON workspace_record(partition_id,status,created_at,id) WHERE collection='communication'");

    await runner.query(`CREATE TABLE knowledge_record (
      kind TEXT NOT NULL CHECK(kind IN ('skill','memory')), id TEXT NOT NULL, user_id TEXT NOT NULL,
      shared BOOLEAN NOT NULL DEFAULT ${postgres ? 'FALSE' : '0'}, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      scope TEXT, domain TEXT, type TEXT, memory_key TEXT, record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(kind,id),
      CHECK(kind<>'memory' OR (scope IS NOT NULL AND domain IS NOT NULL AND type IS NOT NULL AND memory_key IS NOT NULL))
    )`);
    await runner.query("CREATE UNIQUE INDEX knowledge_record_memory_identity ON knowledge_record(user_id,scope,domain,type,memory_key) WHERE kind='memory'");
    await runner.query('CREATE INDEX knowledge_record_updated ON knowledge_record(kind,updated_at DESC,id DESC)');
    await runner.query('CREATE INDEX knowledge_record_user_updated ON knowledge_record(kind,user_id,updated_at DESC,id DESC)');
    await runner.query('CREATE INDEX knowledge_record_shared_updated ON knowledge_record(kind,shared,updated_at DESC,id DESC)');

    await runner.query(`CREATE TABLE user_record (
      kind TEXT NOT NULL CHECK(kind IN ('profile','account','cookie')), user_id TEXT NOT NULL, id TEXT NOT NULL,
      shared BOOLEAN NOT NULL DEFAULT ${postgres ? 'FALSE' : '0'},
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
      CHECK(kind='account' OR shared=${postgres ? 'FALSE' : '0'})
    )`);
    await runner.query("CREATE UNIQUE INDEX user_record_account_id ON user_record(id) WHERE kind='account'");
    await runner.query("CREATE UNIQUE INDEX user_record_account_identity ON user_record(user_id,domain,username) WHERE kind='account'");
    await runner.query("CREATE UNIQUE INDEX user_record_cookie_identity ON user_record(cookie_domain,cookie_fingerprint) WHERE kind='profile' AND cookie_fingerprint IS NOT NULL");
    await runner.query('CREATE INDEX user_record_owner_updated ON user_record(kind,user_id,updated_at DESC,id DESC)');
    await runner.query("CREATE INDEX user_record_account_shared ON user_record(shared,updated_at DESC) WHERE kind='account'");
    await runner.query("CREATE INDEX user_record_account_domain ON user_record(domain,updated_at DESC) WHERE kind='account'");

    await runner.query(`INSERT INTO workspace_entity(kind,id,user_id,title,status,revision,record_json,summary_json,created_at,updated_at)
      SELECT 'chat',id,user_id,title,status,revision,snapshot_json,summary_json,created_at,updated_at FROM browser_chat_session`);
    await runner.query(`INSERT INTO workspace_entity(kind,id,user_id,record_json,first_event_at,last_event_at,archived_at,created_at,updated_at)
      SELECT 'archive',session_id,user_id,record_json,first_event_at,last_event_at,archived_at,first_event_at,archived_at FROM ai_operations_chat_archive`);
    await runner.query(`INSERT INTO workspace_entity(kind,id,user_id,source_session_id,title,target_url,record_json,created_at,updated_at)
      SELECT 'case',id,user_id,source_session_id,title,target_url,record_json,created_at,updated_at FROM automation_case`);
    await runner.query(`INSERT INTO workspace_entity(kind,id,user_id,parent_kind,parent_id,title,recurrence,enabled,next_run_at,record_json,created_at,updated_at)
      SELECT 'schedule',id,user_id,'case',case_id,title,recurrence,enabled,next_run_at,record_json,created_at,updated_at FROM automation_schedule`);
    await runner.query(`INSERT INTO workspace_entity(kind,id,user_id,parent_kind,parent_id,link_kind,link_id,occurrence_key,trigger,status,lease_expires_at,record_json,created_at,updated_at)
      SELECT 'run',id,user_id,'case',case_id,'schedule',schedule_id,occurrence_key,trigger,status,lease_expires_at,record_json,created_at,updated_at FROM automation_run`);
    await runner.query(`INSERT INTO workspace_entity(kind,id,integration_id,bot_id,user_id,record_json,updated_at)
      SELECT 'communication',id,integration_id,bot_id,user_id,record_json,updated_at FROM communication_conversation`);
    await runner.query("INSERT INTO workspace_entity(kind,id) SELECT 'runtime',id FROM agent_runtime_owner");
    const conversationCopy = `INSERT INTO workspace_record(collection,partition_id,owner_kind,kind,id,step_index,time,message_id,record_json,record_gzip,parent_kind,parent_id)
      SELECT 'conversation',session_id,'chat',kind,id,step_index,time,message_id,record_json,record_gzip,parent_kind,parent_id FROM conversation_record`;
    await runner.query(conversationCopy + " WHERE kind<>'file'");
    await runner.query(conversationCopy + " WHERE kind='file'");
    await runner.query(`INSERT INTO workspace_record(collection,partition_id,owner_kind,scope_id,kind,id,revision,record_json,updated_at,expires_at)
      SELECT 'execution',session_id,'runtime',scope_id,kind,id,revision,record_json,updated_at,expires_at FROM execution_record WHERE kind IN ('state','call','variable')`);
    await runner.query(`INSERT INTO workspace_record(collection,partition_id,kind,id,container_kind,container_id,status,record_json,result_json,error,attempts,available_at,lease_until,lease_id,created_at)
      SELECT 'memory',user_id,kind,id,CASE WHEN session_id IS NOT NULL THEN 'chat' ELSE NULL END,session_id,status,record_json,result_json,error,attempts,available_at,lease_until,lease_id,created_at FROM memory_operation`);
    await runner.query(`INSERT INTO workspace_record(collection,partition_id,kind,id,status,record_json,created_at,updated_at)
      SELECT 'communication',conversation_id,'inbound',id,status,record_json,created_at,updated_at FROM communication_inbound`);
    await runner.query(`INSERT INTO knowledge_record(kind,id,user_id,shared,title,status,record_json,created_at,updated_at)
      SELECT 'skill',id,user_id,shared,title,status,record_json,created_at,updated_at FROM skill`);
    await runner.query(`INSERT INTO knowledge_record(kind,id,user_id,shared,scope,domain,type,memory_key,status,record_json,created_at,updated_at)
      SELECT 'memory',id,user_id,shared,scope,domain,type,memory_key,status,record_json,created_at,updated_at FROM personal_memory_item`);
    await runner.query(`INSERT INTO user_record(kind,user_id,id,cookie,cookie_domain,cookie_fingerprint,onboarding_json,created_at,updated_at)
      SELECT 'profile',id,id,cookie,cookie_domain,cookie_fingerprint,onboarding_json,created_at,updated_at FROM application_user`);
    await runner.query(`INSERT INTO user_record(kind,user_id,id,shared,domain,username,label,login_url,status,password_envelope,created_at,updated_at,last_used_at,use_count)
      SELECT 'account',user_id,id,shared,domain,username,label,login_url,status,password_envelope,created_at,updated_at,last_used_at,use_count FROM login_account`);
    await runner.query(`INSERT INTO user_record(kind,user_id,id,domain,cookie_envelope,created_at,updated_at)
      SELECT 'cookie',user_id,domain,domain,cookie_envelope,created_at,updated_at FROM browser_domain_cookie`);
    // Drop children first so foreign-key actions cannot remove data still waiting to be copied.
    for (const table of ['conversation_record', 'execution_record', 'memory_operation', 'communication_inbound', 'automation_run',
      'automation_schedule', 'automation_case', 'communication_conversation', 'agent_runtime_owner', 'ai_operations_chat_archive',
      'browser_chat_session', 'skill', 'personal_memory_item', 'application_user', 'login_account', 'browser_domain_cookie']) await runner.query(`DROP TABLE ${table}`);
    if (postgres) for (const fn of ['orbit_index_message_files', 'orbit_revision_skill', 'orbit_revision_personal_memory_item']) {
      await runner.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    await this.installFileProjection(runner, postgres);
    await this.installKnowledgeRevision(runner, postgres);
  }

  private async installFileProjection(runner: QueryRunner, postgres: boolean) {
    const field = (key: string) => postgres ? `CAST(NEW.record_json AS jsonb)->'${key}'` : `json_extract(NEW.record_json,'$.${key}')`;
    const projection = postgres
      ? `jsonb_build_object('id',NEW.id,'role',${field('role')},'createdAt',${field('createdAt')},'updatedAt',${field('updatedAt')},'content','','attachments',${field('attachments')},'artifacts',${field('artifacts')})::text`
      : `json_object('id',NEW.id,'role',${field('role')},'createdAt',${field('createdAt')},'updatedAt',${field('updatedAt')},'content','','attachments',json(COALESCE(${field('attachments')},'[]')),'artifacts',json(COALESCE(${field('artifacts')},'[]')))`;
    const hasFiles = postgres
      ? `COALESCE(${field('attachments')},'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) OR COALESCE(${field('artifacts')},'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb)`
      : "COALESCE(json_array_length(NEW.record_json,'$.attachments'),0)>0 OR COALESCE(json_array_length(NEW.record_json,'$.artifacts'),0)>0";
    const upsert = `INSERT INTO workspace_record(collection,partition_id,owner_kind,kind,id,time,record_json,parent_kind,parent_id)
      VALUES('conversation',NEW.partition_id,'chat','file',NEW.id,NEW.time,${projection},'message',NEW.id)
      ON CONFLICT(collection,partition_id,kind,scope_id,id) DO UPDATE SET time=excluded.time,record_json=excluded.record_json`;
    const remove = "DELETE FROM workspace_record WHERE collection='conversation' AND partition_id=NEW.partition_id AND kind='file' AND scope_id='' AND id=NEW.id";
    if (postgres) {
      await runner.query(`CREATE FUNCTION orbit_workspace_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF ${hasFiles} THEN ${upsert}; ELSE ${remove}; END IF; RETURN NULL; END $$`);
      await runner.query("CREATE TRIGGER orbit_workspace_files AFTER INSERT OR UPDATE OF record_json ON workspace_record FOR EACH ROW WHEN (NEW.collection='conversation' AND NEW.kind='message') EXECUTE FUNCTION orbit_workspace_files()");
    } else for (const op of ['INSERT', 'UPDATE']) await runner.query(`CREATE TRIGGER orbit_workspace_files_${op.toLowerCase()}
      AFTER ${op} ON workspace_record WHEN NEW.collection='conversation' AND NEW.kind='message' BEGIN ${remove};
      INSERT INTO workspace_record(collection,partition_id,owner_kind,kind,id,time,record_json,parent_kind,parent_id)
      SELECT 'conversation',NEW.partition_id,'chat','file',NEW.id,NEW.time,${projection},'message',NEW.id WHERE ${hasFiles}; END`);
  }

  private async installKnowledgeRevision(runner: QueryRunner, postgres: boolean) {
    const bump = (row: string) => {
      const kind = `(CASE WHEN ${row}.kind='skill' THEN 'skills' ELSE 'memories' END)`;
      return `INSERT INTO runtime_meta(key,value,updated_at) VALUES('knowledge-revision:' || ${kind} || ':user:' || ${row}.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at) SELECT 'knowledge-revision:' || ${kind} || ':shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE ${row}.shared=${postgres ? 'true' : '1'}
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;`;
    };
    if (postgres) {
      await runner.query(`CREATE FUNCTION orbit_knowledge_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP <> 'INSERT' THEN ${bump('OLD')} END IF;
        IF TG_OP <> 'DELETE' THEN ${bump('NEW')} END IF; RETURN NULL; END $$`);
      await runner.query('CREATE TRIGGER orbit_knowledge_revision AFTER INSERT OR UPDATE OR DELETE ON knowledge_record FOR EACH ROW EXECUTE FUNCTION orbit_knowledge_revision()');
    } else for (const op of ['INSERT', 'UPDATE', 'DELETE']) await runner.query(`CREATE TRIGGER orbit_knowledge_revision_${op.toLowerCase()}
      AFTER ${op} ON knowledge_record BEGIN ${op !== 'INSERT' ? bump('OLD') : ''} ${op !== 'DELETE' ? bump('NEW') : ''} END`);
  }

  async down(): Promise<void> { throw new Error('Workspace storage consolidation is one-way. Restore a database backup to revert it.'); }
}
