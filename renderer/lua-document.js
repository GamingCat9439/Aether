/* The textarea owns editing and undo. Keep an index in small blocks so a
   one-character edit does not shift every later line's character offset. */
(() => {
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

  const longOpen = /\[(=*)\[/y;
  const word = /[A-Za-z_]\w*/y;
  const number = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.(?!\.)[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]+)?)/y;
  const op = /(?:\.\.\.?|\/\/|==|~=|<=|>=|::|->|[+*/%^#=<>~-])/y;

  function tokenize(text, incoming) {
    const tokens = [], names = new Set();
    let at = 0, state = incoming;
    const add = (from, kind) => tokens.push({ from, to: at, kind });

    function literal(from, kind, delimiter, quoted) {
      if (!quoted) {
        const end = text.indexOf(delimiter, at);
        at = end < 0 ? text.length : end + delimiter.length;
        state = end < 0 ? kind + delimiter : '';
        add(from, kind);
        return;
      }
      let continued = false, closed = false;
      while (at < text.length) {
        const ch = text[at++];
        if (ch === delimiter) { closed = true; break; }
        if (ch === '\\') {
          if (at === text.length) continued = true;
          else if (text[at++] === 'z') {
            while (at < text.length && /\s/.test(text[at])) at++;
            if (at === text.length) continued = 'z';
          }
        }
      }
      state = !closed && (continued || delimiter === '`')
        ? kind + delimiter + (continued === 'z' ? 'z' : '') : '';
      add(from, kind);
    }

    if (state) {
      const kind = state.slice(0, 5), delimiter = state.slice(5);
      if (delimiter.length === 2 && delimiter[1] === 'z' && /^\s*$/.test(text)) {
        at = text.length;
        add(0, kind);
      } else {
        const quoted = delimiter[0] !== ']';
        literal(0, kind, quoted ? delimiter[0] : delimiter, quoted);
      }
    }
    while (at < text.length) {
      const from = at, ch = text[at];
      const comment = text.startsWith('--', at);
      if (comment || ch === '[') {
        longOpen.lastIndex = at + (comment ? 2 : 0);
        const match = longOpen.exec(text);
        if (match) {
          at = longOpen.lastIndex;
          literal(from, comment ? 't-com' : 't-str', ']' + match[1] + ']', false);
          continue;
        }
        if (comment) { at = text.length; add(from, 't-com'); continue; }
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        at++;
        literal(from, 't-str', ch, true);
        continue;
      }
      number.lastIndex = word.lastIndex = op.lastIndex = at;
      if (/[A-Za-z_]/.test(ch)) {
        const name = word.exec(text)[0];
        at = word.lastIndex;
        const prev = tokens.at(-1);
        const prevText = prev ? text.slice(prev.from, prev.to) : '';
        const adjacent = prev && /^\s*$/.test(text.slice(prev.to, from));
        const property = adjacent && (prevText === '.' || prevText === ':');
        let kind = 't-id';
        if (KEYWORDS.has(name)) kind = 't-kw';
        else if (CONSTANTS.has(name)) kind = 't-const';
        else if (property) kind = 't-prop';
        else if (BUILTINS.has(name)) kind = 't-builtin';
        else if ((adjacent && prevText === 'function') || /^[ \t]*\(/.test(text.slice(at))) kind = 't-fn';
        add(from, kind);
        if (kind === 't-id' || kind === 't-fn') names.add(name);
        if (property) {
          const owner = tokens.at(-3), earlier = tokens.at(-4);
          const method = earlier && text.slice(earlier.from, earlier.to) === 'function';
          const assignment = /^[ \t]*=(?!=)/.test(text.slice(at));
          if ((method || assignment) && owner && ['t-id', 't-builtin'].includes(owner.kind)) {
            names.add(text.slice(owner.from, owner.to) + prevText + name);
          }
        }
      } else if ((/[\d.]/.test(ch)) && number.exec(text)) {
        at = number.lastIndex; add(from, 't-num');
      } else if (op.exec(text)) {
        at = op.lastIndex; add(from, 't-op');
      } else {
        at++;
        if ('{}()[],;:.'.includes(ch)) add(from, 't-punc');
      }
    }
    return { tokens, names, incoming, outgoing: state };
  }

  const BLOCK = 96;
  const makeRow = text => ({ text });
  function block(rows) {
    return { rows, size: rows.reduce((sum, row) => sum + row.text.length + 1, 0) };
  }

  class LuaDocument {
    constructor(text) {
      this.names = new Map();
      this.blocks = [];
      const lines = text.split('\n');
      this.count = lines.length;
      for (let i = 0; i < lines.length; i += BLOCK) {
        this.blocks.push(block(lines.slice(i, i + BLOCK).map(makeRow)));
      }
      this.relex(0, this.count);
    }

    // Both lengths include the separator after each row (also a virtual EOF
    // separator). Thus an offset on a newline still belongs to the previous row.
    locate(target, byOffset = false) {
      let line = 0, offset = 0, b = 0;
      while (b < this.blocks.length - 1) {
        const group = this.blocks[b];
        if (target < (byOffset ? offset + group.size : line + group.rows.length)) break;
        offset += group.size; line += group.rows.length; b++;
      }
      const rows = this.blocks[b].rows;
      let i = byOffset ? 0 : target - line;
      if (byOffset) {
        while (i + 1 < rows.length && offset + rows[i].text.length < target) {
          offset += rows[i++].text.length + 1;
        }
      }
      return { b, i, line: line + i, row: rows[i], column: byOffset ? target - offset : 0 };
    }

    row(line) { return this.locate(line).row; }

    indexNames(names, delta) {
      for (const name of names || []) {
        const member = name.match(/^(\w+[.:])/);
        const key = member ? member[1] : name.slice(0, 2);
        let bucket = this.names.get(key);
        if (!bucket) this.names.set(key, bucket = new Map());
        const count = (bucket.get(name) || 0) + delta;
        if (count) bucket.set(name, count);
        else {
          bucket.delete(name);
          if (!bucket.size) this.names.delete(key);
        }
      }
    }

    relex(first, stop) {
      let state = first ? this.row(first - 1).outgoing : '';
      let { b, i } = this.locate(first);
      for (let line = first; line < this.count; line++) {
        const rows = this.blocks[b].rows, row = rows[i++];
        if (line >= stop && row.incoming === state) break;
        this.indexNames(row.names, -1);
        Object.assign(row, tokenize(row.text, state));
        this.indexNames(row.names, 1);
        state = row.outgoing;
        if (i === rows.length) { b++; i = 0; }
      }
    }

    replace(from, to, insert) {
      const a = this.locate(from, true), b = this.locate(to, true);
      const replacement = (a.row.text.slice(0, a.column) + insert + b.row.text.slice(b.column)).split('\n').map(makeRow);
      for (let j = a.b; j <= b.b; j++) {
        const rows = this.blocks[j].rows;
        for (let k = j === a.b ? a.i : 0; k < (j === b.b ? b.i + 1 : rows.length); k++) {
          this.indexNames(rows[k].names, -1);
        }
      }
      const before = this.blocks[a.b].rows.slice(0, a.i);
      const after = this.blocks[b.b].rows.slice(b.i + 1);
      const combined = before.concat(replacement, after), groups = [];
      for (let i = 0; i < combined.length; i += BLOCK * 2) groups.push(block(combined.slice(i, i + BLOCK * 2)));
      this.blocks.splice(a.b, b.b - a.b + 1, ...groups);
      const removed = b.line - a.line + 1;
      this.count += replacement.length - removed;
      this.relex(a.line, a.line + replacement.length);
      return { first: a.line, removed, added: replacement };
    }
  }
  window.LuaDocument = LuaDocument;
})();
