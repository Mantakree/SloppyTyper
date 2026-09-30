const glyphs = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノ012345789'];
const completionPause = 1000;
const minimumFileDuration = 3000;

// Animation time is independent of replay progress: writing the last character
// doesn't mean that the visible characters have finished landing.
export class RainTimeline {
  constructor(random = Math.random) {
    this.random = random;
    this.drops = new Map();
    this.startedAt = null;
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
    characters.forEach(({ offset, char }, rank) => {
      const delay = rank * interval + (rank ? this.random() * interval * .6 : 0);
      this.drops.set(offset, {
        char, start: now + delay, duration: 400 + this.random() * 340,
        height: 100 + this.random() * 150,
        trail: Array.from({ length: 3 + Math.floor(this.random() * 5) }, () => glyphs[Math.floor(this.random() * glyphs.length)]).join('\n'),
      });
    });
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
    return latest;
  }

  state(now) {
    for (const [offset, drop] of this.drops) if (now >= drop.start + drop.duration) this.drops.delete(offset);
    return {
      pending: this.drops.size,
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
    if (this.advanceAt !== null) this.advanceAt = Math.min(this.advanceAt, Math.max(now + completionPause, this.minimumEnd()));
  }

  clear() {
    this.drops.clear();
    this.startedAt = null;
    this.advanceAt = null;
  }
}
