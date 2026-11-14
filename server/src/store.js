// Small JSON-file data store (users, sessions, usage). Writes are atomic
// (temp file + rename) and serialised, which is plenty for one school's
// lecturers. Point DATA_DIR at a persistent disk/volume when hosting.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'db.json');
  let db = { users: [], sessions: [], usage: [] };
  if (fs.existsSync(file)) db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8')));

  let writing = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(db, null, 1);
    writing = writing.then(() => {
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, snapshot, { mode: 0o600 });
      fs.renameSync(tmp, file);
    }).catch(err => console.error('Could not save data:', err));
    return writing;
  }

  return { db, save, flush: () => writing };
}
