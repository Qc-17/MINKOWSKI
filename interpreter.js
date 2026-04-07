// MINKOWSKI Interpreter
// Lines are 1-indexed. They serve as both code and memory.

class MinkowskiInterpreter {
  constructor() {
    this._reset();
  }

  _reset() {
    this.lines          = [];
    this.pc             = 1;
    this.returnStack    = [];
    this.outputEnabled  = true;
    this.inIgnoredBlock = false;
    this.halted         = false;
    this._awaitingInput = false;
    this._inputIdx      = -1;
  }

  load(source) {
    this._reset();
    this.lines = source.split('\n');
  }

  // ── memory access ──────────────────────────────────────────────────────────

  getLine(n) {
    return (n >= 1 && n <= this.lines.length) ? this.lines[n - 1] : '';
  }

  setLine(n, val) {
    if (n < 1) return;
    while (this.lines.length < n) this.lines.push('');
    this.lines[n - 1] = String(val);
  }

  // ── reference resolution ───────────────────────────────────────────────────

  // Replace #N with the (recursively resolved) content of line N.
  // \#N is an escape → literal "#N".
  resolveRefs(str, depth = 0) {
    if (depth > 64) return str;
    return str.replace(/\\#(\d+)|#(\d+)/g, (_, esc, num) => {
      if (esc != null) return '#' + esc;
      return this.resolveRefs(this.getLine(parseInt(num, 10)), depth + 1);
    });
  }

  // ── expression evaluation ──────────────────────────────────────────────────

  // Returns true only if the string is a pure numeric/boolean expression
  // (digits, spaces, + - * / & | ! parentheses dot).
  _isNumExpr(s) {
    return s.trim() !== '' && /^[\s\d+\-*/&|!().]+$/.test(s);
  }

  // Evaluate a resolved string: numeric if possible, string otherwise.
  _eval(s) {
    if (!this._isNumExpr(s)) return s;
    try {
      // Map single & → && and single | → ||
      const expr = s.replace(/&(?!&)/g, '&&').replace(/\|(?!\|)/g, '||');
      const v = Function('"use strict";return(' + expr + ')')();
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    } catch (_) {
      return s;
    }
  }

  // ── single step ────────────────────────────────────────────────────────────

  // Returns { status, value?, line? }
  //   status: 'ok' | 'output' | 'input' | 'halt'
  step(inputVal) {
    if (this.halted) return { status: 'halt' };

    // ── resume after pending input ──
    if (this._awaitingInput) {
      if (inputVal === undefined) return { status: 'input', line: this._inputIdx + 1 };
      this.lines[this._inputIdx] = String(inputVal);
      this._awaitingInput = false;
      this.pc++;
      return { status: 'ok' };
    }

    if (this.pc < 1 || this.pc > this.lines.length) {
      this.halted = true;
      return { status: 'halt' };
    }

    const raw = this.lines[this.pc - 1];
    const t   = raw.trim();

    // ── inside ignored block ──
    if (this.inIgnoredBlock) {
      if (t === '#') this.inIgnoredBlock = false;
      this.pc++;
      return { status: 'ok' };
    }

    // ── toggle ignored block ──
    if (t === '#') {
      this.inIgnoredBlock = true;
      this.pc++;
      return { status: 'ok' };
    }

    // ── toggle output ──
    if (t === '~') {
      this.outputEnabled = !this.outputEnabled;
      this.pc++;
      return { status: 'ok' };
    }

    // ── empty string literal ──
    if (t === '%') {
      this.pc++;
      return { status: 'ok' };
    }

    // ── return from subroutine ──
    if (t === '*') {
      if (this.returnStack.length > 0) {
        this.pc = this.returnStack.pop();
      } else {
        this.halted = true;
        return { status: 'halt' };
      }
      return { status: 'ok' };
    }

    // ── empty line → request input ──
    if (t === '') {
      this._awaitingInput = true;
      this._inputIdx      = this.pc - 1;
      return { status: 'input', line: this.pc };
    }

    // ── jump  @N ──
    const jmp = t.match(/^@(\d+)$/);
    if (jmp) {
      this.returnStack.push(this.pc + 1);
      this.pc = parseInt(jmp[1], 10);
      return { status: 'ok' };
    }

    // ── output  >... ──
    if (raw.startsWith('>')) {
      const val = this._eval(this.resolveRefs(raw.slice(1)));
      this.pc++;
      if (this.outputEnabled) return { status: 'output', value: String(val) };
      return { status: 'ok' };
    }

    // ── conditional  ?cond:@N ──
    const cond = t.match(/^\?\s*(.+?)\s*:\s*@(\d+)\s*$/);
    if (cond) {
      const v = this._eval(this.resolveRefs(cond[1]));
      if (v) this.pc = parseInt(cond[2], 10);
      else   this.pc++;
      return { status: 'ok' };
    }

    // ── modify line  #(N:content) ──
    const mod = t.match(/^#\((\d+):(.*)\)$/);
    if (mod) {
      const resolved = this.resolveRefs(mod[2]);
      const val      = this._eval(resolved);
      this.setLine(parseInt(mod[1], 10), val);
      this.pc++;
      return { status: 'ok' };
    }

    // ── value / string line (no side effects) ──
    this.pc++;
    return { status: 'ok' };
  }

  // ── async run ──────────────────────────────────────────────────────────────

  async run({ onOutput, onInput, onHalt, onStep, delay = 20 } = {}) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let guard = 0;

    while (!this.halted) {
      if (++guard > 1_000_000) break;

      const r = this.step();

      if (onStep) onStep(this.pc, this.lines);

      if (r.status === 'output') {
        if (onOutput) onOutput(r.value);
      } else if (r.status === 'input') {
        const v = await new Promise(res => {
          if (onInput) onInput(r.line, res);
          else res('');
        });
        this.step(v);
        if (onStep) onStep(this.pc, this.lines);
      } else if (r.status === 'halt') {
        break;
      }

      if (delay > 0) {
        await sleep(delay);
      } else if (guard % 200 === 0) {
        await sleep(0); // yield to UI thread
      }
    }

    this.halted = true;
    if (onHalt) onHalt();
  }
}
