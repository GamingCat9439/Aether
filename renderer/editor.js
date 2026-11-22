/* Lua editor: transparent textarea over a highlighted <pre>, with a synced
   gutter, current-line marker, smart indentation and bracket pairing. */

(function () {
  'use strict';

  const KEYWORDS = new Set([
    'and', 'break', 'continue', 'do', 'else', 'elseif', 'end', 'export', 'for',
    'function', 'goto', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return',
    'then', 'type', 'until', 'while',
  ]);

  const CONSTANTS = new Set(['true', 'false', 'nil']);

  const BUILTINS = new Set([
    'game', 'workspace', 'script', 'shared', 'self', '_G', 'print', 'warn', 'error',
    'assert', 'pcall', 'xpcall', 'select', 'type', 'typeof', 'tostring',
    'tonumber', 'pairs', 'ipairs', 'next', 'rawget', 'rawset', 'rawequal',
    'rawlen', 'unpack', 'require', 'loadstring', 'load', 'dofile', 'collectgarbage',
    'setmetatable', 'getmetatable', 'getgenv', 'getrenv', 'getreg', 'getgc',
    'identifyexecutor', 'setclipboard', 'setfpscap', 'queue_on_teleport',
    'task', 'wait', 'spawn', 'delay', 'tick', 'time', 'typeof', 'Instance',
    'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim2', 'UDim', 'Enum', 'Ray',
    'RaycastParams', 'TweenInfo', 'BrickColor', 'NumberRange', 'NumberSequence',
    'ColorSequence', 'Rect', 'Region3', 'PhysicalProperties', 'Random',
    'DateTime', 'Faces', 'Axes', 'font', 'table', 'string', 'math', 'os',
    'coroutine', 'utf8', 'bit32', 'debug', 'buffer', 'vector',
  ]);

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const escapeHtml = (value) => value.replace(/[&<>]/g, (char) => ESCAPE_MAP[char]);

  function longBracket(code, start) {
    if (code[start] !== '[') return null;
    let level = 0;
    let index = start + 1;
    while (code[index] === '=') {
      level += 1;
      index += 1;
    }
    if (code[index] !== '[') return null;

    const close = `]${'='.repeat(level)}]`;
    const end = code.indexOf(close, index + 1);
    return { end: end === -1 ? code.length : end + close.length };
  }

  function previousWord(code, index) {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(code[cursor])) cursor -= 1;
    const end = cursor;
    while (cursor >= 0 && /[A-Za-z0-9_]/.test(code[cursor])) cursor -= 1;
    return code.slice(cursor + 1, end + 1);
  }

  function highlightLua(code) {
    let output = '';
    let plainFrom = 0;
    let index = 0;
    const length = code.length;

    const flush = (until) => {
      if (until > plainFrom) output += escapeHtml(code.slice(plainFrom, until));
    };

    const token = (start, end, className) => {
      flush(start);
      output += `<span class="${className}">${escapeHtml(code.slice(start, end))}</span>`;
      plainFrom = end;
    };

    while (index < length) {
      const char = code[index];

      if (char === '-' && code[index + 1] === '-') {
        const long = longBracket(code, index + 2);
        let end;
        if (long) {
          end = long.end;
        } else {
          const newline = code.indexOf('\n', index);
          end = newline === -1 ? length : newline;
        }
        token(index, end, 't-com');
        index = end;
        continue;
      }

      if (char === '[') {
        const long = longBracket(code, index);
        if (long) {
          token(index, long.end, 't-str');
          index = long.end;
          continue;
        }
      }

      if (char === '"' || char === "'" || char === '`') {
        let cursor = index + 1;
        while (cursor < length) {
          const current = code[cursor];
          if (current === '\\') {
            cursor += 2;
            continue;
          }
          if (current === char || (current === '\n' && char !== '`')) {
            cursor += 1;
            break;
          }
          cursor += 1;
        }
        token(index, cursor, 't-str');
        index = cursor;
        continue;
      }

      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(code[index + 1] || ''))) {
        const match = code
          .slice(index)
          .match(/^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
        if (match) {
          token(index, index + match[0].length, 't-num');
          index += match[0].length;
          continue;
        }
      }

      if (/[A-Za-z_]/.test(char)) {
        let end = index + 1;
        while (end < length && /[A-Za-z0-9_]/.test(code[end])) end += 1;
        const word = code.slice(index, end);
        let lookahead = end;
        while (lookahead < length && (code[lookahead] === ' ' || code[lookahead] === '\t')) {
          lookahead += 1;
        }
        let lookbehind = index - 1;
        while (lookbehind >= 0 && (code[lookbehind] === ' ' || code[lookbehind] === '\t')) {
          lookbehind -= 1;
        }

        let className = 't-id';
        if (KEYWORDS.has(word)) className = 't-kw';
        else if (CONSTANTS.has(word)) className = 't-const';
        else if (lookbehind >= 0 && (code[lookbehind] === '.' || code[lookbehind] === ':')) className = 't-prop';
        else if (BUILTINS.has(word)) className = 't-builtin';
        else if (code[lookahead] === '(' || previousWord(code, index) === 'function') className = 't-fn';

        token(index, end, className);
        index = end;
        continue;
      }

      if ('+-*/%^#=<>~'.includes(char)) {
        let end = index + 1;
        const pair = code.slice(index, index + 2);
        if (pair === '==' || pair === '~=' || pair === '<=' || pair === '>=' || pair === '..') {
          end += 1;
          if (pair === '..' && code[index + 2] === '.') end += 1;
        }
        token(index, end, 't-op');
        index = end;
        continue;
      }

      if ('{}()[],;:.'.includes(char)) {
        token(index, index + 1, 't-punc');
        index += 1;
        continue;
      }

      index += 1;
    }

    flush(length);
    if (code.endsWith('\n')) output += '\n';
    return output;
  }

  class LuaEditor {
    constructor(elements, callbacks, options) {
      this.textarea = elements.textarea;
      this.highlight = elements.highlight;
      this.gutter = elements.gutter;
      this.currentLine = elements.currentLine;
      this.stage = elements.stage;
      this.caret = elements.caret || null;
      this.scroller = this.stage.querySelector('.editor-scroller');
      this.cursorInfo = elements.cursorInfo;
      this.dirtyState = elements.dirtyState;
      this.callbacks = callbacks || {};
      this.options = {
        fontSize: 13,
        tabSize: 2,
        wrap: false,
        lineNumbers: true,
        highlightLine: true,
        autoIndent: true,
        ...options,
      };

      this.frame = null;
      this.lineHeight = 21;
      this.padTop = 16;
      this.gutterLineEls = [];
      this.gutterLineCount = 0;
      this.activeLine = 0;

      this.mirror = null;
      this.mirrorCaret = null;
      this.caretAnchor = null;
      this.caretTimer = 0;
      this.lineAnimation = null;
      this.suppressLineMotion = false;
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

      this.placeholder = document.createElement('div');
      this.placeholder.className = 'editor-placeholder';
      this.placeholder.textContent = 'Start writing Lua, or open a file from the workspace.';
      this.scroller.appendChild(this.placeholder);

      this.ensureMirror();

      if (typeof ResizeObserver === 'function') {
        this.resizeObserver = new ResizeObserver(() => {
          this.syncMirrorStyle();
          this.syncScroll();
          this.updateCaret({ animate: 'instant' });
        });
        this.resizeObserver.observe(this.scroller);
      }

      this.textarea.wrap = 'off';
      this.applyOptions();
      this.bind();
      this.suppressLineMotion = true;
      this.refresh();
      this.suppressLineMotion = false;
    }

    get value() {
      return this.textarea.value;
    }

    setOptions(next) {
      this.options = { ...this.options, ...(next || {}) };
      this.applyOptions();
      this.caretAnchor = null;
      this.suppressLineMotion = true;
      this.refresh();
      this.suppressLineMotion = false;
    }

    applyOptions() {
      this.stage.classList.toggle('wrap-on', Boolean(this.options.wrap));
      this.stage.classList.toggle('no-gutter', !this.options.lineNumbers);
      this.stage.style.setProperty('--tab-size', String(this.options.tabSize));
      this.textarea.wrap = this.options.wrap ? 'soft' : 'off';
      this.syncMirrorStyle();
    }

    setValue(value, silent) {
      this.textarea.value = String(value ?? '');
      this.textarea.scrollTop = 0;
      this.textarea.scrollLeft = 0;
      this.caretAnchor = null;
      this.suppressLineMotion = true;
      this.refresh();
      this.suppressLineMotion = false;
      this.updatePlaceholder();
      if (!silent) this.emitChange();
    }

    getValue() {
      return this.textarea.value;
    }

    setDirty(dirty) {
      if (!this.dirtyState) return;
      this.dirtyState.textContent = dirty ? 'Unsaved' : 'Saved';
      this.dirtyState.classList.toggle('is-dirty', Boolean(dirty));
    }

    focus() {
      this.textarea.focus();
    }

    refresh() {
      this.measure();
      this.highlight.innerHTML = highlightLua(this.textarea.value);
      this.renderGutter();
      this.syncScroll();
      this.updateCursor();
      this.updatePlaceholder();
    }

    schedule() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.refresh();
      });
    }

    measure() {
      const style = getComputedStyle(this.textarea);
      this.lineHeight = parseFloat(style.lineHeight) || 21;
      this.padTop = parseFloat(style.paddingTop) || 16;
    }

    updatePlaceholder() {
      this.placeholder.classList.toggle('visible', this.textarea.value.length === 0);
    }

    motionEnabled() {
      return (
        document.documentElement.dataset.motion !== 'off' && !this.motionQuery.matches
      );
    }

    ensureMirror() {
      if (this.mirror) return;
      const mirror = document.createElement('div');
      mirror.className = 'editor-measure';
      mirror.setAttribute('aria-hidden', 'true');
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      this.scroller.appendChild(mirror);
      this.mirror = mirror;
      this.mirrorCaret = marker;
    }

    syncMirrorStyle() {
      this.ensureMirror();
      const style = getComputedStyle(this.textarea);
      const mirror = this.mirror;
      const properties = [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'fontVariant',
        'letterSpacing',
        'wordSpacing',
        'lineHeight',
        'textTransform',
        'textIndent',
        'textRendering',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'tabSize',
        'direction',
      ];

      for (const property of properties) {
        mirror.style[property] = style[property];
      }

      mirror.style.boxSizing = 'border-box';
      mirror.style.width = `${this.textarea.clientWidth}px`;
      mirror.style.whiteSpace = this.options.wrap ? 'pre-wrap' : 'pre';
      mirror.style.overflowWrap = this.options.wrap ? 'anywhere' : 'normal';
      mirror.style.wordBreak = 'normal';
    }

    measureCaret() {
      this.syncMirrorStyle();
      const value = this.textarea.value;
      const index = this.textarea.selectionStart;
      const line = (value.slice(0, index).match(/\n/g) || []).length;
      const lineStart = value.lastIndexOf('\n', index - 1) + 1;
      const prefix = this.options.wrap ? value.slice(0, index) : value.slice(lineStart, index);

      this.mirror.textContent = prefix;
      this.mirror.appendChild(this.mirrorCaret);

      const box = this.mirror.getBoundingClientRect();
      const marker = this.mirrorCaret.getBoundingClientRect();
      const markerOffset = (this.lineHeight - marker.height) / 2;

      return {
        x: marker.left - box.left - this.textarea.scrollLeft,
        y: this.options.wrap
          ? marker.top - box.top - markerOffset - this.textarea.scrollTop
          : this.padTop + line * this.lineHeight - this.textarea.scrollTop,
        line,
      };
    }

    updateCaret(options) {
      if (!this.caret) return;
      const animate = options && options.animate ? options.animate : 'auto';
      const focused = document.activeElement === this.textarea;
      const collapsed = this.textarea.selectionStart === this.textarea.selectionEnd;

      if (!focused || !collapsed) {
        this.caretAnchor = null;
        this.caret.classList.remove('visible', 'typing');
        return;
      }

      const position = this.measureCaret();
      const previous = this.caretAnchor;
      const columnDrift = previous && Math.abs(position.x - previous.x) > 0.35;
      const lineDrift = previous && Math.abs(position.y - previous.y) > 0.5;
      const visible =
        position.y + this.lineHeight > 3 &&
        position.y < this.scroller.clientHeight - 2 &&
        position.x > -4 &&
        position.x < this.scroller.clientWidth - 2;

      this.caret.classList.toggle('visible', visible);

      if (previous && !columnDrift && !lineDrift) return;

      let duration = 0;
      if (previous) {
        if (animate === 'instant') duration = 0;
        else if (animate === 'line') duration = 170;
        else if (lineDrift) duration = 185;
        else if (columnDrift) duration = 55;
      }

      if (!this.motionEnabled()) duration = 0;

      this.caret.style.transitionDuration = `${duration}ms`;
      this.caret.style.height = `${this.lineHeight}px`;
      this.caret.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      this.caretAnchor = position;

      if (visible) this.pulseCaret();
    }

    pulseCaret() {
      if (!this.caret) return;
      this.caret.classList.add('typing');
      window.clearTimeout(this.caretTimer);
      this.caretTimer = window.setTimeout(() => {
        this.caret.classList.remove('typing');
      }, 520);
    }

    hideCaret() {
      if (!this.caret) return;
      this.caret.classList.remove('visible', 'typing');
      window.clearTimeout(this.caretTimer);
    }

    renderGutter() {
      if (!this.options.lineNumbers) return;
      const count = this.textarea.value.split('\n').length;

      if (count !== this.gutterLineCount) {
        this.gutterLineCount = count;
        const lines = new Array(count);
        for (let i = 0; i < count; i += 1) {
          lines[i] = `<div class="gl">${i + 1}</div>`;
        }
        this.gutter.innerHTML = lines.join('');
        this.gutterLineEls = [...this.gutter.children];
        this.activeLine = -1;
      }

      this.setActiveLine(this.currentLineIndex());
    }

    currentLineIndex() {
      const upto = this.textarea.value.slice(0, this.textarea.selectionStart);
      return (upto.match(/\n/g) || []).length;
    }

    setActiveLine(line) {
      if (line === this.activeLine) return;
      if (this.gutterLineEls[this.activeLine]) {
        this.gutterLineEls[this.activeLine].classList.remove('active');
      }
      if (this.gutterLineEls[line]) {
        this.gutterLineEls[line].classList.add('active');
      }
      this.activeLine = line;
      this.positionCurrentLine(!this.suppressLineMotion);
    }

    positionCurrentLine(animate = false) {
      const enabled =
        this.options.highlightLine && !this.options.wrap && this.textarea.value.length >= 0;
      this.currentLine.style.display = enabled ? 'block' : 'none';
      if (!enabled) return;

      const scrollTop = this.textarea.scrollTop;
      const top = this.padTop + this.currentLineIndex() * this.lineHeight - scrollTop;
      const height = this.lineHeight;
      const viewport = this.stage.clientHeight;

      if (top < -height || top > viewport) {
        this.currentLine.style.visibility = 'hidden';
        return;
      }

      const from =
        animate && this.motionEnabled()
          ? this.currentLine.getBoundingClientRect().top -
            this.scroller.getBoundingClientRect().top
          : null;

      this.currentLine.style.visibility = 'visible';
      this.currentLine.style.transform = `translateY(${top}px)`;
      this.currentLine.style.height = `${height}px`;

      if (from !== null && Math.abs(from - top) > 0.5) {
        this.lineAnimation?.cancel();
        this.lineAnimation = this.currentLine.animate(
          [
            { transform: `translateY(${from}px)` },
            { transform: `translateY(${top}px)` },
          ],
          {
            duration: 190,
            easing: 'cubic-bezier(0.22, 0.82, 0.2, 1)',
          },
        );
      }
    }

    updateCursor(options) {
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      const before = this.textarea.value.slice(0, start);
      const line = (before.match(/\n/g) || []).length + 1;
      const lastBreak = before.lastIndexOf('\n');
      const column = start - lastBreak;

      if (this.cursorInfo) {
        const selected = end - start;
        this.cursorInfo.textContent = `Ln ${line}, Col ${column}${
          selected > 0 ? ` · ${selected} selected` : ''
        }`;
      }

      this.setActiveLine(line - 1);
      this.updateCaret(options);
    }

    syncScroll() {
      const top = this.textarea.scrollTop;
      const left = this.textarea.scrollLeft;
      this.highlight.style.transform = `translate(${-left}px, ${-top}px)`;
      this.gutter.scrollTop = top;
      this.positionCurrentLine();
    }

    bind() {
      this.textarea.addEventListener('input', () => {
        this.schedule();
        this.emitChange();
      });

      this.textarea.addEventListener('scroll', () => {
        this.syncScroll();
        this.updateCaret({ animate: 'instant' });
      });

      this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
      this.textarea.addEventListener('keyup', () => this.updateCursor());
      this.textarea.addEventListener('click', () => this.updateCursor());
      this.textarea.addEventListener('select', () => this.updateCursor());
      this.textarea.addEventListener('focus', () => {
        this.caretAnchor = null;
        this.updateCursor({ animate: 'instant' });
      });
      this.textarea.addEventListener('blur', () => {
        this.caretAnchor = null;
        this.hideCaret();
        this.updatePlaceholder();
      });

      document.addEventListener('selectionchange', () => {
        if (document.activeElement === this.textarea) this.updateCursor();
      });
    }

    emitChange() {
      if (typeof this.callbacks.onChange === 'function') {
        this.callbacks.onChange(this.textarea.value);
      }
    }

    save() {
      if (typeof this.callbacks.onSave === 'function') this.callbacks.onSave();
    }

    run() {
      if (typeof this.callbacks.onRun === 'function') this.callbacks.onRun();
    }

    insertText(text, selectStart, selectEnd) {
      this.textarea.focus();
      let inserted = false;

      try {
        inserted = document.execCommand('insertText', false, text);
      } catch {
        inserted = false;
      }

      if (!inserted) {
        this.textarea.setRangeText(text, this.textarea.selectionStart, this.textarea.selectionEnd, 'end');
        this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (typeof selectStart === 'number') {
        const from = selectStart;
        const to = typeof selectEnd === 'number' ? selectEnd : from;
        this.textarea.setSelectionRange(from, to);
      }

      this.schedule();
      this.updateCursor();
    }

    onKeyDown(event) {
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key;

      if (ctrl && key.toLowerCase() === 's') {
        event.preventDefault();
        this.save();
        return;
      }

      if (ctrl && key === 'Enter') {
        event.preventDefault();
        this.run();
        return;
      }

      if (ctrl && key === '/') {
        event.preventDefault();
        this.toggleComment();
        return;
      }

      if (key === 'Tab') {
        event.preventDefault();
        this.indent(event.shiftKey);
        return;
      }

      if (key === 'Enter' && !event.shiftKey && !ctrl) {
        if (this.options.autoIndent && this.indentOnEnter()) {
          event.preventDefault();
        }
        return;
      }

      if (ctrl || event.altKey || event.metaKey || key.length !== 1) return;

      if (this.handlePair(key)) {
        event.preventDefault();
      }
    }

    insertAtCursor(text, offset) {
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      this.insertText(text, start + (offset ?? text.length), start + (offset ?? text.length));
      void end;
    }

    handlePair(key) {
      const openToClose = { '(': ')', '[': ']', '{': '}' };
      const closeChars = new Set([')', ']', '}']);
      const quoteChars = new Set(['"', "'"]);
      const start = this.textarea.selectionStart;
      const selected = this.textarea.value.slice(start, this.textarea.selectionEnd);

      if (openToClose[key]) {
        const close = openToClose[key];
        if (selected) {
          const text = `${key}${selected}${close}`;
          this.insertText(text, start + 1, start + 1 + selected.length);
          return true;
        }

        this.insertText(`${key}${close}`, start + 1, start + 1);
        return true;
      }

      if (closeChars.has(key)) {
        if (this.textarea.value[start] === key && selected.length === 0) {
          this.textarea.setSelectionRange(start + 1, start + 1);
          this.updateCursor();
          return true;
        }
        return false;
      }

      if (quoteChars.has(key)) {
        if (selected) {
          this.insertText(
            `${key}${selected}${key}`,
            start + 1,
            start + 1 + selected.length,
          );
          return true;
        }

        if (this.textarea.value[start] === key) {
          this.textarea.setSelectionRange(start + 1, start + 1);
          this.updateCursor();
          return true;
        }

        this.insertText(`${key}${key}`, start + 1, start + 1);
        return true;
      }

      return false;
    }

    indentOnEnter() {
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      if (start !== end) return false;

      const value = this.textarea.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const indent = (line.match(/^[ \t]*/) || [''])[0];
      const trimmed = line.replace(/[ \t]+$/, '');
      const opensBlock = /(?:\bthen|\bdo|\bfunction|\belse|\brepeat)$/.test(trimmed) || /[{[(]$/.test(trimmed);
      const unit = ' '.repeat(this.options.tabSize);
      const nextIndent = opensBlock ? indent + unit : indent;

      const beforeChar = value[start - 1];
      const afterChar = value[start];
      const pairs = { '(': ')', '[': ']', '{': '}' };

      if (pairs[beforeChar] && pairs[beforeChar] === afterChar) {
        const text = `\n${nextIndent}${unit}\n${indent}`;
        this.insertText(text, start + 1 + nextIndent.length, start + 1 + nextIndent.length);
        return true;
      }

      this.insertText(`\n${nextIndent}`, start + 1 + nextIndent.length, start + 1 + nextIndent.length);
      return true;
    }

    indent(shift) {
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      const value = this.textarea.value;
      const unit = ' '.repeat(this.options.tabSize);

      if (start === end) {
        if (shift) {
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          const prefix = value.slice(lineStart, start);
          const removable = prefix.match(new RegExp(` {1,${this.options.tabSize}}$`));
          if (removable) {
            const count = removable[0].length;
            this.textarea.focus();
            this.textarea.setSelectionRange(start - count, start);
            document.execCommand('delete');
            this.schedule();
            this.updateCursor();
          }
          return;
        }
        this.insertText(unit, start + unit.length, start + unit.length);
        return;
      }

      const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
      let lastLineEnd = value.indexOf('\n', end);
      if (lastLineEnd === -1) lastLineEnd = value.length;

      const block = value.slice(firstLineStart, lastLineEnd);
      const lines = block.split('\n');

      let changed;
      if (shift) {
        changed = lines
          .map((line) => line.replace(new RegExp(`^ {1,${this.options.tabSize}}`), ''))
          .join('\n');
      } else {
        changed = lines.map((line) => (line.length ? unit + line : line)).join('\n');
      }

      this.textarea.setSelectionRange(firstLineStart, Math.max(lastLineEnd, firstLineStart + 1));
      this.insertText(changed, firstLineStart, firstLineStart + changed.length);
    }

    toggleComment() {
      const value = this.textarea.value;
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;

      const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
      let lastLineEnd = value.indexOf('\n', end);
      if (lastLineEnd === -1 || lastLineEnd < end) lastLineEnd = value.length;

      const block = value.slice(firstLineStart, lastLineEnd);
      const lines = block.split('\n');
      const meaningful = lines.filter((line) => line.trim().length);
      if (!meaningful.length) return;

      const allCommented = meaningful.every((line) => /^(\s*)--\s?/.test(line));
      const changed = lines
        .map((line) => {
          if (!line.trim()) return line;
          if (allCommented) return line.replace(/^(\s*)--\s?/, '$1');
          return line.replace(/^(\s*)/, '$1-- ');
        })
        .join('\n');

      this.textarea.setSelectionRange(firstLineStart, lastLineEnd);
      this.insertText(changed, firstLineStart, firstLineStart + changed.length);
    }
  }

  LuaEditor.highlight = highlightLua;
  window.LuaEditor = LuaEditor;
})();
