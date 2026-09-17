'use strict';
// 데이터 파일 저장/백업 (문서\출석부\data.json)
const fs = require('fs');
const path = require('path');
const { migrate, newDataFile } = require('../core/model');

const DATA_FILE = 'data.json';
const BACKUP_DIR = 'backups';
const KEEP_BACKUPS = 30;

class Store {
  constructor({ configPath, defaultDataDir }) {
    this.configPath = configPath;
    this.defaultDataDir = defaultDataDir;
    this.config = this.readConfig();
    this.data = null;
    this.lastBackupAt = null;
  }

  readConfig() {
    try { return JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch { return {}; }
  }

  writeConfig() {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  get dataDir() { return this.config.dataDir || this.defaultDataDir; }
  get dataFile() { return path.join(this.dataDir, DATA_FILE); }
  get backupDir() { return path.join(this.dataDir, BACKUP_DIR); }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.dataFile)) {
      const raw = fs.readFileSync(this.dataFile, 'utf8');
      try {
        this.data = migrate(JSON.parse(raw));
      } catch (e) {
        // 손상된 파일은 보존해 두고 새로 시작
        const broken = path.join(this.dataDir, `data.broken-${stamp()}.json`);
        fs.copyFileSync(this.dataFile, broken);
        this.data = newDataFile();
        this.loadError = `데이터 파일을 읽지 못해 새로 시작합니다. 원본은 ${broken} 에 보관했습니다. (${e.message})`;
      }
    } else {
      this.data = newDataFile();
    }
    return this.data;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
    fs.renameSync(tmp, this.dataFile);
  }

  // 하루 한 번 자동 백업 + 필요 시 즉시 백업
  backup(label = '') {
    if (!fs.existsSync(this.dataFile)) return null;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const name = label ? `data-${stamp()}-${label}.json` : `data-${stamp()}.json`;
    const dest = path.join(this.backupDir, name);
    fs.copyFileSync(this.dataFile, dest);
    this.lastBackupAt = new Date().toISOString();
    this.pruneBackups();
    return dest;
  }

  dailyBackupIfNeeded() {
    if (!fs.existsSync(this.dataFile)) return null;
    const today = new Date().toISOString().slice(0, 10);
    const existing = this.listBackups().find((b) => b.name.startsWith(`data-${today}`));
    if (existing) { this.lastBackupAt = existing.mtime; return null; }
    return this.backup();
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { const st = fs.statSync(path.join(this.backupDir, f)); return { name: f, path: path.join(this.backupDir, f), size: st.size, mtime: st.mtime.toISOString() }; })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  pruneBackups() {
    const list = this.listBackups().filter((b) => /^data-\d{4}-\d{2}-\d{2}(T\d{6})?\.json$/.test(b.name));
    for (const b of list.slice(KEEP_BACKUPS)) { try { fs.unlinkSync(b.path); } catch { /* ignore */ } }
  }

  restore(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = migrate(JSON.parse(raw));
    this.backup('before-restore');
    this.data = parsed;
    this.save();
    return this.data;
  }

  setDataDir(dir) {
    const from = this.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, DATA_FILE);
    if (!fs.existsSync(target) && fs.existsSync(this.dataFile)) {
      fs.copyFileSync(this.dataFile, target);
      // 백업 폴더도 함께 복사
      if (fs.existsSync(this.backupDir)) {
        fs.mkdirSync(path.join(dir, BACKUP_DIR), { recursive: true });
        for (const b of this.listBackups()) fs.copyFileSync(b.path, path.join(dir, BACKUP_DIR, b.name));
      }
    }
    this.config.dataDir = dir;
    this.writeConfig();
    this.load();
    return { from, to: dir };
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

module.exports = { Store, DATA_FILE, BACKUP_DIR };
