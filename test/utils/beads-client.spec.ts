/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';

const proxyquire = require('proxyquire').noCallThru();

/**
 * Build a stub execFile that records every (cmd, args) call and returns
 * canned (err, stdout, stderr) per call.
 */
const buildExecFileStub = (
  responses: Array<{ err?: Error & { code?: string }; stdout?: string; stderr?: string }>,
) => {
  let callIdx = 0;
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const stub = (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    calls.push({ cmd, args });
    const r = responses[callIdx++] ?? { stdout: '', stderr: '' };
    setImmediate(() => cb(r.err ?? null, r.stdout ?? '', r.stderr ?? ''));
  };
  return { stub, calls };
};

const loadClient = (responses: Array<{ err?: Error & { code?: string }; stdout?: string; stderr?: string }>) => {
  const { stub, calls } = buildExecFileStub(responses);
  const mod = proxyquire('../../src/utils/beads-client', {
    child_process: { execFile: stub },
  });
  return { BeadsClient: mod.BeadsClient, BeadsCodeGenSession: mod.BeadsCodeGenSession, calls };
};

describe('BeadsClient (v9a.4) — bd CLI wrapper', () => {
  it('serializes "create" args including --json + description + labels + type + parent + priority', async () => {
    const { BeadsClient, calls } = loadClient([
      { stdout: JSON.stringify({ id: 'cht-abc', title: 't', status: 'open', priority: 1, issue_type: 'task', description: '', created_at: '', updated_at: '' }) },
    ]);
    const client = new BeadsClient();
    await client.create({
      title: 'My title',
      description: 'desc',
      labels: ['l1', 'l2'],
      type: 'task',
      parent: 'cht-parent',
      priority: '2',
    });
    expect(calls).to.have.length(1);
    expect(calls[0].cmd).to.equal('bd');
    expect(calls[0].args).to.deep.equal([
      'create', 'My title', '--json',
      '-d', 'desc',
      '-l', 'l1,l2',
      '-t', 'task',
      '--parent', 'cht-parent',
      '-p', '2',
    ]);
  });

  it('omits optional create fields when not supplied', async () => {
    const { BeadsClient, calls } = loadClient([
      { stdout: '{"id":"cht-x","title":"t","status":"open","priority":1,"issue_type":"task","description":"","created_at":"","updated_at":""}' },
    ]);
    const client = new BeadsClient();
    await client.create({ title: 'bare' });
    expect(calls[0].args).to.deep.equal(['create', 'bare', '--json']);
  });

  it('parses the bd JSON response into a typed BeadsIssue', async () => {
    const issue = { id: 'cht-1', title: 'T', status: 'open', priority: 1, issue_type: 'task', description: 'd', created_at: 'now', updated_at: 'now' };
    const { BeadsClient } = loadClient([{ stdout: JSON.stringify(issue) }]);
    const client = new BeadsClient();
    const result = await client.create({ title: 'T' });
    expect(result.id).to.equal('cht-1');
    expect(result.title).to.equal('T');
  });

  it('falls back to a plain string when stdout is not valid JSON', async () => {
    // exec() resolves with stdout-as-string when JSON.parse fails. We can
    // exercise it via configSet which does not expect a return.
    const { BeadsClient, calls } = loadClient([{ stdout: 'OK' }]);
    const client = new BeadsClient();
    let threw = false;
    try {
      await client.configSet('status.custom', 'generating,completed,failed');
    } catch { threw = true; }
    expect(threw).to.equal(false);
    expect(calls[0].args).to.deep.equal(['config', 'set', 'status.custom', 'generating,completed,failed']);
  });

  it('serializes update with per-label flags for addLabels / removeLabels', async () => {
    const { BeadsClient, calls } = loadClient([{ stdout: '' }]);
    const client = new BeadsClient();
    await client.update('cht-1', {
      status: 'in_progress',
      description: 'updated',
      notes: 'see below',
      addLabels: ['a', 'b'],
      removeLabels: ['c'],
    });
    expect(calls[0].args).to.deep.equal([
      'update', 'cht-1',
      '-s', 'in_progress',
      '-d', 'updated',
      '--notes', 'see below',
      '--add-label', 'a',
      '--add-label', 'b',
      '--remove-label', 'c',
    ]);
  });

  it('routes short comments through the inline "comment" subcommand', async () => {
    const { BeadsClient, calls } = loadClient([{ stdout: '' }]);
    const client = new BeadsClient();
    await client.addComment('cht-1', 'short text');
    expect(calls[0].args).to.deep.equal(['comment', 'cht-1', 'short text']);
  });

  it('routes long comments (over 4096 chars) through the "-f <file>" subcommand', async () => {
    const { BeadsClient, calls } = loadClient([{ stdout: '' }]);
    const client = new BeadsClient();
    const longText = 'x'.repeat(5000);
    await client.addComment('cht-1', longText);
    expect(calls).to.have.length(1);
    expect(calls[0].args[0]).to.equal('comment');
    expect(calls[0].args[1]).to.equal('cht-1');
    expect(calls[0].args[2]).to.equal('-f');
    // The 4th arg is a tmp file path; assert it exists in the shape only.
    expect(calls[0].args[3]).to.match(/beads-comment-.+/);
  });

  it('serializes "dep add" with default blocks type', async () => {
    const { BeadsClient, calls } = loadClient([{ stdout: '' }]);
    const client = new BeadsClient();
    await client.addDependency('cht-a', 'cht-b');
    expect(calls[0].args).to.deep.equal(['dep', 'add', 'cht-a', 'cht-b', '-t', 'blocks']);
  });

  it('serializes "close" with the issue id', async () => {
    const { BeadsClient, calls } = loadClient([{ stdout: '' }]);
    const client = new BeadsClient();
    await client.close('cht-1');
    expect(calls[0].args).to.deep.equal(['close', 'cht-1']);
  });

  it('show() returns the first element when bd emits an array', async () => {
    const { BeadsClient } = loadClient([{ stdout: '[{"id":"cht-1","title":"only one"}]' }]);
    const client = new BeadsClient();
    const issue = await client.show('cht-1');
    expect(issue.id).to.equal('cht-1');
    expect(issue.title).to.equal('only one');
  });

  it('listComments returns the parsed array, or [] when bd returns a non-array', async () => {
    const arr = [{ text: 'hi', created_at: 'now' }];
    const { BeadsClient: ClientA } = loadClient([{ stdout: JSON.stringify(arr) }]);
    const a = await new ClientA().listComments('cht-1');
    expect(a).to.deep.equal(arr);

    const { BeadsClient: ClientB } = loadClient([{ stdout: '{"not":"array"}' }]);
    const b = await new ClientB().listComments('cht-1');
    expect(b).to.deep.equal([]);
  });

  it('rejects with a formatted error when bd exits non-zero, including stderr context', async () => {
    const err = Object.assign(new Error('exit 1'), { code: 'EXIT' as string });
    const { BeadsClient } = loadClient([{ err, stdout: '', stderr: 'bd: not authenticated' }]);
    const client = new BeadsClient();
    let caught: Error | null = null;
    try { await client.show('cht-x'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/bd show failed/);
    expect(caught!.message).to.match(/not authenticated/);
  });
});

describe('BeadsCodeGenSession (v9a.4) — orchestration over BeadsClient', () => {
  /** A sinon-stubbed BeadsClient instance for injecting into the session. */
  const buildStubClient = () => ({
    configSet: sinon.stub().resolves(),
    create: sinon.stub(),
    update: sinon.stub().resolves(),
    addComment: sinon.stub().resolves(),
    addDependency: sinon.stub().resolves(),
    close: sinon.stub().resolves(),
  });

  it('initSession creates a codegen-session epic and stores its id', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.resolves({ id: 'cht-epic-1', title: 'codegen: t' });
    const session = new BeadsCodeGenSession(client);
    const id = await session.initSession('Add filters', 'contacts');
    expect(id).to.equal('cht-epic-1');
    expect(session.getSessionId()).to.equal('cht-epic-1');
    // The session sets custom statuses on init.
    expect(client.configSet.calledOnceWithExactly('status.custom', 'generating,completed,failed')).to.equal(true);
    // The session creates an epic with the codegen-session label.
    const createArgs = client.create.firstCall.args[0];
    expect(createArgs.type).to.equal('epic');
    expect(createArgs.labels).to.deep.equal(['codegen-session']);
    expect(createArgs.title).to.match(/^codegen: Add filters/);
  });

  it('recordPlan creates one task per plan item and wires sequential dependencies', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.onCall(0).resolves({ id: 'cht-epic', title: 'codegen' });
    client.create.onCall(1).resolves({ id: 'cht-task-1', title: 'CREATE a.ts' });
    client.create.onCall(2).resolves({ id: 'cht-task-2', title: 'CREATE b.ts' });
    client.create.onCall(3).resolves({ id: 'cht-task-3', title: 'MODIFY c.ts' });
    const session = new BeadsCodeGenSession(client);
    await session.initSession('t', 'd');

    const ids = await session.recordPlan([
      { action: 'CREATE', filePath: 'a.ts', rationale: 'r1' },
      { action: 'CREATE', filePath: 'b.ts', rationale: 'r2' },
      { action: 'MODIFY', filePath: 'c.ts', rationale: 'r3' },
    ]);

    expect(ids.get('a.ts')).to.equal('cht-task-1');
    expect(ids.get('b.ts')).to.equal('cht-task-2');
    expect(ids.get('c.ts')).to.equal('cht-task-3');
    // Two dependency wirings: task2→task1, task3→task2.
    expect(client.addDependency.callCount).to.equal(2);
    expect(client.addDependency.firstCall.args).to.deep.equal(['cht-task-2', 'cht-task-1']);
    expect(client.addDependency.secondCall.args).to.deep.equal(['cht-task-3', 'cht-task-2']);
  });

  it('recordPlan throws when the session has not been initialised', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    const session = new BeadsCodeGenSession(client);
    let threw = false;
    try {
      await session.recordPlan([{ action: 'CREATE', filePath: 'a.ts', rationale: 'r' }]);
    } catch { threw = true; }
    expect(threw).to.equal(true);
  });

  it('markFileInProgress / recordFileCompleted / recordFileFailed only act on known plan paths', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.onCall(0).resolves({ id: 'cht-epic' });
    client.create.onCall(1).resolves({ id: 'cht-task-1' });
    const session = new BeadsCodeGenSession(client);
    await session.initSession('t', 'd');
    await session.recordPlan([{ action: 'CREATE', filePath: 'a.ts', rationale: 'r' }]);

    // Known path → invokes update.
    await session.markFileInProgress('a.ts');
    expect(client.update.calledWith('cht-task-1', { status: 'in_progress' })).to.equal(true);

    // Unknown path → silent no-op (no update call beyond the known one).
    const callCountBefore = client.update.callCount;
    await session.markFileInProgress('ghost.ts');
    expect(client.update.callCount).to.equal(callCountBefore);
  });

  it('recordFileCompleted updates status=completed and adds a "Generated successfully" comment', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.onCall(0).resolves({ id: 'cht-epic' });
    client.create.onCall(1).resolves({ id: 'cht-task-1' });
    const session = new BeadsCodeGenSession(client);
    await session.initSession('t', 'd');
    await session.recordPlan([{ action: 'CREATE', filePath: 'a.ts', rationale: 'r' }]);

    await session.recordFileCompleted('a.ts', 'export const a = 1;', 'Implementation file');

    expect(client.update.calledWith('cht-task-1', { status: 'completed' })).to.equal(true);
    const commentCall = client.addComment.getCall(client.addComment.callCount - 1);
    expect(commentCall.args[0]).to.equal('cht-task-1');
    expect(commentCall.args[1]).to.match(/Generated successfully/);
    expect(commentCall.args[1]).to.match(/Implementation file/);
    expect(commentCall.args[1]).to.match(/export const a = 1;/);
  });

  it('recordFileFailed updates status=failed and adds a "All attempts failed" comment', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.onCall(0).resolves({ id: 'cht-epic' });
    client.create.onCall(1).resolves({ id: 'cht-task-1' });
    const session = new BeadsCodeGenSession(client);
    await session.initSession('t', 'd');
    await session.recordPlan([{ action: 'CREATE', filePath: 'a.ts', rationale: 'r' }]);

    await session.recordFileFailed('a.ts', ['syntax error', 'no symbol']);

    expect(client.update.calledWith('cht-task-1', { status: 'failed' })).to.equal(true);
    const commentArg = client.addComment.lastCall.args[1] as string;
    expect(commentArg).to.match(/All attempts failed/);
    expect(commentArg).to.match(/syntax error/);
    expect(commentArg).to.match(/no symbol/);
  });

  it('closeSession updates notes with counts and closes the epic', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    client.create.resolves({ id: 'cht-epic-1' });
    const session = new BeadsCodeGenSession(client);
    await session.initSession('t', 'd');

    await session.closeSession(10, 8, 2);

    expect(client.update.calledWith('cht-epic-1', { notes: '10 file(s): 8 succeeded, 2 failed' })).to.equal(true);
    expect(client.close.calledOnceWithExactly('cht-epic-1')).to.equal(true);
  });

  it('closeSession is a silent no-op when the session was never initialised', async () => {
    const { BeadsCodeGenSession } = loadClient([]);
    const client = buildStubClient();
    const session = new BeadsCodeGenSession(client);
    await session.closeSession(0, 0, 0);
    expect(client.update.called).to.equal(false);
    expect(client.close.called).to.equal(false);
  });
});
