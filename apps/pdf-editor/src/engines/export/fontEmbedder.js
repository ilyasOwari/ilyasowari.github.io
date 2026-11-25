// Embeds bundled fallback fonts into a destination document (subset).
import { loadBytes } from '../../core/assets.js';

export class FontEmbedder {
  constructor(doc) { this.doc = doc; this.map = new Map(); this.n = 0; }
  async get(file) {
    if (this.map.has(file)) return this.map.get(file);
    const p = (async () => {
      const bytes = await loadBytes(`assets/fonts/${file}`);
      const font = await this.doc.embedFont(bytes, { subset: true });
      return { font, name: `PFB${++this.n}` };
    })();
    this.map.set(file, p);
    return p;
  }
}
