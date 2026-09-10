'use strict';

/**
 * store.js — ชั้นการเข้าถึงข้อมูล (Data Access Layer) — SQLite (node:sqlite)
 * -------------------------------------------------------------
 * ตาราง: users, documents, contacts, counters,
 *         attachments (ไฟล์แนบ), doc_versions (ประวัติ),
 *         audit_log (บันทึกการทำงาน), notifications (แจ้งเตือน), shares (แชร์),
 *         kyc_documents (เอกสารยืนยันตัวตน), consents (บันทึกความยินยอม PDPA)
 * คงชื่อฟังก์ชันเดิม + เพิ่มฟังก์ชันใหม่ ส่วน API เรียกใช้ได้ทันที
 */

const _emit = process.emitWarning;
process.emitWarning = (w, ...a) => {
  const m = typeof w === 'string' ? w : w && w.message;
  if (m && m.includes('SQLite is an experimental')) return;
  return _emit.call(process, w, ...a);
};

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// รองรับ override ตำแหน่งโฟลเดอร์ข้อมูลผ่าน env var — ใช้สำหรับ test suite (node:test) เพื่อรันแบบแยก
// จากฐานข้อมูลจริงใน data/ โดยไม่ต้องแตะไฟล์ข้อมูลจริงของระบบเลย
const DATA_DIR = process.env.TAXFLOW_DATA_DIR ? path.resolve(process.env.TAXFLOW_DATA_DIR) : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'taxflow.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, type TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, docId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS doc_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, docId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, docId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, docId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS library (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, category TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, docId INTEGER, fromUserId INTEGER, toUserId INTEGER, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, purpose TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kyc_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, docType TEXT, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, data TEXT NOT NULL);
`);

const INDEXED = {
  users: ['email'],
  documents: ['userId', 'type'],
  contacts: ['userId'],
  attachments: ['userId', 'docId'],
  doc_versions: ['docId'],
  audit_log: ['userId', 'docId'],
  notifications: ['userId'],
  shares: ['token', 'docId'],
  library: ['userId', 'category'],
  signatures: ['userId'],
  requests: ['docId', 'fromUserId', 'toUserId'],
  otp_codes: ['userId', 'purpose'],
  kyc_documents: ['userId', 'docType'],
  consents: ['userId'],
};

// ข้อ: คอลัมน์ที่ระบุไว้ใน INDEXED ไม่เคยถูก CREATE INDEX จริง — all()/findOne() จึงสแกนทั้งตาราง
// แล้วกรองด้วย JavaScript ทุกครั้ง (เช่นทุกการ login ต้องโหลดผู้ใช้ทั้งตารางมาเทียบอีเมลทีละแถว)
// สร้างดัชนีจริงให้คอลัมน์เหล่านี้ เพื่อให้ where() ค้นหาผ่าน SQL ได้เร็วขึ้นตามขนาดข้อมูลที่โต
for (const [table, cols] of Object.entries(INDEXED)) {
  for (const col of cols) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_${col} ON ${table} (${col})`);
  }
}

function insert(table, record) {
  const cols = INDEXED[table] || [];
  const now = new Date().toISOString();
  const placeholders = cols.map(() => '?').concat("'{}'").join(', ');
  const info = db.prepare(`INSERT INTO ${table} (${[...cols, 'data'].join(', ')}) VALUES (${placeholders})`)
    .run(...cols.map((c) => record[c] ?? null));
  const id = Number(info.lastInsertRowid);
  const row = { id, createdAt: now, ...record };
  db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(row), id);
  return row;
}
function all(table, filterFn) {
  const rows = db.prepare(`SELECT data FROM ${table} ORDER BY id ASC`).all().map((r) => JSON.parse(r.data));
  return filterFn ? rows.filter(filterFn) : rows;
}
function find(table, id) {
  const r = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(Number(id));
  return r ? JSON.parse(r.data) : null;
}
function findOne(table, predicate) { return all(table).find(predicate) || null; }

