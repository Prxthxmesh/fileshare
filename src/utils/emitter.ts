type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    (this.listeners[event] ??= new Set()).add(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>) {
    this.listeners[event]?.delete(listener);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]) {
    this.listeners[event]?.forEach((l) => {
      try {
        l(payload);
      } catch (err) {
        console.error('[FileShare] listener error', err);
      }
    });
  }

  removeAllListeners() {
    this.listeners = {};
  }
}
