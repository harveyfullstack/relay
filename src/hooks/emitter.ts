/**
 * HookEmitter
 *
 * Lightweight async event emitter for hook handlers.
 * - Supports async handlers
 * - Allows stop-propagation via `{ stop: true }` return value
 * - Can preload handlers from a config object
 */

export type HookHandlerResult = unknown | { stop?: boolean };
export type HookHandler = (...args: unknown[]) => HookHandlerResult | Promise<HookHandlerResult>;

export interface EmitResult {
  /** Raw results from each handler in order */
  results: HookHandlerResult[];
  /** Whether propagation was stopped by a handler */
  stopped: boolean;
}

export type HookHandlerConfig = Record<string, HookHandler | HookHandler[]>;

export class HookEmitter {
  private handlers = new Map<string, HookHandler[]>();

  constructor(config?: HookHandlerConfig) {
    if (config) {
      this.load(config);
    }
  }

  /**
   * Register a handler for an event.
   * Returns an unsubscribe function to remove the handler.
   */
  on(event: string, handler: HookHandler): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);

    return () => {
      const updated = this.handlers.get(event)?.filter((fn) => fn !== handler) ?? [];
      this.handlers.set(event, updated);
    };
  }

  /**
   * Emit an event and invoke handlers sequentially.
   * If a handler returns `{ stop: true }`, propagation halts.
   */
  async emit(event: string, ...args: unknown[]): Promise<EmitResult> {
    const results: HookHandlerResult[] = [];
    const handlers = this.handlers.get(event) ?? [];
    let stopped = false;

    for (const handler of handlers) {
      const result = await handler(...args);
      results.push(result);

      if (this.shouldStop(result)) {
        stopped = true;
        break;
      }
    }

    return { results, stopped };
  }

  /**
   * Load handlers from a configuration object.
   * Values can be a single handler or an array of handlers.
   */
  load(config: HookHandlerConfig): void {
    for (const [event, handler] of Object.entries(config)) {
      const handlers = Array.isArray(handler) ? handler : [handler];
      for (const h of handlers) {
        this.on(event, h);
      }
    }
  }

  private shouldStop(result: HookHandlerResult): boolean {
    return typeof result === 'object' && result !== null && 'stop' in result && (result as any).stop === true;
  }
}
