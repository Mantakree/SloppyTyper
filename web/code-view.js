const keywords = /^(?:import|from|export|class|private|public|async|await|const|let|var|if|else|return|new|function|def|self|for|while|try|catch|throw|interface|type|true|false|null|undefined|None|True|False|fn|pub|use|impl|struct|match|package|func)$/;

function highlighted(document, text) {
  const nodes = [];
  let plain = '';
  const flush = () => { if (plain) nodes.push(document.createTextNode(plain)); plain = ''; };
  const tokens = text.match(/\/\/.*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b[a-zA-Z_]\w*\b|\b\d+(?:\.\d+)?\b|[^\w"'`/#]+|./gu) || [];
  for (const token of tokens) {
    const style = token.startsWith('//') || token.startsWith('#') ? 'syntax-comment'
      : /^["'`]/.test(token) ? 'syntax-string'
      : keywords.test(token) ? 'syntax-keyword' : /^\d/.test(token) ? 'syntax-number' : '';
    if (!style) { plain += token; continue; }
    flush();
    const span = document.createElement('span');
    span.className = style;
    span.textContent = token;
    nodes.push(span);
  }
  flush();
  return nodes;
}

function reconcile(parent, children) {
  const keep = new Set(children);
  for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
  let next = parent.firstChild;
  for (const child of children) {
    if (child === next) next = next.nextSibling;
    else parent.insertBefore(child, next);
  }
}

function sameLine(a, b) {
  return a.text === b.text && a.caret === b.caret && a.runs.length === b.runs.length
    && a.runs.every((run, i) => run.start === b.runs[i].start && run.end === b.runs[i].end && run.kind === b.runs[i].kind);
}

export class CodeView {
  constructor(element) {
    this.element = element;
    this.document = element.ownerDocument;
    this.rows = [];
    this.layoutVersion = 0;
    this.caret = this.document.createElement('span');
    this.caret.className = 'caret';
  }

  updateRow(line, previous) {
    if (previous && previous.text !== line.text) this.reflowFrom = Math.min(this.reflowFrom, line.position);
    if (previous && sameLine(line, previous)) {
      if (line.number !== previous.number) previous.numberNode.textContent = line.number;
      return { ...previous, ...line };
    }
    const row = previous?.row ?? this.document.createElement('span');
    const numberNode = previous?.numberNode ?? this.document.createElement('span');
    const content = previous?.content ?? this.document.createElement('span');
    row.className = line.caret < 0 ? 'code-line' : 'code-line active-line';
    numberNode.className = 'line-number';
    numberNode.textContent = line.number;
    content.className = 'line-content';
    if (!previous) row.append(numberNode, content);
    const children = [];
    const append = (start, end) => {
      for (const run of line.runs) {
        if (run.end <= start || run.start >= end) continue;
        if (run.start > start) children.push(...highlighted(this.document, line.text.slice(start, run.start)));
        const stop = Math.min(end, run.end);
        const span = this.document.createElement('span');
        span.className = run.kind;
        span.textContent = line.text.slice(Math.max(start, run.start), stop);
        children.push(span);
        start = stop;
      }
      children.push(...highlighted(this.document, line.text.slice(start, end)));
    };
    if (line.caret < 0) append(0, line.text.length);
    else { append(0, line.caret); children.push(this.caret); append(line.caret, line.text.length); }
    reconcile(content, children);
    let offset = 0;
    const source = [];
    for (const child of children) {
      const node = child.nodeType === 3 ? child : child.firstChild;
      if (!node?.textContent.length) continue;
      source.push({ node, start: offset, end: offset + node.textContent.length });
      offset += node.textContent.length;
    }
    return { ...line, row, numberNode, content, source };
  }

  render(replay, drops) {
    this.reflowFrom = Infinity;
    if (this.replay !== replay) {
      this.replay = replay;
      this.rows = [];
      this.layoutVersion++;
      this.element.replaceChildren();
    }
    const { text, cursor, upcoming } = replay.view();
    const allLines = text.split('\n');
    const cursorLine = text.slice(0, cursor).split('\n').length - 1;
    const start = allLines.length > 1000 ? Math.max(0, cursorLine - 80) : 0;
    const end = allLines.length > 1000 ? Math.min(allLines.length, cursorLine + 170) : allLines.length;
    if (this.start !== start) this.layoutVersion++;
    this.start = start;
    const falling = [...drops].sort((a, b) => a[0] - b[0]);
    let position = 0, dropIndex = 0, addedIndex = 0, upcomingIndex = 0;
    const lines = [];
    for (let i = 0; i < end; i++) {
      const line = allLines[i], runs = [], pending = [];
      const limit = position + line.length;
      while (dropIndex < falling.length && falling[dropIndex][0] < limit) {
        const [offset, drop] = falling[dropIndex++];
        if (offset >= position) pending.push({ start: offset - position, end: offset - position + drop.char.length });
      }
      while (addedIndex < replay.added.length && replay.added[addedIndex].end <= position) addedIndex++;
      while (upcomingIndex < upcoming.length && upcoming[upcomingIndex].end <= position) upcomingIndex++;
      if (i >= start) {
        // Whole runs share a single span; no per-character DOM or CSS animation.
        for (let a = addedIndex; a < replay.added.length && replay.added[a].start < limit; a++) {
          const added = replay.added[a];
          const from = Math.max(position, added.start) - position;
          const to = Math.min(limit, added.end) - position;
          let next = from;
          const push = (start, end, kind) => {
            if (start >= end) return;
            const last = runs.at(-1);
            if (last?.kind === kind && last.end === start) last.end = end;
            else runs.push({ start, end, kind });
          };
          for (const hidden of pending) {
            if (hidden.end <= from || hidden.start >= to) continue;
            push(next, hidden.start, 'code-added');
            push(hidden.start, hidden.end, 'rain-pending');
            next = hidden.end;
          }
          push(next, to, 'code-added');
        }
        // Upcoming edits follow all written ranges. Both use whole spans so
        // previewing a large deletion never creates one element per character.
        for (let u = upcomingIndex; u < upcoming.length && upcoming[u].start < limit; u++) {
          runs.push({ start: Math.max(position, upcoming[u].start) - position,
            end: Math.min(limit, upcoming[u].end) - position, kind: 'code-upcoming' });
        }
        lines.push({ text: line, position, number: i + 1, runs, caret: i === cursorLine && !replay.done ? cursor - position : -1 });
      }
      position = limit + 1;
    }
    let prefix = 0, suffix = 0;
    while (prefix < Math.min(lines.length, this.rows.length) && sameLine(lines[prefix], this.rows[prefix])) prefix++;
    while (suffix < Math.min(lines.length, this.rows.length) - prefix
      && sameLine(lines[lines.length - suffix - 1], this.rows[this.rows.length - suffix - 1])) suffix++;
    const windowShift = start - ((this.rows[0]?.number ?? 1) - 1);
    const rows = lines.map((line, i) => {
      const middle = i + windowShift;
      const previous = i >= lines.length - suffix ? this.rows[this.rows.length - (lines.length - i)]
        : i < prefix ? this.rows[i]
        : middle >= prefix && middle < this.rows.length - suffix ? this.rows[middle] : undefined;
      return this.updateRow(line, previous);
    });
    reconcile(this.element, rows.map(({ row }) => row));
    this.rows = rows;
    return { text, active: replay.done ? null : this.caret };
  }

  // Return source glyph coordinates in scroll-content space. Only call between
  // DOM writes, never per animation frame. Normal unwrapped ASCII lines need
  // one measured glyph per line; wrapped text, tabs and Unicode use real ranges.
  positions(characters, viewport) {
    if (!characters.length) return new Map();
    const bounds = viewport.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(this.element).lineHeight);
    const geometry = new Map(), result = new Map();
    const range = this.document.createRange();
    for (const { offset, char } of characters) {
      let lo = 0, hi = this.rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.rows[mid].position + this.rows[mid].text.length <= offset) lo = mid + 1;
        else hi = mid;
      }
      const line = this.rows[lo];
      if (!line || offset < line.position) continue;
      let metrics = geometry.get(line);
      if (!metrics) {
        const box = line.content.getBoundingClientRect();
        const fast = /^[\x20-\x7e]*$/.test(line.text) && box.height <= lineHeight + .5;
        metrics = { box, fast };
        if (fast && line.source.length) {
          range.setStart(line.source[0].node, 0);
          range.setEnd(line.source[0].node, 1);
          metrics.first = range.getBoundingClientRect();
        }
        geometry.set(line, metrics);
      }
      if (metrics.box.bottom < bounds.top - 250 || metrics.box.top > bounds.bottom + 250) continue;
      const column = offset - line.position;
      let box;
      if (metrics.fast && metrics.first?.width) {
        const first = metrics.first;
        box = { left: first.left + column * first.width, top: first.top };
      } else {
        const segment = line.source.find(part => part.start <= column && part.end > column);
        if (!segment) continue;
        range.setStart(segment.node, column - segment.start);
        range.setEnd(segment.node, Math.min(segment.node.textContent.length, column - segment.start + char.length));
        box = range.getBoundingClientRect();
      }
      result.set(offset, { char, x: box.left - bounds.left, y: box.top - bounds.top + viewport.scrollTop });
    }
    return result;
  }
}

export function charactersIn(ranges) {
  const characters = [];
  for (const { offset, text } of ranges) {
    let position = offset;
    for (const char of text) {
      if (!/\s/u.test(char)) characters.push({ offset: position, char });
      position += char.length;
    }
  }
  return characters;
}
