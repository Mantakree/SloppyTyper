// All moving glyphs share one canvas. Glow is baked into reusable sprites,
// rather than recalculated as hundreds of DOM shadows on every frame.
class Sprites {
  constructor(document, font, size, ratio) {
    Object.assign(this, { document, font, size, ratio });
    this.cache = new Map();
  }

  get(text, color, reverse = false) {
    const key = `${color}:${reverse}:${text}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const lines = text.split('\n'), trail = lines.length > 1;
    const canvas = this.document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = this.font;
    const padding = 8, step = this.size * 1.05;
    const width = Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2);
    const height = Math.ceil(lines.length * step + padding * 2);
    canvas.width = Math.ceil(width * this.ratio);
    canvas.height = Math.ceil(height * this.ratio);
    ctx.scale(this.ratio, this.ratio);
    ctx.font = this.font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    lines.forEach((line, i) => {
      ctx.globalAlpha = trail ? .12 + .55 * (reverse ? lines.length - i : i + 1) / lines.length : 1;
      ctx.fillText(line, padding, padding + i * step);
    });
    const sprite = { canvas, width, height, padding, length: lines.length * step };
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, sprite);
    return sprite;
  }
}

export function particlePose(particle, now, burning = false) {
  const progress = Math.max(0, Math.min(1, (now - particle.start) / particle.duration));
  if (burning) return {
    x: particle.drift * progress * progress,
    y: -particle.height * progress ** 1.25,
    alpha: now < particle.start ? 1 : Math.max(0, 1 - progress ** 1.7),
    progress,
  };
  return { x: 0, y: -particle.height * (1 - progress * progress), alpha: Math.min(1, progress * 8), progress };
}

export class CodeEffects {
  constructor(canvas, viewport, source, timeline, invalidate) {
    Object.assign(this, { canvas, viewport, source, timeline });
    this.ctx = canvas.getContext('2d');
    this.frame = null;
    this.version = -1;
    this.observer = new ResizeObserver(() => { this.version = -1; invalidate(); });
    this.observer.observe(viewport);
    viewport.addEventListener('scroll', () => { this.wake(); });
  }

  sync(view) {
    if (!this.ctx) return;
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (width !== this.width || height !== this.height || ratio !== this.ratio) {
      Object.assign(this, { width, height, ratio });
      this.canvas.width = Math.ceil(width * ratio);
      this.canvas.height = Math.ceil(height * ratio);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(this.source);
      this.sprites = new Sprites(this.canvas.ownerDocument, `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, Number.parseFloat(style.fontSize), ratio);
      this.version = -1;
    }
    if (this.version !== view.layoutVersion) {
      for (const drop of this.timeline.drops.values()) drop.position = null;
      this.version = view.layoutVersion;
    }
    // Extending a word can wrap characters that were already falling. Refresh
    // those targets while retaining coordinates for all earlier source lines.
    for (const [offset, drop] of this.timeline.drops) if (offset >= view.reflowFrom) drop.position = null;
    const missing = [...this.timeline.drops].filter(([, drop]) => !drop.position).map(([offset, drop]) => ({ offset, char: drop.char }));
    if (missing.length) {
      const positions = view.positions(missing, this.viewport);
      for (const [offset, position] of positions) this.timeline.drops.get(offset).position = position;
    }
    // Draw in the same frame as the source update: no hidden-slot flash.
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.draw(performance.now());
  }

  wake() { if (this.frame === null) this.frame = requestAnimationFrame(now => { this.frame = null; this.draw(now); }); }

  clear() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.ctx?.clearRect(0, 0, this.width || 0, this.height || 0);
    this.version = -1;
  }

  stamp(sprite, x, y, alpha = 1) {
    if (alpha <= 0 || x < -60 || x > this.width + 60 || y < -sprite.height || y > this.height + sprite.height) return;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sprite.canvas, x - sprite.padding, y - sprite.padding, sprite.width, sprite.height);
  }

  draw(now) {
    if (!this.ctx || !this.sprites) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    const scroll = this.viewport.scrollTop;
    let moving = false;
    for (const drop of this.timeline.drops.values()) {
      moving ||= now < drop.start + drop.duration;
      if (!drop.position || now < drop.start) continue;
      const pose = particlePose(drop, now);
      const x = drop.position.x, y = drop.position.y - scroll + pose.y;
      if (y < -100 || y > this.height + 100) continue;
      const trail = this.sprites.get(drop.trail, '#64ff85');
      if (pose.progress < 1) this.stamp(trail, x, y - trail.length, (1 - pose.progress) * pose.alpha);
      this.stamp(this.sprites.get(drop.char, '#72ff93'), x, y, pose.alpha);
    }
    for (const burn of this.timeline.burns) {
      moving ||= now < burn.start + burn.duration;
      const pose = particlePose(burn, now, true);
      if (!pose.alpha) continue;
      const x = burn.position.x + pose.x, y = burn.position.y - scroll + pose.y;
      if (y < -100 || y > this.height + 100) continue;
      this.stamp(this.sprites.get(burn.trail, '#ff453d', true), x, y + this.sprites.size, pose.alpha * Math.min(1, pose.progress * 4));
      this.stamp(this.sprites.get(burn.char, pose.progress > .45 ? '#ff9951' : '#ff524b'), x, y, pose.alpha);
      if (pose.progress > .35) {
        const ember = this.sprites.get('·', '#ffbe68');
        this.stamp(ember, x + 12 * pose.progress, y + 18 * pose.progress, pose.alpha);
        this.stamp(ember, x - 9 * pose.progress, y + 30 * pose.progress, pose.alpha * .7);
      }
    }
    this.ctx.globalAlpha = 1;
    if (moving) this.wake();
  }
}
