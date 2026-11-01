/**
 * Simple in-process event bus for wake-up signaling.
 * Used by background tasks to notify active SSE streams that new events or status changes are available.
 *
 * @returns {{
 *   subscribe: (checkId: string, listener: () => void) => () => void,
 *   notify: (checkId: string) => void,
 *   listenerCount: (checkId: string) => number,
 *   clear: () => void
 * }}
 */
export function createEventBus() {
  // Map of checkId -> Set of listener callbacks
  const listenersByCheck = new Map();

  function subscribe(checkId, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Listener must be a function");
    }
    const id = String(checkId);
    let set = listenersByCheck.get(id);
    if (!set) {
      set = new Set();
      listenersByCheck.set(id, set);
    }
    set.add(listener);

    // Unsubscribe function
    return function unsubscribe() {
      const currentSet = listenersByCheck.get(id);
      if (currentSet) {
        currentSet.delete(listener);
        if (currentSet.size === 0) {
          listenersByCheck.delete(id);
        }
      }
    };
  }

  function notify(checkId) {
    const id = String(checkId);
    const set = listenersByCheck.get(id);
    if (!set || set.size === 0) return;

    // Snapshot listeners before firing to avoid issues if listeners unsubscribe during dispatch
    const snapshot = Array.from(set);
    for (const listener of snapshot) {
      try {
        listener();
      } catch (_e) {
        // Individual listener failure should never break notification of others
      }
    }
  }

  function listenerCount(checkId) {
    const id = String(checkId);
    const set = listenersByCheck.get(id);
    return set ? set.size : 0;
  }

  function clear() {
    listenersByCheck.clear();
  }

  return {
    subscribe,
    notify,
    listenerCount,
    clear,
  };
}

// Global singleton for process-wide SSE wake-ups
export const eventBus = createEventBus();
