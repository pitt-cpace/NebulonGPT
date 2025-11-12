// ResizeObserverManager.ts
type Obs = { ro: ResizeObserver; el: Element; options?: ResizeObserverOptions };

class ROManager {
  private static _i: ROManager;
  static get I() { return (this._i ??= new ROManager()); }

  private subs = new Set<Obs>();
  private suspended = false;
  private timer: number | null = null;

  constructor(private debounceMs = 140) {
    // Suspend during active window resizes (devtools responsive drag, etc.)
    window.addEventListener('resize', () => this.suspendSoon(), { passive: true });
  }

  private suspendSoon() {
    if (!this.suspended) {
      this.suspended = true;
      for (const s of this.subs) s.ro.disconnect();
    }
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.resume(), this.debounceMs);
  }

  private resume() {
    this.suspended = false;
    for (const s of this.subs) {
      try { s.ro.observe(s.el, s.options as any); } catch { s.ro.observe(s.el); }
    }
  }

  suspendFor(ms = this.debounceMs) {
    // disconnect immediately, then resume after ms
    if (!this.suspended) {
      this.suspended = true;
      for (const s of this.subs) s.ro.disconnect();
    }
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.resume(), ms);
  }

  register(ro: ResizeObserver, el: Element, options?: ResizeObserverOptions) {
    const rec = { ro, el, options };
    this.subs.add(rec);
    if (!this.suspended) {
      try { ro.observe(el, options as any); } catch { ro.observe(el); }
    }
    return () => {
      ro.disconnect();
      this.subs.delete(rec);
    };
  }
}

export const RO = ROManager.I;
