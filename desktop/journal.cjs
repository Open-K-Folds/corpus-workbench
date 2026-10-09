'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const DRAFT = /^draft-[a-f0-9-]{36}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
function validateJournal(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('Correction journal size limit');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 20) throw new Error('Invalid correction journal');
  for (const [id, draft] of Object.entries(data)) {
    if (!DRAFT.test(id) || !draft || draft.id !== id || draft.schema !== 1 || Buffer.byteLength(JSON.stringify(draft), 'utf8') > 64 * 1024 || !HASH.test(draft.authority) || !HASH.test(draft.snapshot) || !HASH.test(draft.artifact) || !['actor', 'project', 'document', 'quote', 'before', 'prefix', 'suffix', 'replacement'].every(key => typeof draft[key] === 'string') || !['revision', 'config', 'start', 'end', 'updated'].every(key => integer(draft[key])) || draft.layer !== 'corrected' || typeof draft.backward !== 'boolean') throw new Error('Invalid retained correction');
    if (![draft.ids, draft.internalIds, draft.readings].every(values => Array.isArray(values) && values.length > 0 && values.length <= 256 && values.every(value => typeof value === 'string')) || draft.ids.length !== draft.internalIds.length || draft.ids.length !== draft.readings.length || new Set(draft.ids).size !== draft.ids.length) throw new Error('Invalid correction token binding');
    const first = Array.from(draft.readings[0]), last = Array.from(draft.readings.at(-1));
    if (draft.before !== draft.readings[0] || draft.start > first.length || draft.end > last.length || draft.ids.length === 1 && draft.start > draft.end || draft.prefix !== first.slice(0, draft.start).join('') || draft.suffix !== (draft.ids.length === 1 ? first.slice(draft.end).join('') : '') || draft.ids.length === 1 && draft.quote !== first.slice(draft.start, draft.end).join('')) throw new Error('Invalid correction character binding');
    const command = draft.command;
    if (command !== null) {
      const operation = command?.operations?.[0];
      if (!command || command.schema !== 1 || command.project !== draft.project || typeof command.command_id !== 'string' || !/^cmd-[a-f0-9-]{36}$/.test(command.command_id) || command.base_revision !== draft.revision || command.preimage_hash !== draft.snapshot || command.config_version !== draft.config || command.label !== `Correct ${draft.ids[0]} in place` || !Array.isArray(command.operations) || command.operations.length !== 1 || draft.ids.length !== 1 || operation?.kind !== 'set_token' || operation.document !== draft.document || operation.token !== draft.ids[0] || Object.keys(operation.fields ?? {}).length !== 1 || operation.fields.nform !== draft.prefix + draft.replacement + draft.suffix || !operation.fields.nform || /\s/u.test(operation.fields.nform)) throw new Error('Invalid original correction command');
    }
  }
  return data;
}
class Journal {
  constructor(profile) {this.directory = path.join(profile, 'drafts'); this.file = path.join(this.directory, 'correction-journal.json'); this.loaded = false; this.unavailable = false; this.pending = Promise.resolve();}
  async read() {
    try {const metadata = await fs.stat(this.file); if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new Error('Correction journal size limit'); const raw = await fs.readFile(this.file, 'utf8'); validateJournal(raw); this.loaded = true; return raw;}
    catch (error) {if (error.code === 'ENOENT') {this.loaded = true; return null;} this.unavailable = true; throw new Error(`The retained desktop correction journal could not be read and was preserved: ${error.message}`);}
  }
  write(raw) {
    validateJournal(raw);
    const task = this.pending.then(async () => {
      if (!this.loaded) await this.read();
      if (this.unavailable) throw new Error('The retained desktop correction journal is unavailable; existing records were preserved');
      await fs.mkdir(this.directory, {recursive: true});
      const temporary = path.join(this.directory, `correction-journal.${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fs.open(temporary, 'wx');
        await handle.writeFile(raw, 'utf8');
        await handle.sync();
        await handle.close(); handle = null;
        await fs.rename(temporary, this.file);
      } catch (error) {await handle?.close(); await fs.rm(temporary, {force: true}); throw error;}
      return true;
    });
    this.pending = task.catch(() => {});
    return task;
  }
}
module.exports = {Journal, validateJournal};
