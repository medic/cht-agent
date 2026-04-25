/**
 * Todo Tracker Utility
 *
 * Provides todo tracking for agents and supervisors.
 * Displays progress in the console for visibility and productivity tracking.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface TodoTrackerOptions {
  /** Name of the agent/supervisor using this tracker */
  name: string;
  /** Whether to print todos to console (default: true) */
  verbose?: boolean;
  /** Prefix for console output */
  prefix?: string;
}

/**
 * TodoTracker class for managing todos within an agent or supervisor
 */
export class TodoTracker {
  private todos: Map<string, Todo> = new Map();
  private name: string;
  private verbose: boolean;
  private prefix: string;
  private idCounter = 0;

  constructor(options: TodoTrackerOptions) {
    this.name = options.name;
    this.verbose = options.verbose ?? true;
    this.prefix = options.prefix ?? `[${this.name}]`;
  }

  /**
   * Add a new todo
   */
  add(content: string, activeForm: string): string {
    const id = `${this.name.toLowerCase().replace(/\s+/g, '-')}-${++this.idCounter}`;
    const todo: Todo = {
      id,
      content,
      status: 'pending',
      activeForm,
    };
    this.todos.set(id, todo);

    if (this.verbose) {
      this.printTodo(todo, 'added');
    }

    return id;
  }

  /**
   * Add multiple todos at once
   */
  addMany(items: Array<{ content: string; activeForm: string }>): string[] {
    return items.map(item => this.add(item.content, item.activeForm));
  }

  /**
   * Start working on a todo (set to in_progress)
   */
  start(id: string): void {
    const todo = this.todos.get(id);
    if (!todo) {
      console.warn(`${this.prefix} Todo not found: ${id}`);
      return;
    }

    todo.status = 'in_progress';
    todo.startedAt = new Date();

    if (this.verbose) {
      this.printTodo(todo, 'started');
    }
  }

  /**
   * Mark a todo as completed
   */
  complete(id: string): void {
    const todo = this.todos.get(id);
    if (!todo) {
      console.warn(`${this.prefix} Todo not found: ${id}`);
      return;
    }

    todo.status = 'completed';
    todo.completedAt = new Date();

    if (this.verbose) {
      this.printTodo(todo, 'completed');
    }
  }

  /**
   * Mark a todo as failed
   */
  fail(id: string, error?: string): void {
    const todo = this.todos.get(id);
    if (!todo) {
      console.warn(`${this.prefix} Todo not found: ${id}`);
      return;
    }

    todo.status = 'failed';
    todo.completedAt = new Date();
    todo.error = error;

    if (this.verbose) {
      this.printTodo(todo, 'failed');
    }
  }

  /**
   * Convenience method: start and complete immediately (for quick tasks)
   */
  quick(content: string, activeForm: string): string {
    const id = this.add(content, activeForm);
    this.start(id);
    this.complete(id);
    return id;
  }

  /**
   * Convenience method: start a todo, run an async function, and mark complete/failed
   */
  async run<T>(
    content: string,
    activeForm: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const id = this.add(content, activeForm);
    this.start(id);

    try {
      const result = await fn();
      this.complete(id);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.fail(id, errorMessage);
      throw error;
    }
  }

  /**
   * Get all todos
   */
  getAll(): Todo[] {
    return Array.from(this.todos.values());
  }

  /**
   * Get todos by status
   */
  getByStatus(status: TodoStatus): Todo[] {
    return this.getAll().filter(todo => todo.status === status);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  } {
    const todos = this.getAll();
    return {
      total: todos.length,
      pending: todos.filter(t => t.status === 'pending').length,
      inProgress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
      failed: todos.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * Print final summary
   */
  printSummary(): void {
    const summary = this.getSummary();
    console.log(`${this.prefix} Summary: ${summary.completed}/${summary.total} completed, ${summary.failed} failed`);
  }

  /**
   * Clear all todos
   */
  clear(): void {
    this.todos.clear();
    this.idCounter = 0;
  }

  /**
   * Print a todo to the console
   */
  private printTodo(todo: Todo, action: 'added' | 'started' | 'completed' | 'failed'): void {
    const statusIcons: Record<TodoStatus, string> = {
      pending: '[ ]',
      in_progress: '[~]',
      completed: '[x]',
      failed: '[!]',
    };

    const actionIcons: Record<string, string> = {
      added: '+',
      started: '>',
      completed: 'v',
      failed: 'x',
    };

    const icon = statusIcons[todo.status];
    const actionIcon = actionIcons[action];

    if (action === 'started') {
      console.log(`${this.prefix} ${icon} ${actionIcon} ${todo.activeForm}...`);
    } else if (action === 'completed') {
      console.log(`${this.prefix} ${icon} ${todo.content}`);
    } else if (action === 'failed') {
      console.log(`${this.prefix} ${icon} ${todo.content} - FAILED${todo.error ? `: ${todo.error}` : ''}`);
    }
    // 'added' is silent to avoid noise
  }
}

/**
 * Create a todo tracker for an agent
 */
export const createAgentTodoTracker = (agentName: string): TodoTracker => {
  return new TodoTracker({
    name: agentName,
    verbose: true,
  });
};

/**
 * Create a todo tracker for a supervisor
 */
export const createSupervisorTodoTracker = (supervisorName: string): TodoTracker => {
  return new TodoTracker({
    name: supervisorName,
    verbose: true,
  });
};
