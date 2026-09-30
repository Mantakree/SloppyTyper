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
    let suffix = '';
    for (let i = this.index; i < this.parts.length; i++) {
      const part = this.parts[i];
      if (part.type !== 'add') suffix += i === this.index ? part.chars.slice(this.offset).join('') : part.text;
    }
    return this.cachedView = { text: this.prefix + suffix, cursor: this.prefix.length, operation: this.parts[this.index]?.type ?? 'equal' };
  }
}
