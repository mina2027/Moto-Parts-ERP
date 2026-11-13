export class IdlePolicy {
  private lastInput: number;
  constructor(private now: () => number = Date.now) { this.lastInput = now(); }
  touch() { this.lastInput = this.now(); }
  expired(minutes: number): boolean { return minutes > 0 && (this.now() < this.lastInput || this.now() - this.lastInput >= minutes * 60000); }
}
