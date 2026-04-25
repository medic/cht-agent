import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  labels?: string[];
}

export interface BeadsComment {
  text: string;
  author?: string;
  created_at: string;
}

export interface BeadsCreateOptions {
  title: string;
  description?: string;
  labels?: string[];
  type?: 'bug' | 'feature' | 'task' | 'epic' | 'chore';
  parent?: string;
  priority?: string;
}

export interface BeadsUpdateOptions {
  status?: string;
  description?: string;
  notes?: string;
  addLabels?: string[];
  removeLabels?: string[];
}

const COMMENT_FILE_THRESHOLD = 4096;

/**
 * Low-level wrapper around the bd (Beads) CLI.
 * All read commands append --json and parse stdout.
 */
export class BeadsClient {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async create(options: BeadsCreateOptions): Promise<BeadsIssue> {
    const args = ['create', options.title, '--json'];
    if (options.description) args.push('-d', options.description);
    if (options.labels?.length) args.push('-l', options.labels.join(','));
    if (options.type) args.push('-t', options.type);
    if (options.parent) args.push('--parent', options.parent);
    if (options.priority) args.push('-p', options.priority);
    return await this.exec(args) as BeadsIssue;
  }

  async update(id: string, options: BeadsUpdateOptions): Promise<void> {
    const args = ['update', id];
    if (options.status) args.push('-s', options.status);
    if (options.description) args.push('-d', options.description);
    if (options.notes) args.push('--notes', options.notes);
    if (options.addLabels?.length) {
      for (const label of options.addLabels) {
        args.push('--add-label', label);
      }
    }
    if (options.removeLabels?.length) {
      for (const label of options.removeLabels) {
        args.push('--remove-label', label);
      }
    }
    await this.exec(args);
  }

  async addComment(id: string, text: string): Promise<void> {
    if (text.length > COMMENT_FILE_THRESHOLD) {
      await this.addCommentViaFile(id, text);
    } else {
      await this.exec(['comment', id, text]);
    }
  }

  async addDependency(issueId: string, dependsOnId: string, type = 'blocks'): Promise<void> {
    await this.exec(['dep', 'add', issueId, dependsOnId, '-t', type]);
  }

  async close(id: string): Promise<void> {
    await this.exec(['close', id]);
  }

  async show(id: string): Promise<BeadsIssue> {
    const result = await this.exec(['show', id, '--json']);
    if (Array.isArray(result)) return result[0] as BeadsIssue;
    return result as BeadsIssue;
  }

  async listComments(id: string): Promise<BeadsComment[]> {
    const result = await this.exec(['comments', id, '--json']);
    if (Array.isArray(result)) return result as BeadsComment[];
    return [];
  }

  async configSet(key: string, value: string): Promise<void> {
    await this.exec(['config', 'set', key, value]);
  }

  private async addCommentViaFile(id: string, text: string): Promise<void> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-comment-'));
    const tmpFile = path.join(tmpDir, 'comment.txt');
    try {
      fs.writeFileSync(tmpFile, text, 'utf-8');
      await this.exec(['comment', id, '-f', tmpFile]);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch { /* cleanup best-effort */ }
    }
  }

  private async exec(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      execFile('bd', args, { cwd: this.cwd, timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`bd ${args[0]} failed: ${error.message}${stderr ? ` (${stderr.trim()})` : ''}`));
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(trimmed));
        } catch {
          resolve(trimmed);
        }
      });
    });
  }
}

/**
 * Manages a single code-generation session in Beads.
 * Creates a root epic issue and child task issues for each plan item.
 */
export class BeadsCodeGenSession {
  private client: BeadsClient;
  private sessionId: string | null = null;
  private planItemIds: Map<string, string> = new Map();

  constructor(client?: BeadsClient) {
    this.client = client ?? new BeadsClient();
  }

  async initSession(ticketTitle: string, domain: string): Promise<string> {
    // Set custom statuses (idempotent)
    await this.client.configSet('status.custom', 'generating,completed,failed');

    const title = `codegen: ${ticketTitle}`.slice(0, 80);
    const issue = await this.client.create({
      title,
      description: `Code generation session for domain: ${domain}`,
      labels: ['codegen-session'],
      type: 'epic',
    });
    this.sessionId = issue.id;
    console.log(`[Beads] Session created: ${this.sessionId}`);
    return this.sessionId;
  }

  async recordPlan(plan: Array<{ action: string; filePath: string; rationale: string }>): Promise<Map<string, string>> {
    if (!this.sessionId) throw new Error('Session not initialized');

    let previousId: string | null = null;
    for (const item of plan) {
      const title = `${item.action} ${item.filePath}`;
      const issue = await this.client.create({
        title,
        description: item.rationale,
        labels: ['codegen-file'],
        type: 'task',
        parent: this.sessionId,
      });
      this.planItemIds.set(item.filePath, issue.id);

      // Wire sequential dependency
      if (previousId) {
        await this.client.addDependency(issue.id, previousId);
      }
      previousId = issue.id;
    }

    console.log(`[Beads] Recorded ${plan.length} plan item(s)`);
    return this.planItemIds;
  }

  async markFileInProgress(filePath: string): Promise<void> {
    const id = this.planItemIds.get(filePath);
    if (!id) return;
    await this.client.update(id, { status: 'in_progress' });
  }

  async recordAttemptFailure(filePath: string, attempt: number, failures: string[]): Promise<void> {
    const id = this.planItemIds.get(filePath);
    if (!id) return;
    await this.client.addComment(id, `Attempt ${attempt} failed: ${failures.join('; ')}`);
  }

  async recordFileCompleted(filePath: string, content: string, purpose?: string): Promise<void> {
    const id = this.planItemIds.get(filePath);
    if (!id) return;
    await this.client.update(id, { status: 'completed' });
    const commentText = purpose
      ? `Generated successfully.\nPurpose: ${purpose}\n\n---\n${content}`
      : `Generated successfully.\n\n---\n${content}`;
    await this.client.addComment(id, commentText);
  }

  async recordFileFailed(filePath: string, lastFailures: string[]): Promise<void> {
    const id = this.planItemIds.get(filePath);
    if (!id) return;
    await this.client.update(id, { status: 'failed' });
    await this.client.addComment(id, `All attempts failed. Last failures: ${lastFailures.join('; ')}`);
  }

  async closeSession(totalFiles: number, successCount: number, failCount: number): Promise<void> {
    if (!this.sessionId) return;
    await this.client.update(this.sessionId, {
      notes: `${totalFiles} file(s): ${successCount} succeeded, ${failCount} failed`,
    });
    await this.client.close(this.sessionId);
    console.log(`[Beads] Session closed: ${successCount}/${totalFiles} succeeded`);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getPlanItemIds(): Map<string, string> {
    return this.planItemIds;
  }
}
