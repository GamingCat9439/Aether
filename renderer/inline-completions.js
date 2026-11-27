/* Local Luau statement and name completions use the editor’s incremental token index. */
(() => {
  'use strict';

  const globals = (
    'print local function return then elseif else end true false nil and assert break continue do error ' +
    'export for if in ipairs math next not or pairs pcall repeat require select setmetatable string table ' +
    'task tonumber tostring type typeof until warn while workspace xpcall coroutine utf8 game script ' +
    'Vector2 Vector3 Color3 CFrame UDim UDim2 Instance Enum Random'
  ).split(' ');
  const members = new Map(Object.entries({
    'math.': 'abs ceil clamp cos deg exp floor fmod huge log max min pi rad random round sign sin sqrt tan',
    'string.': 'format byte char find gmatch gsub len lower match rep reverse split sub upper',
    'table.': 'insert clear clone concat create find freeze isfrozen move pack remove sort unpack',
    'task.': 'wait defer delay spawn cancel',
    'coroutine.': 'create resume running status wrap yield',
    'utf8.': 'char codes codepoint len offset',
    'Vector2.': 'new one zero xAxis yAxis',
    'Vector3.': 'new one zero xAxis yAxis zAxis',
    'Color3.': 'fromRGB fromHSV fromHex new',
    'CFrame.': 'new Angles fromAxisAngle fromEulerAnglesXYZ lookAt identity',
    'UDim.': 'new',
    'UDim2.': 'fromOffset fromScale new',
    'Instance.': 'new',
    'Random.': 'new',
    'game:': 'GetService FindService',
    'workspace.': 'CurrentCamera Gravity Terrain',
    'workspace:': 'FindFirstChild GetChildren GetDescendants WaitForChild Raycast',
    'script.': 'Parent Name ClassName',
    'script:': 'FindFirstChild GetChildren GetDescendants WaitForChild',
  }).map(([receiver, words]) => [receiver, words.split(' ')]));

  const preference = 'aether.editor.inlineSuggestions';

  class InlineCompletions {
    constructor(editor) {
      this.editor = editor;
      this.field = editor.textarea;
      this.hint = document.getElementById('inlineCompletionHint');
      this.count = document.getElementById('completionCount');
      this.source = document.getElementById('completionSource');
      this.announcement = document.getElementById('completionAnnouncement');
      this.toggle = document.getElementById('toggleInlineSuggestions');
      this.enabled = true;
      try { this.enabled = localStorage.getItem(preference) !== 'off'; } catch { /* Session only. */ }
      this.updateToggle();
      this.toggle?.addEventListener('click', () => {
        this.enabled = !this.enabled;
        try { localStorage.setItem(preference, this.enabled ? 'on' : 'off'); } catch { /* Session only. */ }
        this.updateToggle();
        this.clear();
      });
      this.field.addEventListener('compositionstart', () => {
        this.composing = true;
        this.clear();
      });
      this.field.addEventListener('compositionend', () => { this.composing = false; });
      for (const event of ['blur', 'pointerdown']) {
        this.field.addEventListener(event, () => this.clear());
      }
    }

    updateToggle() {
      this.toggle?.classList.toggle('on', this.enabled);
      this.toggle?.setAttribute('aria-checked', String(this.enabled));
      this.editor.stage.classList.toggle('suggestions-enabled', this.enabled);
    }

    clear() {
      this.active = null;
      this.ghost?.remove();
      this.ghost = null;
      if (this.hint) this.hint.hidden = true;
      if (this.announcement) this.announcement.textContent = '';
    }

    atCaret(offset) {
      return document.activeElement === this.field && this.field.selectionStart === offset &&
        this.field.selectionEnd === offset;
    }

    onSelection() {
      const state = this.active;
      if (state && !this.atCaret(state.offset)) this.clear();
    }

    onInput(event) {
      this.clear();
      if (!this.composing && !event.isComposing && event.inputType === 'insertText' &&
          /^[\w.: =]$/.test(event.data || '')) this.request(false);
    }

    request(manual) {
      const offset = this.field.selectionStart;
      if (!this.enabled || this.composing || !offset || !this.atCaret(offset)) return;
      const model = this.editor.model;
      const { row, column, line } = model.locate(offset, true);
      const tail = row.text.slice(column);
      if (!(this.editor.options.wrap ? /^\s*$/ : /^[\s)\]};,]*$/).test(tail)) return;
      const token = row.tokens.find(part => part.from < column && part.to >= column);
      if (token && (token.kind === 't-com' || token.kind === 't-str')) return;
      if (!column && row.incoming) return;
      const left = row.text.slice(0, column), atLineEnd = !tail.trim();
      const candidates = new Map();
      const offer = (suffix, source) => {
        if (suffix && !candidates.has(suffix)) candidates.set(suffix, source);
      };
      const decl = /^\s*local\s+([A-Za-z_]\w*)([ \t]*(?:=[ \t]*[\w.:]*)?)$/.exec(left);
      if (decl && atLineEnd) {
        const name = decl[1], typed = decl[2];
        const expression = statementValue(model, line, name);
        if (expression) {
          const expected = typed.includes('=') ? typed.match(/^[ \t]*=[ \t]*/)[0] + expression :
            (typed || ' ') + '= ' + expression;
          if (expected.startsWith(typed)) offer(expected.slice(typed.length), 'Luau statement');
        }
      }
      if (!candidates.size) {
        const prefix = left.match(/[A-Za-z_]\w*$/)?.[0] || '';
        const before = left.slice(0, left.length - prefix.length);
        const member = before.match(/([A-Za-z_]\w*)[ \t]*([.:])[ \t]*$/);
        if (member && /[.:][ \t]*$/.test(before.slice(0, member.index))) return;
        if (!member && (prefix.length < (manual ? 1 : 2) || /[.:][ \t]*$|\b(?:local|function|for)[ \t]+$/.test(before))) return;
        const receiver = member ? member[1] + member[2] : '';
        const match = (name, source) => {
          if (name.startsWith(prefix) && name !== prefix && candidates.size < 24) offer(name.slice(prefix.length), source);
        };
        if (!receiver) {
          for (let i = line - 1; i >= Math.max(0, line - 24); i--) {
            for (const name of model.row(i).names) if (!/[.:]/.test(name)) match(name, 'From this file');
          }
        }
        const bucket = model.names.get(receiver || prefix.slice(0, 2));
        if (bucket) for (const name of bucket.keys()) {
          match(name.slice(receiver.length), 'From this file');
          if (candidates.size >= 24) break;
        }
        const builtin = receiver ? members.get(receiver) || [] : globals;
        if (builtin.includes(prefix)) return;
        for (const name of builtin) match(name, receiver ? member[1] + ' member' : 'Lua / Luau');
      }
      if (!candidates.size) return;
      this.active = { offset, matches: [...candidates], index: 0, atLineEnd };
      this.ghost = document.createElement('span');
      this.ghost.className = 'completion-ghost';
      if (atLineEnd) this.ghost.setAttribute('data-keycap', '');
      this.paint(manual);
    }

    place(node, column) {
      if (!this.active || !node || this.ghost.parentNode === node) return;
      // The lexer only offers at token boundaries. An absolute ghost in wrap
      // mode also keeps the native line breaks when the suffix is very long.
      let end = 0;
      for (const child of node.childNodes) {
        end += child.textContent.length;
        if (end === column) { child.after(this.ghost); return; }
      }
    }

    paint(announce) {
      const { matches, index, atLineEnd } = this.active;
      const [suffix, label] = matches[index];
      this.ghost.dataset.completion = suffix;
      if (this.hint) {
        this.hint.hidden = false;
        this.hint.classList.toggle('at-line-end', atLineEnd);
      }
      if (this.source) this.source.textContent = label;
      if (this.count) {
        this.count.hidden = matches.length < 2;
        this.count.textContent = (index + 1) + '/' + matches.length;
      }
      if (announce && this.announcement) this.announcement.textContent = suffix + '. Press Tab to accept.';
    }
    keyDown(event) {
      if (event.isComposing || this.composing) return false;
      this.onSelection();
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space' && !event.altKey && this.enabled) {
        this.clear();
        this.request(true);
        this.editor.refresh();
        if (!this.active && this.announcement) this.announcement.textContent = 'No suggestion here.';
      } else if (this.active && event.altKey && !event.ctrlKey && !event.metaKey &&
                 (event.code === 'BracketRight' || event.code === 'BracketLeft')) {
        const n = this.active.matches.length;
        this.active.index = (this.active.index + (event.code === 'BracketRight' ? 1 : -1) + n) % n;
        this.paint(true);
      } else if (this.active && event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const suffix = this.ghost.dataset.completion;
        this.clear();
        this.editor.acceptCompletion(suffix);
        this.clear();
      } else if (this.active && event.key === 'Escape') {
        this.clear();
      } else {
        if (['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) this.clear();
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }

  const services = new Map(('Players RunService TweenService ReplicatedStorage ServerStorage ServerScriptService ' +
    'UserInputService CollectionService HttpService Lighting SoundService Workspace Debris StarterGui ' +
    'ContextActionService TeleportService PathfindingService MarketplaceService DataStoreService').split(' ')
    .map(name => [name.toLowerCase(), name]));
  function statementValue(model, line, name) {
    const service = services.get(name.toLowerCase());
    if (service) return 'game:GetService("' + service + '")';
    const usePlayer = ['player', 'localplayer'].includes(name.toLowerCase());
    const useCharacter = name.toLowerCase() === 'character';
    if (!usePlayer && !useCharacter && name.toLowerCase() !== 'humanoid') return '';
    for (let i = line - 1; i >= Math.max(0, line - 80); i--) {
      const row = model.row(i);
      if (row.tokens[0]?.kind !== 't-kw') continue;
      const local = /^\s*local\s+([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(row.text);
      if (!local) continue;
      const [, alias, rhs] = local;
      if (usePlayer && /^game\s*:\s*GetService\s*\(\s*(["'])Players\1\s*\)/.test(rhs)) return alias + '.LocalPlayer';
      if (useCharacter && /\.LocalPlayer\b/.test(rhs)) return alias + '.Character';
      if (!usePlayer && !useCharacter && /\.Character\b/.test(rhs)) return alias + ':WaitForChild("Humanoid")';
      if (alias === name) break;
    }
    return '';
  }
  window.InlineCompletions = InlineCompletions;
})();
