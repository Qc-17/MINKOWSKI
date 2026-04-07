// MINKOWSKI Interpreter
// Conforms to the MINKOWSKI language manual.
// Lines are 1-indexed. They serve as both code and memory.
//
// API (backward-compatible with ide.html):
//   new MinkowskiInterpreter()
//   .load(source)
//   .step(inputVal)  →  { status: 'ok'|'output'|'input'|'halt', value?, line? }
//   .run({ onOutput, onInput, onHalt, onStep, delay })  →  Promise<void>

class MinkowskiInterpreter {
  constructor() {
    this._reset();
  }

  _reset() {
    this.lines          = [];
    this.pc             = 1;
    this.returnAddr     = null;   // single return register (not a stack — see @N / * semantics)
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

  // ── memory access ─────────────────────────────────────────────────────────

  getLine(n) {
    if (n < 1 || n > this.lines.length) return '';
    const v = this.lines[n - 1];
    // A line whose trimmed content is "%" represents an empty string (see spec §6).
    return v.trim() === '%' ? '' : v;
  }

  setLine(n, val) {
    if (n < 1) return;
    while (this.lines.length < n) this.lines.push('');
    this.lines[n - 1] = String(val);
  }

  // ── reference resolution ──────────────────────────────────────────────────
  // Replace #N with the (recursively resolved) content of line N.
  // \#N is an escape → literal "#N".

  resolveRefs(str, depth = 0) {
    if (depth > 64) return str;
    return str.replace(/\\#(\d+)|#(\d+)/g, (_, esc, num) => {
      if (esc != null) return '#' + esc;
      return this.resolveRefs(this.getLine(parseInt(num, 10)), depth + 1);
    });
  }

  // ── expression evaluation ─────────────────────────────────────────────────
  // A string is numeric if it contains ONLY: digits, spaces, operators, parens, dot.
  // Operator precedence (highest → lowest) per MINKOWSKI spec:
  //   !         unary NOT
  //   * /       multiplication, division
  //   + -       addition, subtraction
  //   = ~       equality (=) and inequality (~)     ← higher than comparison
  //   > < >= <= comparison
  //   &         logical AND
  //   |         logical OR                          ← lowest

  _isNumExpr(s) {
    return s.trim() !== '' && /^[\s\d+\-*/&|!().<>~=]+$/.test(s);
  }

  _eval(s) {
    if (!this._isNumExpr(s)) return s;
    try {
      const state = { pos: 0 };
      const result = this._parseOr(s, state);
      // consume trailing whitespace
      while (state.pos < s.length && (s[state.pos] === ' ' || s[state.pos] === '\t')) state.pos++;
      // if not fully consumed, treat as string
      if (state.pos < s.length) return s;
      if (typeof result === 'boolean') return result ? 1 : 0;
      return result;
    } catch (_) {
      return s;
    }
  }

  // ── recursive descent parser ──────────────────────────────────────────────

  _skipWs(s, st) {
    while (st.pos < s.length && (s[st.pos] === ' ' || s[st.pos] === '\t')) st.pos++;
  }

  // or = and ('|' and)*
  _parseOr(s, st) {
    let v = this._parseAnd(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length && s[st.pos] === '|') {
      st.pos++;
      const r = this._parseAnd(s, st);
      v = (v || r) ? 1 : 0;
      this._skipWs(s, st);
    }
    return v;
  }

  // and = cmp ('&' cmp)*
  _parseAnd(s, st) {
    let v = this._parseCmp(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length && s[st.pos] === '&') {
      st.pos++;
      const r = this._parseCmp(s, st);
      v = (v && r) ? 1 : 0;
      this._skipWs(s, st);
    }
    return v;
  }

