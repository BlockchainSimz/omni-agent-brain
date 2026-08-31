import fs from 'node:fs';
import path from 'node:path';

export class JsonPersistence {
  constructor(file = process.env.OMNI_BRAIN_DATA_FILE || '.data/brain.json') {
    this.file = path.resolve(file);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  load() {
    if (!fs.existsSync(this.file)) return null;
    const raw = fs.readFileSync(this.file, 'utf8');
    return JSON.parse(raw);
  }

  save(snapshot) {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}
