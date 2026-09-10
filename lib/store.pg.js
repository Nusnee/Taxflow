'use strict';

/**
 * store.pg.js — ชั้นการเข้าถึงข้อมูล (Data Access Layer) — PostgreSQL
 * -------------------------------------------------------------
 * ทางเลือกของ lib/store.js (SQLite) สำหรับผู้ที่ต้องการต่อฐานข้อมูลจริงแบบ
 * client/server แทนไฟล์ SQLite เดี่ยว ๆ — ดูขั้นตอนติดตั้ง PostgreSQL และตั้งค่า
 * ให้ระบบใช้ไฟล์นี้แทนใน README.md หัวข้อ "ต่อฐานข้อมูล PostgreSQL"
 *
 * ออกแบบด้วยแนวคิดเดียวกับ store.js ทุกประการ (แถวหนึ่งเก็บข้อมูลทั้งก้อนเป็น JSON/JSONB
 * คอลัมน์ที่ query บ่อยแยกออกมาต่างหากพร้อมดัชนีจริง) และ "ชื่อฟังก์ชัน/รูปแบบพารามิเตอร์"
 * ตรงกับ store.js ทุกตัว เพื่อให้ย้ายไปมาระหว่างสองไฟล์นี้ทำได้ง่ายที่สุด
 *
 * ⚠️ ข้อแตกต่างสำคัญที่ต้องรู้ก่อนสลับมาใช้ไฟล์นี้:
 *   node:sqlite (store.js) เป็น synchronous ล้วน (เรียกแล้วได้ผลลัพธ์ทันที ไม่ต้อง await)
 *   ส่วน PostgreSQL ผ่าน driver `pg` เป็น asynchronous เสมอ (ทุกฟังก์ชันในไฟล์นี้คืนค่าเป็น
 *   Promise) โค้ดฝั่ง server.js/lib/*.js ปัจจุบันเรียก store.* แบบ synchronous ทุกจุด
 *   การสลับมาใช้ไฟล์นี้จึงไม่ใช่แค่เปลี่ยน require เฉย ๆ — ทุกจุดที่เรียก store.xxx(...)
 *   ต้องเปลี่ยนเป็น await store.xxx(...) และ handler ที่ยังไม่ใช่ async ต้องเติม async ด้วย
 *   (README มีตัวอย่างรูปแบบการแก้ไว้ให้) ไฟล์นี้ทดสอบและใช้งานได้ครบถ้วนในตัวเอง
 *   (เช่น เขียน script/test เรียกตรง ๆ ได้ทันที) แต่การเปลี่ยนทั้งระบบให้เป็น async
 *   ทั้งหมดเป็นงานแยกต่างหากที่ควรทำอย่างระมัดระวังทีละ endpoint
 */

const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
let Pool;
try {
  ({ Pool } = require('pg'));
} catch {
  throw new Error(
    "ไม่พบแพ็กเกจ 'pg' — ติดตั้งก่อนด้วย `npm install pg` แล้วค่อยเรียกใช้ lib/store.pg.js " +
    '(ดูขั้นตอนเต็มใน README.md หัวข้อ "ต่อฐานข้อมูล PostgreSQL")'
  );
}

