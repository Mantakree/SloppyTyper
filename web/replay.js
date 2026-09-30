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
    while (remaining > 0 && !this.done) {
      const part = this.parts[this.index];
      if (!part) { this.progress = this.total; break; } // Empty file creation/deletion.
      const take = Math.min(remaining, part.chars.length - this.offset);
      if (part.type === 'add') this.prefix += part.chars.slice(this.offset, this.offset + take).join('');
      this.offset += take;
      this.progress += take;
      remaining -= take;
      if (this.offset === part.chars.length) { this.index++; this.offset = 0; this.skipEqual(); }
    }
    return this.view();
  }
  get done() { return this.progress >= this.total; }
  view() {
    let suffix = '';
    for (let i = this.index; i < this.parts.length; i++) {
      const part = this.parts[i];
      if (part.type !== 'add') suffix += i === this.index ? part.chars.slice(this.offset).join('') : part.text;
    }
    return { text: this.prefix + suffix, cursor: this.prefix.length, operation: this.parts[this.index]?.type ?? 'equal' };
  }
}
