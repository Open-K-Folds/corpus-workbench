'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
class Registry {
  constructor(root) { this.root = root; this.file = path.join(root, 'desktop-projects.json'); this.loadFailed = false; this.data = {schema: 1, recent: [], current: null, bounds: null}; }
  async load() {
    try {
      const text = await fs.readFile(this.file, 'utf8');
      if (text.length > 256 * 1024) throw new Error('Project registry size limit');
      const data = JSON.parse(text);
      if (data.schema !== 1 || !Array.isArray(data.recent) || data.recent.length > 20 || data.recent.some(entry => !entry || !/^[a-f0-9-]{36}$/.test(entry.id) || typeof entry.store !== 'string' || !path.isAbsolute(entry.store) || typeof entry.project !== 'string' || !entry.project || entry.project.length > 128 || typeof entry.title !== 'string')) throw new Error('The desktop project registry is invalid. It has been preserved for inspection.');
      this.data = data;
    } catch (error) { if (error.code !== 'ENOENT') {this.loadFailed = true; throw error;} }
    return this;
  }
  async save() {
    await fs.mkdir(this.root, {recursive: true});
    if (this.loadFailed) {
      // Preserve the exact damaged metadata before any close, open or import
      // creates a replacement registry. Corpus authorities are unaffected.
      this.invalidBackup = path.join(this.root, `desktop-projects.invalid-${randomUUID()}.json`);
      await fs.copyFile(this.file, this.invalidBackup, require('node:fs').constants.COPYFILE_EXCL);
      this.loadFailed = false;
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.data, null, 2), {flag: 'wx'});
    await fs.rename(temporary, this.file);
  }
  async remember(store, project, title) {
    const existing = this.data.recent.find(entry => entry.store.toLowerCase() === store.toLowerCase() && entry.project === project);
    const entry = {id: existing?.id ?? randomUUID(), store, project, title: title.slice(0, 160), opened: Date.now()};
    this.data.recent = [entry, ...this.data.recent.filter(other => other.id !== entry.id)].slice(0, 20);
    this.data.current = entry.id;
    await this.save(); return entry;
  }
  publicRecent() { return this.data.recent.map(({id, project, title, opened}) => ({id, project, title, opened})); }
  get(id) { return this.data.recent.find(entry => entry.id === id); }
}
module.exports = {Registry};
