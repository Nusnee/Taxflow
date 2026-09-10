'use strict';

/**
 * filestore.js — จัดเก็บไฟล์เอกสารยืนยันตัวตนแบบ "เข้ารหัสขณะพัก" (Encryption at Rest)
 * -------------------------------------------------------------
 * ทำไมต้องเข้ารหัส:
 *   เอกสารยืนยันตัวตน (หนังสือรับรองนิติบุคคล, ภ.พ.20, หน้าสมุดบัญชีธนาคาร)
 *   เป็นข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 มาตรา 37(1)
 *   ซึ่งกำหนดให้ผู้ควบคุมข้อมูลต้อง "จัดให้มีมาตรการรักษาความมั่นคงปลอดภัยที่เหมาะสม"
 *   ถ้าเก็บเป็นไฟล์เปล่า ใครเข้าถึงเครื่องเซิร์ฟเวอร์ได้ก็เปิดดูได้ทันที
 *
 * วิธีการ: AES-256-GCM (ให้ทั้งความลับและการตรวจจับการแก้ไขไฟล์)
 *   รูปแบบไฟล์ที่เขียนลงดิสก์ =  [IV 12 ไบต์][AuthTag 16 ไบต์][ciphertext]
 *
 * ใช้ crypto ของ Node.js ล้วน ไม่มี dependency ภายนอก
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IV_LEN = 12;
const TAG_LEN = 16;

// คีย์หลัก: ตั้งผ่าน environment variable ได้ ถ้าไม่ตั้งจะสร้างไฟล์คีย์เก็บไว้ใน data/
const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'file.key');

function loadKey() {
  if (process.env.FILE_ENCRYPTION_KEY) {
    // รับเป็น hex 64 ตัวอักษร (32 ไบต์)
    const raw = String(process.env.FILE_ENCRYPTION_KEY).trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    // ถ้าไม่ใช่ hex ให้ derive จากข้อความที่ตั้งมา
    return crypto.createHash('sha256').update(raw).digest();
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  console.log('[filestore] สร้างคีย์เข้ารหัสไฟล์ใหม่ที่ data/file.key — อย่าลบไฟล์นี้ มิฉะนั้นจะเปิดเอกสารเดิมไม่ได้');
  return key;
}

const KEY = loadKey();

/** เข้ารหัสข้อมูลใน Buffer */
function encrypt(buf) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

/** ถอดรหัสข้อมูลกลับเป็น Buffer เดิม — โยน error ถ้าไฟล์ถูกแก้ไข */
function decrypt(blob) {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/** บันทึกไฟล์แบบเข้ารหัส คืนชื่อไฟล์ที่เก็บจริงบนดิสก์ */
function writeEncrypted(dir, buf, ext) {
  const storedName = crypto.randomBytes(16).toString('hex') + '.' + (ext || 'bin') + '.enc';
  fs.writeFileSync(path.join(dir, storedName), encrypt(buf));
  return storedName;
}

/** อ่านไฟล์ที่เข้ารหัสไว้ คืน Buffer ต้นฉบับ */
function readEncrypted(dir, storedName) {
  return decrypt(fs.readFileSync(path.join(dir, storedName)));
}

/** ลบไฟล์ (ไม่โยน error ถ้าไม่พบ) */
function removeFile(dir, storedName) {
  try { fs.unlinkSync(path.join(dir, storedName)); return true; } catch { return false; }
}

module.exports = { encrypt, decrypt, writeEncrypted, readEncrypted, removeFile };