  // cmp = eq (('>' | '<' | '>=' | '<=') eq)*
  // Note: equality (= ~) has HIGHER precedence than comparison (> <) per spec.
  _parseCmp(s, st) {
    let v = this._parseEq(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length) {
      let op = null;
      if      (s[st.pos] === '>' && s[st.pos + 1] === '=') { op = '>='; st.pos += 2; }
      else if (s[st.pos] === '<' && s[st.pos + 1] === '=') { op = '<='; st.pos += 2; }
      else if (s[st.pos] === '>')                           { op = '>';  st.pos++;    }
      else if (s[st.pos] === '<')                           { op = '<';  st.pos++;    }
      else break;
      const r = this._parseEq(s, st);
      if      (op === '>')  v = (v >  r) ? 1 : 0;
      else if (op === '<')  v = (v <  r) ? 1 : 0;
      else if (op === '>=') v = (v >= r) ? 1 : 0;
      else if (op === '<=') v = (v <= r) ? 1 : 0;
      this._skipWs(s, st);
    }
    return v;
  }

  // eq = add (('=' | '~') add)*
  // '=' is equality, '~' is not-equal.
  _parseEq(s, st) {
    let v = this._parseAdd(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length) {
      let op = null;
      if      (s[st.pos] === '=') { op = '='; st.pos++; }
      else if (s[st.pos] === '~') { op = '~'; st.pos++; }
      else break;
      const r = this._parseAdd(s, st);
      v = (op === '=') ? (v == r ? 1 : 0) : (v != r ? 1 : 0);
      this._skipWs(s, st);
    }
    return v;
  }

  // add = mul (('+' | '-') mul)*
  _parseAdd(s, st) {
    let v = this._parseMul(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length && (s[st.pos] === '+' || s[st.pos] === '-')) {
      const op = s[st.pos++];
      const r  = this._parseMul(s, st);
      v = (op === '+') ? v + r : v - r;
      this._skipWs(s, st);
    }
    return v;
  }

  // mul = unary (('*' | '/') unary)*
  _parseMul(s, st) {
    let v = this._parseUnary(s, st);
    this._skipWs(s, st);
    while (st.pos < s.length && (s[st.pos] === '*' || s[st.pos] === '/')) {
      const op = s[st.pos++];
      const r  = this._parseUnary(s, st);
      v = (op === '*') ? v * r : v / r;
      this._skipWs(s, st);
    }
    return v;
  }

  // unary = ('!' | '-') unary | primary
  _parseUnary(s, st) {
    this._skipWs(s, st);
    if (s[st.pos] === '!') { st.pos++; return this._parseUnary(s, st) ? 0 : 1; }
    if (s[st.pos] === '-') { st.pos++; return -this._parseUnary(s, st); }
    return this._parsePrimary(s, st);
  }

  // primary = '(' or ')' | NUMBER
  _parsePrimary(s, st) {
    this._skipWs(s, st);
    if (s[st.pos] === '(') {
      st.pos++;
      const v = this._parseOr(s, st);
      this._skipWs(s, st);
      if (s[st.pos] === ')') st.pos++;
      return v;
    }
    // number (integer or float)
    const start = st.pos;
    while (st.pos < s.length && /[\d.]/.test(s[st.pos])) st.pos++;
    const num = parseFloat(s.slice(start, st.pos));
    if (isNaN(num)) throw new Error('parse error at pos ' + start);
    return num;
  }

  // ── single step ───────────────────────────────────────────────────────────
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

    // ── return ──
    // Torna all'ultimo @ eseguito (punto di ritorno non viene consumato).
    // Se non è mai stato eseguito un @, il programma termina.
    if (t === '*') {
      if (this.returnAddr !== null) {
        this.pc = this.returnAddr;
        // returnAddr is NOT cleared: * always returns to the same saved address,
        // enabling the infinite-loop behaviour described in the manual.
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

    // ── jump / subroutine call  @N ──
    // Salva come punto di ritorno la riga SUCCESSIVA, salta alla riga N.
    const jmp = t.match(/^@(\d+)$/);
    if (jmp) {
      this.returnAddr = this.pc + 1;
      this.pc         = parseInt(jmp[1], 10);
      return { status: 'ok' };
    }

    // ── output  >... ──
    if (raw.startsWith('>')) {
      const val = this._eval(this.resolveRefs(raw.slice(1)));
      this.pc++;
      if (this.outputEnabled) return { status: 'output', value: String(val) };
      return { status: 'ok' };
    }

    // ── conditional  ? condizione : @N ──
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

    // ── value / data line (no side effects) ──
    this.pc++;
    return { status: 'ok' };
  }

  // ── async run ─────────────────────────────────────────────────────────────

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
