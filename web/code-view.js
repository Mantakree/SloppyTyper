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

// Never detach retained nodes: doing so restarts their CSS animations, even
// when the same node is attached again within a single animation frame.
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
  return a.text === b.text && a.caret === b.caret && a.drops.length === b.drops.length
    && a.drops.every((entry, i) => entry.index === b.drops[i].index && entry.drop === b.drops[i].drop);
}

export class CodeView {
  constructor(element) {
    this.element = element;
    this.document = element.ownerDocument;
    this.rows = [];
    this.characters = new WeakMap();
    this.caret = this.document.createElement('span');
    this.caret.className = 'caret';
  }

  character(drop, now) {
    let node = this.characters.get(drop);
    if (!node) {
      node = this.document.createElement('span');
      node.className = 'rain-char';
      node.textContent = drop.char;
      node.dataset.trail = drop.trail;
      node.style.setProperty('--rain-duration', `${drop.duration}ms`);
      node.style.setProperty('--rain-delay', `${drop.start - now}ms`);
      node.style.setProperty('--rain-height', `${drop.height}px`);
      this.characters.set(drop, node);
    }
    return node;
  }

  updateRow(line, previous, now) {
    if (previous && sameLine(line, previous)) {
      if (line.number !== previous.number) previous.numberNode.textContent = line.number;
      return { ...previous, number: line.number };
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
    const append = (start, end, drops) => {
      for (const { index, drop } of drops) {
        children.push(...highlighted(this.document, line.text.slice(start, index)), this.character(drop, now));
        start = index + drop.char.length;
      }
      children.push(...highlighted(this.document, line.text.slice(start, end)));
    };
    if (line.caret < 0) append(0, line.text.length, line.drops);
    else {
      append(0, line.caret, line.drops.filter(({ index }) => index < line.caret));
      children.push(this.caret);
      append(line.caret, line.text.length, line.drops.filter(({ index }) => index >= line.caret));
    }
    reconcile(content, children);
    return { ...line, row, numberNode, content };
  }

  render(replay, drops, now) {
    if (this.replay !== replay) {
      this.replay = replay;
      this.rows = [];
      this.characters = new WeakMap();
      this.element.replaceChildren();
    }
    const { text, cursor } = replay.view();
    const allLines = text.split('\n');
    const cursorLine = text.slice(0, cursor).split('\n').length - 1;
    const start = allLines.length > 1000 ? Math.max(0, cursorLine - 80) : 0;
    const end = allLines.length > 1000 ? Math.min(allLines.length, cursorLine + 170) : allLines.length;
    const falling = [...drops].sort((a, b) => a[0] - b[0]);
    let position = 0, dropIndex = 0;
    const lines = [];
    // Walk the drops once, instead of scanning every drop for every line.
    for (let i = 0; i < end; i++) {
      const line = allLines[i], lineDrops = [];
      while (dropIndex < falling.length && falling[dropIndex][0] < position + line.length) {
        const [offset, drop] = falling[dropIndex++];
        if (i >= start && offset >= position) lineDrops.push({ index: offset - position, drop });
      }
      if (i >= start) lines.push({ text: line, number: i + 1, drops: lineDrops, caret: i === cursorLine && !replay.done ? cursor - position : -1 });
      position += line.length + 1;
    }
    // Keep both ends of the document when an edit inserts/removes lines.
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
      return this.updateRow(line, previous, now);
    });
    reconcile(this.element, rows.map(({ row }) => row));
    this.rows = rows;
    return { text, active: replay.done ? null : this.caret };
  }
}
