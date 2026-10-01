// Pure replay state. There is deliberately no file system or network access here.
export class Replay {
  constructor(file) {
    this.file = file;
    this.parts = file.parts.map(p => ({ ...p, chars: [...p.text] }));
    this.index = 0;
    this.offset = 0;
    this.prefix = '';
    this.progress = 0;
    this.total = file.total;
    this.added = [];
    this.cachedView = null;
    this.skipEqual();
  }
  skipEqual() {
    while (this.parts[this.index]?.type === 'equal') {
      this.prefix += this.parts[this.index].text;
      this.index++;
    }
  }
  step(count = 1) {
    let remaining = Math.max(0, Math.floor(count));
    const inserted = [], removed = [];
    let shift = 0;
    while (remaining > 0 && !this.done) {
      const part = this.parts[this.index];
      if (!part) { this.progress = this.total; break; } // Empty file creation/deletion.
      const take = Math.min(remaining, part.chars.length - this.offset);
      const text = part.chars.slice(this.offset, this.offset + take).join('');
      if (part.type === 'add') {
        inserted.push({ offset: this.prefix.length, text });
        const previous = this.added.at(-1);
        if (previous?.end === this.prefix.length) previous.end += text.length;
        else this.added.push({ start: this.prefix.length, end: this.prefix.length + text.length });
        this.prefix += text;
        shift += text.length;
      } else {
        // Deletion offsets refer to the document BEFORE this entire step, so
        // the view can capture their positions before changing the layout.
        removed.push({ offset: this.prefix.length - shift, text });
        shift -= text.length;
      }
      this.offset += take;
      this.progress += take;
      remaining -= take;
      if (this.offset === part.chars.length) { this.index++; this.offset = 0; this.skipEqual(); }
    }
    this.cachedView = null;
    return { ...this.view(), inserted, removed };
  }
  get done() { return this.progress >= this.total; }
  view() {
    if (this.cachedView) return this.cachedView;
    const chunks = [this.prefix], edits = [];
    let position = this.prefix.length, edit = null;
    for (let i = this.index; i < this.parts.length; i++) {
      const part = this.parts[i];
      if (part.type === 'equal') {
        edit = null;
      } else {
        // A replacement's adjacent remove/add parts share the same surviving
        // neighbors, even while its old characters are disappearing.
        if (!edit) { edit = { start: position, end: position, insertion: false }; edits.push(edit); }
        if (part.type === 'add' && (i !== this.index || this.offset === 0)) edit.insertion = true;
      }
      if (part.type !== 'add') {
        const visible = i === this.index ? part.chars.slice(this.offset).join('') : part.text;
        chunks.push(visible);
        position += visible.length;
        if (edit) edit.end = position;
      }
    }
    const text = chunks.join(''), upcoming = [];
    for (const edit of edits) {
      let { start, end } = edit;
      if (edit.insertion) {
        // Hints disappear when insertion starts. Never dim already-written
        // characters, and keep UTF-16 ranges on complete Unicode code points.
        if (start > 0 && !(start === this.prefix.length && this.added.at(-1)?.end === start)) {
          start -= start > 1 && text.codePointAt(start - 2) > 0xffff ? 2 : 1;
        }
        if (end < text.length) end += text.codePointAt(end) > 0xffff ? 2 : 1;
      }
      if (start === end) continue;
      const previous = upcoming.at(-1);
      if (previous && previous.end >= start) previous.end = Math.max(previous.end, end);
      else upcoming.push({ start, end });
    }
    return this.cachedView = { text, cursor: this.prefix.length, operation: this.parts[this.index]?.type ?? 'equal', upcoming };
  }
}
