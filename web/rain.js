const glyphs = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノ012345789'];
const completionPause = 1000;
const minimumFileDuration = 3000;
const trails = Array.from({ length: 16 }, (_, i) => Array.from({ length: 5 }, (_, j) => glyphs[(i * 7 + j * 11) % glyphs.length]).join('\n'));

// Animation time is independent of replay progress: writing the last character
// doesn't mean that the visible characters have finished landing.
export class RainTimeline {
  constructor(random = Math.random) {
    this.random = random;
    this.drops = new Map();
    this.burns = new Set();
    this.startedAt = null;
    this.replacementReadyAt = 0;
    this.advanceAt = null;
  }

  add(inserted, now, reducedMotion = false) {
    // Count typing even for deletions, whitespace, and reduced-motion replays.
    this.startedAt ??= now;
    if (reducedMotion) return;
    const characters = [];
    for (const insertion of inserted) {
      let offset = insertion.offset;
      for (const char of insertion.text) {
        if (!/\s/u.test(char)) characters.push({ offset, char });
        offset += char.length;
      }
    }
    // Shuffle positions, then distribute their departures across the batch.
    // They retain their source offsets; only the visual timing is randomized.
    for (let i = characters.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [characters[i], characters[j]] = [characters[j], characters[i]];
    }
    const spread = characters.length > 1 ? Math.min(900, 160 + characters.length * 18) : 0;
    const interval = spread / Math.max(1, characters.length - 1);
    const departure = Math.max(now, this.replacementReadyAt);
    characters.forEach(({ offset, char }, rank) => {
      const delay = rank * interval + (rank ? this.random() * interval * .6 : 0);
      this.drops.set(offset, {
        char, start: departure + delay, duration: 400 + this.random() * 340,
        height: 100 + this.random() * 150,
        trail: trails[Math.floor(this.random() * trails.length)],
      });
    });
  }

  remove(characters, now, reducedMotion = false) {
    if (reducedMotion) return;
    // Give replacements a short, bounded head start for the departing text.
    // Repeated batches use wall time, rather than accumulating queued delays.
    if (characters.length) this.replacementReadyAt = now + 320;
    for (const position of characters) {
      this.burns.add({
        char: position.char, position, start: now + this.random() * 100,
        duration: 1150 + this.random() * 450, height: 260 + this.random() * 140,
        drift: (this.random() < .5 ? -1 : 1) * (40 + this.random() * 60),
        trail: trails[Math.floor(this.random() * trails.length)],
      });
    }
  }

  markComplete(now) {
    // Repeated key presses must neither bypass nor extend the enjoyment pause.
    this.advanceAt ??= Math.max(
      Math.max(now, this.lastLanding()) + completionPause,
      this.minimumEnd(),
    );
  }

  minimumEnd() { return this.startedAt === null ? 0 : this.startedAt + minimumFileDuration; }

  lastLanding() {
    let latest = 0;
    for (const drop of this.drops.values()) latest = Math.max(latest, drop.start + drop.duration);
    for (const burn of this.burns) latest = Math.max(latest, burn.start + burn.duration);
    return latest;
  }

  state(now) {
    for (const [offset, drop] of this.drops) if (now >= drop.start + drop.duration) this.drops.delete(offset);
    for (const burn of this.burns) if (now >= burn.start + burn.duration) this.burns.delete(burn);
    return {
      pending: this.drops.size + this.burns.size,
      completing: this.advanceAt !== null,
      ready: this.advanceAt !== null && now >= this.advanceAt,
    };
  }

  nextWake(now) {
    const landing = this.lastLanding();
    if (landing > now) return landing;
    if (this.advanceAt !== null && this.advanceAt > now) return this.advanceAt;
    return null;
  }

  settle(now) {
    this.drops.clear();
    this.burns.clear();
    this.replacementReadyAt = 0;
    if (this.advanceAt !== null) this.advanceAt = Math.min(this.advanceAt, Math.max(now + completionPause, this.minimumEnd()));
  }

  clear() {
    this.drops.clear();
    this.burns.clear();
    this.replacementReadyAt = 0;
    this.startedAt = null;
    this.advanceAt = null;
  }
}
