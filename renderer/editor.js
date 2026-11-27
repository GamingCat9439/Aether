/* Native textarea editing and scrolling with a viewport-sized syntax overlay. */
(() => {
  'use strict';
  const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const escape = text => text.replace(/[&<>]/g, ch => escapes[ch]);
  function syntax(row) {
    let html = '', i = 0;
    for (const token of row.tokens) {
      html += escape(row.text.slice(i, token.from));
      html += '<span class="' + token.kind + '">' + escape(row.text.slice(token.from, token.to)) + '</span>';
      i = token.to;
    }
    return html + escape(row.text.slice(i));
  }

  class LuaEditor {
    constructor(elements, callbacks, options) {
      Object.assign(this, elements);
      this.callbacks = callbacks || {};
      this.scroller = this.stage.querySelector('.editor-scroller');
      this.options = { fontSize: 13, tabSize: 2, wrap: false, lineNumbers: true, highlightLine: true, autoIndent: true, ...options };
      this.nodes = new Map();
      this.wrapNodes = [];
      this.metricsDirty = true;
      this.frame = 0;
      this.placeholder = document.createElement('div');
      this.placeholder.className = 'editor-placeholder';
      this.placeholder.innerHTML = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-code"/></svg><strong>Start writing Lua</strong><small class="editor-empty-tip">Type a name to see an inline suggestion. <kbd>Tab</kbd> accepts it.</small>';
      this.scroller.appendChild(this.placeholder);
      this.measure = document.createElement('div');
      this.measure.className = 'editor-wrap-measure';
      this.measure.setAttribute('aria-hidden', 'true');
      this.scroller.appendChild(this.measure);
      this.completions = new window.InlineCompletions(this);
      this.applyOptions();
      this.setValue(this.textarea.value, true);
      this.bind();
      this.resizeObserver = new ResizeObserver(() => {
        this.metricsDirty = true;
        this.schedule();
      });
      this.resizeObserver.observe(this.textarea);
      document.fonts?.addEventListener('loadingdone', () => { this.metricsDirty = true; this.schedule(); });
    }

    get value() { return this.textarea.value; }
    getValue() { return this.value; }
    focus() { this.textarea.focus(); }
    goTo(line, column) {
      const t = this.textarea;
      const row = this.model.row(line);
      column = Math.min(column, row.text.length);
      let offset = 0;
      for (const group of this.model.blocks) {
        if (line < group.rows.length) {
          for (let i = 0; i < line; i++) offset += group.rows[i].text.length + 1;
          break;
        }
        offset += group.size;
        line -= group.rows.length;
      }
      this.completions.clear();
      this.focus();
      t.setSelectionRange(offset + column, offset + column);
      const logicalLine = this.model.locate(offset, true).line;
      t.scrollTop = this.padTop + this.rowTop(logicalLine) - t.clientHeight / 2;
      t.scrollLeft = 0;
      this.refresh();
      // Reveal the requested visual row as well as the logical line. Only
      // measure the target on this explicit navigation command.
      const node = this.nodes.get(logicalLine)?.code;
      if (!node || !column) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text, remaining = column;
      while ((text = walker.nextNode())) {
        if (remaining <= text.length) {
          const range = new Range();
          range.setStart(text, remaining); range.collapse(true);
          const caret = range.getBoundingClientRect(), view = t.getBoundingClientRect();
          if (caret.bottom > view.top + t.clientHeight || caret.top < view.top)
            t.scrollTop += caret.top - view.top - t.clientHeight / 2;
          if (caret.right > view.left + t.clientWidth)
            t.scrollLeft += caret.right - view.left - t.clientWidth + this.padRight;
          break;
        }
        remaining -= text.length;
      }
      this.schedule();
    }

    setDirty(dirty) {
      if (!this.dirtyState) return;
      this.dirtyState.textContent = dirty ? 'Unsaved' : 'Saved';
      this.dirtyState.classList.toggle('is-dirty', Boolean(dirty));
    }
    setOptions(next) {
      this.completions.clear();
      this.options = { ...this.options, ...next };
      this.applyOptions();
      this.refresh();
    }
    applyOptions() {
      this.stage.classList.toggle('wrap-on', Boolean(this.options.wrap));
      this.stage.classList.toggle('no-gutter', !this.options.lineNumbers);
      // A whole CSS-pixel line box is exactly representable by Blink's layout units.
      this.lineHeight = Math.round(this.options.fontSize * 1.7);
      this.stage.style.setProperty('--editor-row-height', this.lineHeight + 'px');
      this.stage.style.setProperty('--code-size', this.options.fontSize + 'px');
      this.stage.style.setProperty('--tab-size', this.options.tabSize);
      this.textarea.wrap = this.options.wrap ? 'soft' : 'off';
      if (Boolean(this.wrapNodes.length) !== Boolean(this.options.wrap)) this.resetWrap();
      this.metricsDirty = true;
    }
    setValue(value, silent) {
      this.completions.clear();
      this.before = null;
      this.textarea.value = value ?? '';
      this.snapshot = this.value; // Normalized LF, including on Windows.
      this.model = new window.LuaDocument(this.snapshot);
      this.resetWrap();
      this.nodes.clear();
      this.highlight.replaceChildren();
      this.gutter.replaceChildren();
      this.textarea.scrollTop = this.textarea.scrollLeft = 0;
      this.metricsDirty = true;
      this.refresh();
      if (!silent) this.emitChange();
    }

    // Only wrap mode needs browser layout for offscreen lines. Each measured
    // row is plain text; font fallback, tabs and Unicode use Blink's line breaks.
    wrapNode(text) {
      const el = document.createElement('div');
      el.textContent = text;
      return el;
    }
    resetWrap() {
      this.wrapNodes = [];
      this.measure.replaceChildren();
      if (!this.options.wrap || !this.model) return;
      const fragment = document.createDocumentFragment();
      for (const block of this.model.blocks) for (const row of block.rows) {
        const node = this.wrapNode(row.text);
        fragment.append(node);
        this.wrapNodes.push(node);
      }
      this.measure.append(fragment);
    }
    patchWrap({ first, removed, added }) {
      if (!this.options.wrap) return;
      if (removed === 1 && added.length === 1) {
        this.wrapNodes[first].textContent = added[0].text;
        return;
      }
      const fragment = document.createDocumentFragment();
      const nodes = added.map(row => this.wrapNode(row.text));
      for (const node of nodes) fragment.append(node);
      this.measure.insertBefore(fragment, this.wrapNodes[first]);
      for (let i = first; i < first + removed; i++) this.wrapNodes[i].remove();
      // A pasted file can have more rows than a function's argument limit.
      this.wrapNodes = this.wrapNodes.slice(0, first).concat(nodes, this.wrapNodes.slice(first + removed));
    }

    applyInput(event) {
      const value = this.value, old = this.snapshot, pre = this.before;
      this.before = null;
      let start, end, inserted;
      // beforeinput captures selection replacements, paste, and ordinary
      // backspace/delete without reading or diffing the unchanged prefix.
      if (pre && /^(insertText|insertLineBreak|insertParagraph|insertFromPaste|deleteContentBackward|deleteContentForward|deleteByCut)$/.test(event.inputType)) {
        start = pre.start; end = pre.end;
        const diff = value.length - old.length;
        if (start === end && diff < 0 && event.inputType === 'deleteContentBackward') start += diff;
        if (start === end && diff < 0 && event.inputType === 'deleteContentForward') end -= diff;
        const size = diff + end - start;
        if (size >= 0 && start >= 0 && end <= old.length && this.textarea.selectionStart === start + size)
          inserted = value.slice(start, start + size);
      }
      // Some engines omit beforeinput for commands, undo, IME and drag/drop.
      // Recover the actual replacement for these cases, keeping native history.
      if (inserted === undefined) {
        start = 0;
        let tail = value.length;
        end = old.length;
        while (start < end && start < tail && old.charCodeAt(start) === value.charCodeAt(start)) start++;
        while (end > start && tail > start && old.charCodeAt(end - 1) === value.charCodeAt(tail - 1)) { end--; tail--; }
        inserted = value.slice(start, tail);
      }
      if (start !== end || inserted) this.patchWrap(this.model.replace(start, end, inserted));
      this.snapshot = value;
      this.completions.onInput(event);
      this.schedule();
      this.emitChange();
    }

    schedule() {
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
    }
    updateCursor() { this.schedule(); }
    rowTop(line) {
      return this.options.wrap ? this.wrapNodes[line].offsetTop : line * this.lineHeight;
    }
    visibleLine(y) {
      if (!this.options.wrap) return Math.max(0, Math.min(this.model.count - 1, Math.floor(y / this.lineHeight)));
      let low = 0, high = this.model.count;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (this.rowTop(mid) <= y) low = mid;
        else high = mid;
      }
      return low;
    }

    refresh() {
      if (this.metricsDirty) {
        this.metricsDirty = false;
        const css = getComputedStyle(this.textarea);
        this.padTop = parseFloat(css.paddingTop);
        this.padLeft = parseFloat(css.paddingLeft);
        this.padRight = parseFloat(css.paddingRight);
      }
      const t = this.textarea, width = t.clientWidth, height = t.clientHeight;
      if (this.options.wrap) {
        const contentWidth = Math.max(0, width - this.padLeft - this.padRight) + 'px';
        if (this.measure.style.width !== contentWidth) this.measure.style.width = contentWidth;
        this.highlight.style.width = contentWidth;
      } else this.highlight.style.removeProperty('width');
      const top = t.scrollTop, left = t.scrollLeft;
      const start = t.selectionStart, selected = t.selectionEnd - start;
      const pos = this.model.locate(start, true);
      const first = Math.max(0, this.visibleLine(top - this.padTop) - 2);
      const last = Math.min(this.model.count - 1, this.visibleLine(top + height - this.padTop) + 2);
      // Read layout before changing any painted row or decoration.
      const tops = [];
      for (let line = first; line <= last; line++) tops.push(this.rowTop(line));
      const base = tops[0], y = this.padTop + base - top;
      const activeVisible = pos.line >= first && pos.line <= last;
      const activeTop = activeVisible ? tops[pos.line - first] : 0;
      const activeHeight = activeVisible && this.options.wrap ? this.wrapNodes[pos.line].offsetHeight : this.lineHeight;
      this.highlight.style.transform = 'translate(' + (this.padLeft - left) + 'px,' + y + 'px)';
      for (const [line, node] of this.nodes) if (line < first || line > last) {
        node.code.remove(); node.number.remove(); this.nodes.delete(line);
      }
      for (let line = first; line <= last; line++) {
        const row = this.model.row(line);
        let node = this.nodes.get(line);
        if (!node) {
          const code = document.createElement('div'), number = document.createElement('div');
          code.className = 'syntax-row'; number.className = 'gl';
          code.dataset.line = number.dataset.line = String(line + 1);
          number.textContent = String(line + 1);
          this.highlight.append(code); this.gutter.append(number);
          this.nodes.set(line, node = { code, number });
        }
        if (node.tokens !== row.tokens) {
          node.code.innerHTML = syntax(row);
          node.tokens = row.tokens;
        }
        node.code.style.top = (tops[line - first] - base) + 'px';
        node.number.style.transform = 'translateY(' + (y + tops[line - first] - base) + 'px)';
        node.number.classList.toggle('active', line === pos.line);
      }
      this.currentLine.hidden = !this.options.highlightLine || !activeVisible;
      this.currentLine.style.transform = 'translateY(' + (this.padTop + activeTop - top) + 'px)';
      this.currentLine.style.height = activeHeight + 'px';
      const info = 'Ln ' + (pos.line + 1) + ', Col ' + (pos.column + 1) + (selected ? ' · ' + selected + ' selected' : '');
      if (this.cursorInfo && this.cursorInfo.textContent !== info) this.cursorInfo.textContent = info;
      this.placeholder.classList.toggle('visible', this.snapshot.length === 0);
      this.completions.onSelection();
      this.completions.place(this.nodes.get(pos.line)?.code, pos.column);
    }

    bind() {
      const t = this.textarea;
      t.addEventListener('beforeinput', () => {
        this.before = { start: t.selectionStart, end: t.selectionEnd };
      });
      t.addEventListener('input', event => this.applyInput(event));
      t.addEventListener('scroll', () => this.schedule(), { passive: true });
      t.addEventListener('keydown', event => this.onKeyDown(event));
      for (const name of ['select', 'focus', 'keyup', 'click', 'selectionchange']) t.addEventListener(name, () => this.schedule());
      document.addEventListener('selectionchange', () => { if (document.activeElement === t) this.schedule(); });
    }
    emitChange() { this.callbacks.onChange?.(this.snapshot); }
    save() {
      if (typeof this.callbacks.onSave === 'function') this.callbacks.onSave();
    }

    run() {
      if (typeof this.callbacks.onRun === 'function') this.callbacks.onRun();
    }

    acceptCompletion(suffix) {
      // Moving the selection ends Blink's current typing command, giving the
      // completion an undo boundary even when Tab follows the last key directly.
      const t = this.textarea, offset = t.selectionStart;
      t.setSelectionRange(offset - 1, offset);
      t.setSelectionRange(offset, offset);
      this.insertText(suffix);
    }

    insertText(text, selectStart, selectEnd) {
      this.textarea.focus();
      this.before = { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
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
    }

    onKeyDown(event) {
      if (event.isComposing || this.completions.composing || this.completions.keyDown(event)) return;
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

  LuaEditor.highlight = text => {
    const doc = new window.LuaDocument(text);
    return doc.blocks.flatMap(group => group.rows.map(syntax)).join('\n');
  };
  window.LuaEditor = LuaEditor;
})();
