export class EventBus {
  constructor() { this.map = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.map.get(ev).delete(fn); }
  emit(ev, data) { (this.map.get(ev) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
}
