import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Names used only by the one-way data migration and the fresh-schema exporter. */
export const consolidatedTables = [
  'browser_chat_message', 'browser_chat_step', 'browser_chat_log',
  'browser_chat_context_record', 'browser_chat_context_request', 'browser_chat_file_message',
  'agent_runtime_state', 'agent_runtime_event', 'agent_runtime_call', 'agent_runtime_compaction',
  'browser_code_runtime_state', 'app_config', 'user_onboarding_state',
] as const;

export class ConsolidatedRecords1794268800000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    const postgres = runner.connection.options.type === 'postgres';
    await runner.query(`CREATE TABLE conversation_record (
      session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('message','step','log','context','request','file')),
      id TEXT NOT NULL, step_index INTEGER, time TEXT NOT NULL DEFAULT '', message_id TEXT,
      record_json TEXT NOT NULL, parent_kind TEXT, parent_id TEXT,
      PRIMARY KEY(session_id,kind,id),
      FOREIGN KEY(session_id,parent_kind,parent_id) REFERENCES conversation_record(session_id,kind,id) ON DELETE CASCADE
    )`);
    await runner.query('CREATE INDEX conversation_record_time ON conversation_record(session_id,kind,time DESC,id DESC)');
    await runner.query('CREATE INDEX conversation_record_step ON conversation_record(session_id,kind,step_index DESC)');
    await runner.query('CREATE INDEX conversation_record_message ON conversation_record(session_id,kind,message_id,time DESC)');
    await runner.query(`CREATE TABLE execution_record (
      session_id TEXT NOT NULL REFERENCES agent_runtime_owner(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('state','event','call','compaction','variable')),
      id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, record_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT '', expires_at TEXT,
      PRIMARY KEY(session_id,scope_id,kind,id)
    )`);
    await runner.query('CREATE INDEX execution_record_expiry ON execution_record(expires_at) WHERE expires_at IS NOT NULL');
    await runner.query("INSERT INTO agent_runtime_owner(id) SELECT DISTINCT session_id FROM browser_code_runtime_state WHERE true ON CONFLICT(id) DO NOTHING");
    for (const [table, kind, columns, values] of [
      ['browser_chat_message', 'message', 'time', 'time'],
      ['browser_chat_log', 'log', 'time,message_id', 'time,message_id'],
      ['browser_chat_context_record', 'context', '', ''],
      ['browser_chat_context_request', 'request', '', ''],
    ]) {
      await runner.query(`INSERT INTO conversation_record(session_id,kind,id,record_json${columns ? `,${columns}` : ''})
        SELECT session_id,'${kind}',id,${kind === 'request' ? 'manifest_json' : 'record_json'}${values ? `,${values}` : ''} FROM ${table}`);
    }
    await runner.query("INSERT INTO conversation_record(session_id,kind,id,step_index,record_json) SELECT session_id,'step',CAST(step_index AS TEXT),step_index,record_json FROM browser_chat_step");
    await runner.query("INSERT INTO conversation_record(session_id,kind,id,time,record_json,parent_kind,parent_id) SELECT session_id,'file',id,time,record_json,'message',id FROM browser_chat_file_message");
    await runner.query("INSERT INTO execution_record(session_id,scope_id,kind,id,revision,record_json) SELECT session_id,scope_id,'state','current',revision,record_json FROM agent_runtime_state");
    await runner.query("INSERT INTO execution_record(session_id,scope_id,kind,id,revision,record_json) SELECT session_id,scope_id,'event',CAST(revision AS TEXT),revision,event_json FROM agent_runtime_event");
    await runner.query("INSERT INTO execution_record(session_id,scope_id,kind,id) SELECT session_id,scope_id,'call',call_id FROM agent_runtime_call");
    await runner.query("INSERT INTO execution_record(session_id,scope_id,kind,id,revision,record_json) SELECT session_id,scope_id,'compaction',CAST(epoch AS TEXT),epoch,snapshot_json FROM agent_runtime_compaction");
    await runner.query("INSERT INTO execution_record(session_id,scope_id,kind,id,revision,record_json,updated_at,expires_at) SELECT session_id,namespace,'variable',key,revision,value_json,updated_at,expires_at FROM browser_code_runtime_state");
    await runner.query("INSERT INTO runtime_meta(key,value,updated_at) SELECT 'app:runtime',runtime_env_json,updated_at FROM app_config");
    await runner.query("INSERT INTO runtime_meta(key,value,updated_at) SELECT 'app:model',model_config_json,updated_at FROM app_config WHERE model_config_json IS NOT NULL");
    await runner.query('ALTER TABLE application_user ADD COLUMN onboarding_json TEXT');
    const onboarding = postgres
      ? "json_build_object('tutorialVersion',tutorial_version,'status',status,'completedSteps',CAST(completed_steps_json AS json),'dismissedAt',dismissed_at,'updatedAt',updated_at)::text"
      : "json_object('tutorialVersion',tutorial_version,'status',status,'completedSteps',json(completed_steps_json),'dismissedAt',dismissed_at,'updatedAt',updated_at)";
    await runner.query(`INSERT INTO application_user(id,onboarding_json,created_at,updated_at)
      SELECT user_id,${onboarding},created_at,updated_at FROM user_onboarding_state WHERE true
      ON CONFLICT(id) DO UPDATE SET onboarding_json=excluded.onboarding_json`);
    // The file projection owns a foreign key to messages; drop it first.
    for (const table of [...consolidatedTables].reverse().filter(table => table !== 'browser_chat_file_message')) {
      if (table === 'browser_chat_message') await runner.query('DROP TABLE browser_chat_file_message');
      await runner.query(`DROP TABLE ${table}`);
    }
    if (postgres) await runner.query('DROP FUNCTION IF EXISTS webpilot_index_message_files()');
    await this.createFileProjection(runner, postgres);
  }

  private async createFileProjection(runner: QueryRunner, postgres: boolean) {
    const field = (key: string) => postgres ? `CAST(NEW.record_json AS jsonb)->'${key}'` : `json_extract(NEW.record_json,'$.${key}')`;
    const projection = postgres
      ? `jsonb_build_object('id',NEW.id,'role',${field('role')},'createdAt',${field('createdAt')},'updatedAt',${field('updatedAt')},'content','','attachments',${field('attachments')},'artifacts',${field('artifacts')})::text`
      : `json_object('id',NEW.id,'role',${field('role')},'createdAt',${field('createdAt')},'updatedAt',${field('updatedAt')},'content','','attachments',json(COALESCE(${field('attachments')},'[]')),'artifacts',json(COALESCE(${field('artifacts')},'[]')))`;
    const hasFiles = postgres
      ? `COALESCE(${field('attachments')},'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb) OR COALESCE(${field('artifacts')},'[]'::jsonb) NOT IN ('[]'::jsonb,'null'::jsonb)`
      : "COALESCE(json_array_length(NEW.record_json,'$.attachments'),0)>0 OR COALESCE(json_array_length(NEW.record_json,'$.artifacts'),0)>0";
    const upsert = `INSERT INTO conversation_record(session_id,kind,id,time,record_json,parent_kind,parent_id)
      VALUES(NEW.session_id,'file',NEW.id,NEW.time,${projection},'message',NEW.id)
      ON CONFLICT(session_id,kind,id) DO UPDATE SET time=excluded.time,record_json=excluded.record_json`;
    const remove = "DELETE FROM conversation_record WHERE session_id=NEW.session_id AND kind='file' AND id=NEW.id";
    if (postgres) {
      await runner.query(`CREATE FUNCTION orbit_index_message_files() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF ${hasFiles} THEN ${upsert}; ELSE ${remove}; END IF; RETURN NULL; END $$`);
      await runner.query("CREATE TRIGGER orbit_message_files AFTER INSERT OR UPDATE OF record_json ON conversation_record FOR EACH ROW WHEN (NEW.kind='message') EXECUTE FUNCTION orbit_index_message_files()");
    } else {
      for (const operation of ['INSERT', 'UPDATE']) await runner.query(`CREATE TRIGGER orbit_message_files_${operation.toLowerCase()}
        AFTER ${operation} ON conversation_record WHEN NEW.kind='message' BEGIN
        ${remove}; INSERT INTO conversation_record(session_id,kind,id,time,record_json,parent_kind,parent_id)
        SELECT NEW.session_id,'file',NEW.id,NEW.time,${projection},'message',NEW.id WHERE ${hasFiles}; END`);
    }
  }

  async down(): Promise<void> {
    throw new Error('Record consolidation is a one-way migration. Restore a database backup to revert it.');
  }
}