const DATA_DIR = process.env.TAXFLOW_DATA_DIR
  ? path.resolve(process.env.TAXFLOW_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // ไฟล์แนบยังเก็บบนดิสก์เหมือนเดิม ไม่ได้ย้ายลง DB

if (!process.env.DATABASE_URL) {
  throw new Error(
    'ไม่พบ DATABASE_URL — ตั้งค่า environment variable นี้เป็น connection string ของ PostgreSQL ก่อน ' +
    'เช่น DATABASE_URL=postgres://taxflow:password@localhost:5432/taxflow ' +
    '(ดูขั้นตอนเต็มใน README.md หัวข้อ "ต่อฐานข้อมูล PostgreSQL")'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

// รองรับการรันหลายคำสั่งภายใน transaction เดียวกันโดยไม่ต้องส่ง client ผ่านทุกฟังก์ชัน —
// ฟังก์ชันทั้งหมดด้านล่างเรียก getClient() แทนการใช้ pool ตรง ๆ ถ้าอยู่ใน transaction()
// จะได้ client ตัวเดียวกันเสมอ (ผ่าน AsyncLocalStorage) มิฉะนั้น fallback ไปใช้ pool ปกติ
const als = new AsyncLocalStorage();
function getClient() { return als.getStore() || pool; }

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

// ชื่อคอลัมน์แบบ camelCase ต้องอยู่ในเครื่องหมายคำพูดคู่ใน PostgreSQL (ปกติจะ lower-case ให้เอง)
const q = (col) => `"${col}"`;

async function ensureReady() {
  // เพียงตรวจว่าต่อฐานข้อมูลได้จริง — โครงสร้างตารางให้รันจาก sql/postgres-schema.sql ล่วงหน้า
  // (ไม่สร้างตารางอัตโนมัติจากโค้ด เพราะการเปลี่ยนโครงสร้างฐานข้อมูลจริงควรผ่าน migration script
  // ที่ตรวจสอบได้ ไม่ใช่ CREATE TABLE IF NOT EXISTS ซ่อนอยู่ในโค้ดแอปพลิเคชัน)
  await getClient().query('SELECT 1');
  return true;
}

async function insert(table, record) {
  const cols = INDEXED[table] || [];
  const colNames = cols.map(q);
  const placeholders = cols.map((_, i) => `$${i + 1}`).concat(`$${cols.length + 1}`);
  const values = [...cols.map((c) => record[c] ?? null), '{}'];
  const { rows } = await getClient().query(
    `INSERT INTO ${table} (${[...colNames, 'data'].join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, "createdAt"`
      .replace('"createdAt"', 'now() AS "createdAt"'), // now() ใช้เป็นเวลาสร้างจริงของฝั่งฐานข้อมูล
    values
  );
  const id = Number(rows[0].id);
  const createdAt = rows[0].createdAt.toISOString();
  const row = { id, createdAt, ...record };
  await getClient().query(`UPDATE ${table} SET data = $1 WHERE id = $2`, [JSON.stringify(row), id]);
  return row;
}

async function all(table, filterFn) {
  const { rows } = await getClient().query(`SELECT data FROM ${table} ORDER BY id ASC`);
  const parsed = rows.map((r) => r.data); // node-postgres คืน JSONB เป็น object ที่ parse ให้แล้ว
  return filterFn ? parsed.filter(filterFn) : parsed;
}

async function find(table, id) {
  const { rows } = await getClient().query(`SELECT data FROM ${table} WHERE id = $1`, [Number(id)]);
  return rows[0] ? rows[0].data : null;
}

async function findOne(table, predicate) {
  const rows = await all(table);
  return rows.find(predicate) || null;
}

/** เหมือน store.js: where(table, {col: val}) ค้นหาผ่านคอลัมน์ที่มีดัชนีจริงด้วย SQL WHERE */
async function where(table, criteria = {}) {
  const cols = INDEXED[table] || [];
  const keys = Object.keys(criteria).filter((k) => cols.includes(k));
  if (!keys.length) return all(table);
  const clause = keys.map((k, i) => `${q(k)} = $${i + 1}`).join(' AND ');
  const { rows } = await getClient().query(
    `SELECT data FROM ${table} WHERE ${clause} ORDER BY id ASC`,
    keys.map((k) => criteria[k])
  );
  return rows.map((r) => r.data);
}
async function whereOne(table, criteria) {
  const rows = await where(table, criteria);
  return rows[0] || null;
}

async function update(table, id, patch) {
  const current = await find(table, id);
  if (!current) return null;
  const row = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const cols = INDEXED[table] || [];
  const setIndexed = cols.map((c, i) => `${q(c)} = $${i + 3}`).join(', ');
  const sql = `UPDATE ${table} SET data = $1${setIndexed ? ', ' + setIndexed : ''} WHERE id = $2`;
  await getClient().query(sql, [JSON.stringify(row), Number(id), ...cols.map((c) => row[c] ?? null)]);
  return row;
}

async function remove(table, id) {
  const { rowCount } = await getClient().query(`DELETE FROM ${table} WHERE id = $1`, [Number(id)]);
  return rowCount > 0;
}

// นับเลขที่เอกสารแยกตาม prefix + ปี (ดู lib/store.js สำหรับเหตุผลเดียวกัน — กัน EWHT/WHT ชนกัน + รีเซ็ตตามปี)
async function nextDocNumber(userId, prefix, year) {
  const key = `${userId}_${prefix}_${year}`;
  const { rows } = await getClient().query(
    `INSERT INTO counters (key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [key]
  );
  return Number(rows[0].value);
}

async function count(table, filterFn) {
  if (!filterFn) {
    const { rows } = await getClient().query(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(rows[0].n);
  }
  const rows = await all(table, filterFn);
  return rows.length;
}

/**
 * transaction(fn) — เหมือน store.js: ครอบหลายขั้นตอนที่ต้องสำเร็จทั้งหมดหรือไม่เลย
 * fn ต้องเป็น async function (หรือคืน Promise) รับ client เดียวกันตลอดผ่าน AsyncLocalStorage
 * ทำให้ insert/update/remove/... ที่เรียกอยู่ภายใน fn วิ่งอยู่ใน transaction เดียวกันโดยอัตโนมัติ
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await als.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function close() { await pool.end(); }

module.exports = {
  insert, all, find, findOne, where, whereOne, update, remove,
  nextDocNumber, count, ensureReady, transaction, close,
  DB_FILE: null, UPLOAD_DIR,
};
