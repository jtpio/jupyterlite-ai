/**
 * The part of the Node event emitter that the pi input buffer uses.
 */
export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    const listeners = this._listeners.get(event) ?? [];
    listeners.push(listener);
    this._listeners.set(event, listeners);
    return this;
  }

  off(event, listener) {
    const listeners = this._listeners.get(event) ?? [];
    this._listeners.set(
      event,
      listeners.filter(item => item !== listener)
    );
    return this;
  }

  emit(event, ...args) {
    const listeners = this._listeners.get(event) ?? [];
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return listeners.length > 0;
  }

  removeAllListeners(event) {
    if (event === undefined) {
      this._listeners.clear();
    } else {
      this._listeners.delete(event);
    }
    return this;
  }
}
