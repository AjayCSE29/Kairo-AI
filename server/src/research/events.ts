export interface BusEvent {
  seq: number;
  type: string;
  payload: unknown;
}

type Listener = (event: BusEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(runId);
  };
}

export function publish(runId: string, event: BusEvent) {
  const set = listeners.get(runId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // A disconnected client must not interrupt the research pipeline.
    }
  }
}