/**
 * where(table, {col: val, ...}) — ค้นหาผ่านคอลัมน์ที่มีดัชนีจริงด้วย SQL WHERE
 * แทนการโหลดทั้งตารางมากรองด้วย JavaScript (ที่ all()/findOne() ทำ) ใช้กับ query
 * ที่เรียกบ่อยและกรองด้วยคอลัมน์ที่อยู่ใน INDEXED เท่านั้น (เช่น users.email ตอน login)
 * รับเฉพาะคอลัมน์ที่อยู่ใน whitelist ของตารางนั้น กัน SQL injection ผ่านชื่อคอลัมน์
 */
function where(table, criteria = {}) {
  const cols = INDEXED[table] || [];
  const keys = Object.keys(criteria).filter((k) => cols.includes(k));
  if (!keys.length) return all(table); // ไม่มีคอลัมน์ที่มีดัชนีให้ใช้ — fallback ปลอดภัยไปแบบเดิม
  const clause = keys.map((k) => `${k} = ?`).join(' AND ');
  const rows = db.prepare(`SELECT data FROM ${table} WHERE ${clause} ORDER BY id ASC`)
    .all(...keys.map((k) => criteria[k]))
    .map((r) => JSON.parse(r.data));
  return rows;
}
/** เหมือน where() แต่คืนแถวแรกที่พบ หรือ null */
function whereOne(table, criteria) { return where(table, criteria)[0] || null; }
function update(table, id, patch) {
  const current = find(table, id);
  if (!current) return null;
  const row = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const cols = INDEXED[table] || [];
  const setIndexed = cols.map((c) => `${c} = ?`).join(', ');
  const sql = `UPDATE ${table} SET data = ?${setIndexed ? ', ' + setIndexed : ''} WHERE id = ?`;
  db.prepare(sql).run(JSON.stringify(row), ...cols.map((c) => row[c] ?? null), Number(id));
  return row;
}
function remove(table, id) {
  return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(id)).changes > 0;
}
// นับเลขที่เอกสารแยกตาม "เลขนำหน้าที่พิมพ์บนเอกสารจริง" (prefix) + ปี ไม่ใช่แยกตาม type ภายใน
// เพราะ EWHT และ WHT ใช้ prefix "WHT" เหมือนกัน ถ้านับแยกตาม type จะได้เลขที่ซ้ำกัน (เช่น WHT-2569-00001 สองฉบับ)
// และรีเซ็ตตามปีเพราะเลขมีปีกำกับอยู่แล้ว
function nextDocNumber(userId, prefix, year) {
  const key = `${userId}_${prefix}_${year}`;
  db.prepare(`INSERT INTO counters (key, value) VALUES (?, 1)
    ON CONFLICT(key) DO UPDATE SET value = value + 1`).run(key);
  return db.prepare(`SELECT value FROM counters WHERE key = ?`).get(key).value;
}
function count(table, filterFn) {
  if (!filterFn) return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return all(table, filterFn).length;
}
function ensureReady() { return true; }

/**
 * transaction(fn) — ครอบหลายขั้นตอนที่ต้องสำเร็จ "ทั้งหมดหรือไม่เลย" ด้วย BEGIN/COMMIT/ROLLBACK
 * เช่น การลบบัญชี (ลบหลายตารางพร้อมกัน) ถ้าขั้นตอนกลางทางล้มเหลว ไม่ควรเหลือข้อมูลค้างครึ่งๆ กลางๆ
 */
async function transaction(fn) {
  // ต้อง await fn() เสมอ (แม้ store.js เองจะ sync ล้วน) เพราะตอนนี้ทุกฟังก์ชันของ store ถูกเรียกแบบ
  // `await store.xxx(...)` ทั่วทั้งแอป — ถ้า fn เป็น async function แล้วไม่ await ตรงนี้ COMMIT จะรันก่อน
  // ที่งานข้างในจะเสร็จจริง (เพราะ fn() คืน Promise ทันทีโดยยังไม่ได้รันจนจบ)
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  insert, all, find, findOne, where, whereOne, update, remove,
  nextDocNumber, count, ensureReady, transaction,
  DB_FILE, UPLOAD_DIR,
};
