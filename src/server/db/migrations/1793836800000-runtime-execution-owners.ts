import { TableForeignKey, type MigrationInterface, type QueryRunner } from 'typeorm';

const runtimeTables = ['agent_runtime_state', 'agent_runtime_event', 'agent_runtime_call', 'agent_runtime_compaction'];

async function referenceOwner(runner: QueryRunner, ownerTable: string) {
  for (const name of runtimeTables) {
    const table = await runner.getTable(name);
    if (!table) throw new Error(`Missing runtime table: ${name}`);
    for (const key of table.foreignKeys.filter(key => key.columnNames.length === 1 && key.columnNames[0] === 'session_id')) await runner.dropForeignKey(table, key);
    await runner.createForeignKey(name, new TableForeignKey({ columnNames: ['session_id'], referencedTableName: ownerTable, referencedColumnNames: ['id'], onDelete: 'CASCADE' }));
  }
}

/** Execution state belongs to an execution identity, independent of its UI or trigger. */
export class RuntimeExecutionOwners1793836800000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE agent_runtime_owner (id TEXT PRIMARY KEY)');
    for (const name of runtimeTables) await runner.query(`INSERT INTO agent_runtime_owner (id) SELECT DISTINCT session_id FROM ${name} WHERE 1 = 1 ON CONFLICT (id) DO NOTHING`);
    await referenceOwner(runner, 'agent_runtime_owner');
  }
  async down(runner: QueryRunner) {
    const independent = await runner.query('SELECT id FROM agent_runtime_owner WHERE id NOT IN (SELECT id FROM browser_chat_session) LIMIT 1');
    if (independent.length) throw new Error('Cannot restore conversation-only ownership while independent execution records exist.');
    await referenceOwner(runner, 'browser_chat_session');
    await runner.query('DROP TABLE agent_runtime_owner');
  }
}
