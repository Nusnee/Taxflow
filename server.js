'use strict';
/**
 * server.js — เว็บเซิร์ฟเวอร์หลักของระบบ TaxFlow
 * Node.js core + node:sqlite — รันด้วย `node server.js`
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// เลือกชั้นเข้าถึงข้อมูล: ตั้ง DATABASE_URL ไว้ -> ใช้ PostgreSQL (lib/store.pg.js, async)
// ไม่ตั้ง -> ใช้ SQLite เดิม (lib/store.js) ทุกฟังก์ชันของ store ถูกเรียกผ่าน await เสมอ
// ทั่วทั้งไฟล์นี้ (await บนค่าที่ไม่ใช่ Promise ก็คืนค่าทันที) จึงทำงานถูกต้องกับทั้งสองแบบ
const store = process.env.DATABASE_URL ? require('./lib/store.pg') : require('./lib/store');
const tax = require('./lib/tax');
const auth = require('./lib/auth');
const docview = require('./lib/docview');
const qr = require('./lib/qr');
const exporter = require('./lib/export');
const otp = require('./lib/otp');
const mailer = require('./lib/mailer');
const profile = require('./lib/profile');
const pdpa = require('./lib/pdpa');
const thaiid = require('./lib/thaiid');
const filestore = require('./lib/filestore');
const { createRouter, readJsonBody, sendJson, sendHtml } = require('./lib/router');
const ratelimit = require('./lib/ratelimit');
const magicbytes = require('./lib/magicbytes');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// เรียก store.ensureReady() แบบ await จริงๆ ใน main() ด้านล่าง (ต่อ PostgreSQL ต้องรอผลก่อนเริ่มรับ request)

/* ---------- seed demo users ---------- */
const SEED_USERS = [
  {
    role: 'creator', email: 'creator@taxflow.test', password: '123456',
    displayName: 'นุสนีย์ มะแอเคียน', entityType: 'individual', taxId: '1100700123455',
    addr: { no: '99/1', street: 'รามคำแหง', subdistrict: 'หัวหมาก', district: 'บางกะปิ', province: 'กรุงเทพมหานคร', postcode: '10240' },
    phone: '081-234-5678', vatRegistered: false,
    bank: { bankName: 'ธนาคารไทยพาณิชย์', accountNo: '987-6-54321-0', accountName: 'นุสนีย์ มะแอเคียน' },
  },
  {
    role: 'corporate', email: 'brand@taxflow.test', password: '123456',
    displayName: 'บริษัท แบรนด์ดี จำกัด', entityType: 'juristic',
    companyName: 'บริษัท แบรนด์ดี จำกัด', companyType: 'บริษัทจำกัด', taxId: '0105561112235',
    branchType: 'head', authName: 'สมชาย ใจดี', authPosition: 'กรรมการผู้จัดการ',
    addr: { no: '55', street: 'สาทรใต้', subdistrict: 'ทุ่งมหาเมฆ', district: 'สาทร', province: 'กรุงเทพมหานคร', postcode: '10120' },
    phone: '02-111-2233', vatRegistered: true, vatRegDate: '2562-04-01',
    bank: { bankName: 'ธนาคารกสิกรไทย', accountNo: '012-3-45678-9', accountName: 'บริษัท แบรนด์ดี จำกัด' },
  },
  {
    role: 'agency', email: 'agency@taxflow.test', password: '123456',
    displayName: 'บริษัท มีเดีย เอเจนซี่ จำกัด', entityType: 'juristic',
    companyName: 'บริษัท มีเดีย เอเจนซี่ จำกัด', companyType: 'บริษัทจำกัด', taxId: '0105550001232',
    branchType: 'head', authName: 'วิภาดา ทองแท้', authPosition: 'กรรมการผู้มีอำนาจ',
    addr: { no: '123', street: 'สุขุมวิท', subdistrict: 'คลองเตยเหนือ', district: 'วัฒนา', province: 'กรุงเทพมหานคร', postcode: '10110' },
    phone: '02-999-8877', vatRegistered: true, vatRegDate: '2560-01-15',
    bank: { bankName: 'ธนาคารกรุงไทย', accountNo: '222-3-44455-6', accountName: 'บริษัท มีเดีย เอเจนซี่ จำกัด' },
  },
  {
    role: 'admin', email: 'admin@taxflow.test', password: '123456',
    displayName: 'ผู้ดูแลระบบ TaxFlow', entityType: 'individual', taxId: '',
  },
];

// สมุดคู่ค้าตัวอย่าง (จะถูกผูกกับผู้ใช้ตาม email ตอน seed)
const SEED_CONTACTS = {
  'agency@taxflow.test': [
    { name: 'บริษัท แบรนด์ดี จำกัด', taxId: '0105561112235', kind: 'buyer', email: 'ap@branddee.co.th', phone: '02-111-2233', address: '55 ถ.สาทรใต้ กรุงเทพฯ', bank: 'กสิกรไทย 012-3-45678-9', note: 'ลูกค้าหลัก แคมเปญรายไตรมาส' },
    { name: 'นุสนีย์ มะแอเคียน', taxId: '1100700123455', kind: 'payee', email: 'nusnee@example.com', phone: '081-234-5678', address: '99/1 ถ.รามคำแหง กรุงเทพฯ', bank: 'ไทยพาณิชย์ 987-6-54321-0', note: 'อินฟลูสายอาหาร ค่าตัว 15,000/คลิป' },
    { name: 'วลัยลักษณ์ ศรีสวัสดิ์', taxId: '1100700654329', kind: 'payee', email: 'walailak@example.com', phone: '089-876-5432', address: 'เชียงใหม่', bank: 'กรุงเทพ 111-2-33344-5', note: 'อินฟลูสายท่องเที่ยว' },
  ],
  'brand@taxflow.test': [
    { name: 'บริษัท มีเดีย เอเจนซี่ จำกัด', taxId: '0105550001232', kind: 'payee', email: 'billing@mediaagency.co.th', phone: '02-999-8877', address: '123 ถ.สุขุมวิท กรุงเทพฯ', bank: 'กรุงไทย 222-3-44455-6', note: 'เอเจนซี่คู่สัญญาหลัก' },
  ],
  'creator@taxflow.test': [
    { name: 'บริษัท มีเดีย เอเจนซี่ จำกัด', taxId: '0105550001232', kind: 'payer', email: 'hr@mediaagency.co.th', phone: '02-999-8877', address: '123 ถ.สุขุมวิท กรุงเทพฯ', bank: '', note: 'ผู้ว่าจ้างประจำ จ่ายทุกสิ้นเดือน' },
  ],
};

async function seedUsers() {
  if (await store.count('users') > 0) return [];
  const created = [];
  for (const u of SEED_USERS) {
    const { password, ...rest } = u;
    const base = profile.defaults(u.role);
    const record = {
      ...base, ...rest,
      passwordHash: auth.hashPassword(password),
      emailVerified: true,
      verifyStatus: u.role === 'admin' ? 'verified' : 'verified',
      verifiedAt: new Date().toISOString(),
      addr: profile.normalizeAddress(u.addr || {}),
      consent: pdpa.makeConsentRecord(pdpa.PURPOSES.map((x) => x.key)),
    };
    record.address = profile.formatAddress(record.addr);
    const user = await store.insert('users', record);
    await store.insert('consents', {
      userId: user.id, version: pdpa.CONSENT_VERSION,
      purposes: pdpa.PURPOSES.map((x) => x.key), action: 'seed', at: new Date().toISOString(),
    });
    for (const c of (SEED_CONTACTS[u.email] || [])) {
      await store.insert('contacts', { userId: user.id, ...c });
    }
    created.push(u);
  }
  return created;
}

const publicUser = (u) => { if (!u) return null; const { passwordHash, ...r } = u; return r; };
// ปิดบางส่วนของอีเมลก่อนแสดงผลตอนขอ OTP เช่น na****@gmail.com
function maskEmail(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  if (i < 1) return s;
  const user = s.slice(0, i);
  const domain = s.slice(i);
  const keep = Math.min(2, user.length);
  return user.slice(0, keep) + '*'.repeat(Math.max(1, user.length - keep)) + domain;
}
async function currentUser(req) {
  const payload = auth.verifyToken(auth.parseCookies(req).tf_session);
  if (!payload) return null;
  const user = await store.find('users', payload.uid);
  if (!user) return null;
  // เพิกถอน session ได้ทันที: ถ้า tokenVersion ใน token ไม่ตรงกับปัจจุบัน (logout-all/ลบบัญชี)
  // หรือบัญชีถูกลบไปแล้ว ให้ถือว่า token นี้ใช้ไม่ได้อีกต่อไป แม้ยังไม่หมดอายุตามเวลาก็ตาม
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) return null;
  if (user.deleted) return null;
  return user;
}
// จำกัดจำนวนครั้งของ endpoint ที่เสี่ยงถูกยิงถล่ม (login/register/otp) — คืน true แล้วตอบ 429 ถ้าเกินโควตา
function rateLimited(res, key, limit, windowMs, message) {
  const r = ratelimit.hit(key, limit, windowMs);
  if (!r.allowed) {
    sendJson(res, 429, { error: message || `ทำรายการถี่เกินไป กรุณารออีกประมาณ ${r.retryAfterSec} วินาทีแล้วลองใหม่` });
    return true;
  }
  return false;
}

function requireAuth(handler) {
  return async (req, res) => {
    const user = await currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
    req.user = user;
    return handler(req, res);
  };
}

/* ---------- helpers: numbering, validation, audit, versions, notify ---------- */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// ข้อ: createdAt เป็นเวลา UTC เสมอ เอกสารที่สร้างช่วง 00:00–07:00 น. ตามเวลาไทย (Asia/Bangkok, UTC+7)
// จะถูกแสดง/กรองผิดเป็นวันก่อนหน้า จึงต้องคำนวณ "วันที่ออกเอกสาร" ตามเขตเวลาไทยแยกไว้ต่างหาก
const BKK_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' });
function bangkokDateStr(d = new Date()) { return BKK_DATE_FMT.format(d); } // คืนค่า YYYY-MM-DD ตามเวลาไทย
// รูปลายเซ็นต้องเป็น data URI รูปภาพที่แน่นอนเท่านั้น (กัน XSS ผ่าน src="...")
const SIGNATURE_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function isValidSignatureImage(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 700 * 1024 && SIGNATURE_IMAGE_RE.test(v);
}

// ข้อ 6: แฮชเนื้อหาเอกสาร ณ ตอนลงนาม — ใช้ตรวจว่าเนื้อหาเอกสารถูกแก้ไขหลังลงนามหรือไม่
// (ตัดฟิลด์ที่ไม่ใช่ "เนื้อหา" ออก เช่น สถานะ ลายเซ็น เวลาบันทึก เพื่อให้แฮชเปลี่ยนเฉพาะเมื่อเนื้อหาจริงเปลี่ยน)
const CONTENT_HASH_EXCLUDE = new Set([
  'id', 'userId', 'createdAt', 'updatedAt', 'status', 'statusNote',
  'signed', 'signature', 'counterpartySignature', 'cancelledAt', 'cancelReason', 'docNo',
]);
function contentHash(doc) {
  const obj = {};
  for (const k of Object.keys(doc).sort()) {
    if (CONTENT_HASH_EXCLUDE.has(k)) continue;
    obj[k] = doc[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
const PREFIX = { ETAX: 'TAX', EWHT: 'WHT', WHT: 'WHT', RECEIPT: 'RCP', INVOICE: 'INV', QUOTATION: 'QTN', PO: 'PO', DELIVERY: 'DLV', PAYMENT: 'PAY', CONTRACT_INF: 'CTR', CONTRACT_BRAND: 'CTB', POA: 'POA', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' };

async function makeDocNo(type, userId) {
  const prefix = PREFIX[type] || 'DOC';
  const year = new Date().getFullYear();
  const seq = await store.nextDocNumber(userId, prefix, year);
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// ข้อ 8: ล็อกอัตราภาษีไว้ที่ชุดค่าที่กฎหมายกำหนด ไม่รับอัตราจากผู้ใช้โดยตรง
const VAT_RATE_FIXED = 7;
const WHT_RATES = [1, 2, 3, 5, 10, 15];
function validWhtRate(rate, fallback = 3) {
  const r = Number(rate);
  return WHT_RATES.includes(r) ? r : fallback;
}
// ข้อ 8 / สเปกข้อ 9, 24: เลขผู้เสียภาษีของคู่ค้า ถ้ากรอกมาต้องผ่าน check digit (ไม่บังคับกรอก แต่กรอกแล้วต้องถูก)
function taxIdError(value, label) {
  const digits = thaiid.digitsOnly(value);
  if (!digits) return null;
  if (!thaiid.isValidTaxId(digits)) return `เลขประจำตัวผู้เสียภาษี${label ? 'ของ' + label : ''}ไม่ถูกต้อง กรุณาตรวจสอบเลข 13 หลักอีกครั้ง`;
  return null;
}
// ข้อ 8: จำนวน (qty) ต้องมากกว่า 0 และราคาต่อหน่วยห้ามติดลบ กันเอกสารยอดติดลบ/ผิดธรรมชาติ
function validLineItems(items) {
  return Array.isArray(items) ? items.filter((i) => i && (i.name || i.price)) : [];
}
function lineItemErrors(items) {
  const errs = [];
  if (items.some((i) => !i.name)) errs.push('มีรายการที่ไม่ได้ระบุชื่อ');
  if (items.some((i) => !(Number(i.qty) > 0))) errs.push('จำนวนของแต่ละรายการต้องมากกว่า 0');
  if (items.some((i) => !(Number(i.price) >= 0))) errs.push('ราคาต่อหน่วยของแต่ละรายการต้องไม่ติดลบ');
  return errs;
}

// ตรวจสอบความครบถ้วนของข้อมูลเอกสาร
function validateDocument(type, body) {
  const errors = [];
  if (type === 'ETAX') {
    if (!body.buyer) errors.push('กรุณาระบุชื่อผู้ซื้อ/ผู้ว่าจ้าง');
    const buyerTaxIdErr = taxIdError(body.buyerTaxId, 'ผู้ซื้อ');
    if (buyerTaxIdErr) errors.push(buyerTaxIdErr);
    const items = validLineItems(body.items);
    if (!items.length) errors.push('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ');
    errors.push(...lineItemErrors(items));
  } else {
    if (!body.amount || !(Number(body.amount) > 0)) errors.push('กรุณาระบุยอดเงินให้ถูกต้อง');
    if (type === 'EWHT') {
      if (!body.payee) errors.push('กรุณาระบุชื่อผู้รับเงิน');
      const payeeTaxIdErr = taxIdError(body.payeeTaxId, 'ผู้รับเงิน');
      if (payeeTaxIdErr) errors.push(payeeTaxIdErr);
    }
    if (type === 'WHT' && !body.payer) errors.push('กรุณาระบุชื่อผู้จ่ายเงิน');
  }
  return { ok: errors.length === 0, errors };
}

async function snapshotVersion(doc, actorName, note) {
  const existing = (await store.all('doc_versions', (v) => v.docId === doc.id)).length;
  await store.insert('doc_versions', {
    docId: doc.id, version: existing + 1, editor: actorName, note: note || '',
    snapshot: doc, at: new Date().toISOString(),
  });
}
async function logAudit(userId, docId, action, detail, actorName) {
  await store.insert('audit_log', { userId, docId: docId || null, action, detail: detail || '', actor: actorName || '', at: new Date().toISOString() });
}
async function notify(userId, type, message, docId, extra = {}) {
  await store.insert('notifications', { userId, kind: type, message, docId: docId || null, read: false, at: new Date().toISOString(), ...extra });
}

const STATUS_FLOW = {
  draft: ['approved', 'pending', 'cancelled'],
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['archived', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  cancelled: [],
  archived: [],
};
const STATUS_LABEL = { draft: 'แบบร่าง', pending: 'รอตรวจสอบ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก', archived: 'เก็บถาวร' };

const api = createRouter();

/* =========================================================
 *  META / AUTH
 * ========================================================= */
api.get('/api/health', (req, res) => sendJson(res, 200, { status: 'ok', time: new Date().toISOString() }));

/* ---------- ค่าคงที่สำหรับไฟล์โปรไฟล์/เอกสารยืนยันตัวตน ---------- */
const KYC_MIME = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const KYC_MAX = 5 * 1024 * 1024;
const IMG_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const IMG_MAX = 1 * 1024 * 1024;

function requireAdmin(handler) {
  return requireAuth(async (req, res) => {
    if (req.user.role !== 'admin') return sendJson(res, 403, { error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    return handler(req, res);
  });
}

/* =========================================================
 *  สมัครสมาชิก — เก็บข้อมูลตามบทบาท + ความยินยอม PDPA + ยืนยันอีเมลด้วย OTP
 *  บัญชีจะยังใช้งานไม่ได้จนกว่าจะยืนยันรหัส OTP ที่ส่งไปทางอีเมล
 * ========================================================= */
api.post('/api/auth/register', async (req, res) => {
  // ข้อ: ไม่มี rate limit ที่ register — จำกัดจำนวนบัญชีที่สมัครได้ต่อ IP ต่อชั่วโมง
  if (rateLimited(res, `register:${ratelimit.clientIp(req)}`, 8, 60 * 60 * 1000, 'สมัครสมาชิกถี่เกินไปจากเครือข่ายนี้ กรุณาลองใหม่ภายหลัง')) return;
  const b = await readJsonBody(req);
  const email = String(b.email || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  if (!b.password) return sendJson(res, 400, { error: 'กรุณากรอกรหัสผ่าน' });
  if (String(b.password).length < 8) return sendJson(res, 400, { error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  if (await store.whereOne('users', { email })) return sendJson(res, 409, { error: 'อีเมลนี้ถูกใช้แล้ว' });

  // ห้ามสมัครเป็นผู้ดูแลระบบผ่านหน้าลงทะเบียน
  const role = ['agency', 'corporate', 'creator'].includes(b.role) ? b.role : 'creator';

  // ความยินยอมตาม PDPA — ต้องยินยอมข้อที่จำเป็นก่อนจึงจะสร้างบัญชีได้
  const consentCheck = pdpa.validateConsent(b.consent);
  if (!consentCheck.ok) return sendJson(res, 400, { error: consentCheck.error });

  // ประกอบข้อมูลโปรไฟล์ตามบทบาท
  const draft = { ...profile.defaults(role), role, email };
  const { patch, errors } = profile.buildPatch(draft, b);
  if (errors.length) return sendJson(res, 400, { error: errors[0], errors });

  const name = patch.entityType === 'juristic' ? patch.companyName : patch.displayName;
  if (!name) return sendJson(res, 400, { error: patch.entityType === 'juristic' ? 'กรุณากรอกชื่อนิติบุคคล' : 'กรุณากรอกชื่อ-นามสกุล' });
  if (!patch.taxId) return sendJson(res, 400, { error: 'กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก' });
  if (await store.findOne('users', (u) => u.taxId && u.taxId === patch.taxId)) {
    return sendJson(res, 409, { error: 'เลขประจำตัวผู้เสียภาษีนี้ถูกใช้ลงทะเบียนแล้ว' });
  }

  const consentRecord = pdpa.makeConsentRecord(consentCheck.purposes);
  const user = await store.insert('users', {
    ...draft, ...patch,
    passwordHash: auth.hashPassword(b.password),
    emailVerified: false,
    consent: consentRecord,
  });
  await store.insert('consents', {
    userId: user.id, version: consentRecord.version, purposes: consentRecord.purposes,
    action: 'register', at: consentRecord.at,
  });

  const { id: otpId, code } = await otp.createOtp(user.id, 'register', null, 'email');
  const mailResult = await mailer.sendOtpEmail(user.email, { code, purpose: 'register', displayName: user.displayName });
  await logAudit(user.id, null, 'register', 'สร้างบัญชีใหม่ รอยืนยันอีเมล', user.displayName);

  sendJson(res, 201, {
    pendingVerification: true, otpId, emailMasked: maskEmail(user.email),
    ...(mailResult.dev ? { devCode: code } : {}),
  });
});

// ยืนยันอีเมลตอนสมัคร แล้วจึงเปิดใช้งานบัญชีและออก session
api.post('/api/auth/register/verify-otp', async (req, res) => {
  const b = await readJsonBody(req);
  const result = await otp.verify(b.otpId, b.code, { purpose: 'register' });
  if (!result.ok) return sendJson(res, 400, { error: result.error });
  const user = await store.find('users', result.otp.userId);
  if (!user) return sendJson(res, 404, { error: 'ไม่พบบัญชีผู้ใช้' });
  const updated = await store.update('users', user.id, { emailVerified: true, emailVerifiedAt: new Date().toISOString() });
  auth.setSessionCookie(res, auth.createToken({ uid: user.id, role: user.role, tv: user.tokenVersion || 0 }));
  await logAudit(user.id, null, 'verify-email', 'ยืนยันอีเมลสำเร็จ บัญชีพร้อมใช้งาน', user.displayName);
  sendJson(res, 200, { user: publicUser(updated) });
});

api.post('/api/auth/register/resend-otp', async (req, res) => {
  const b = await readJsonBody(req);
  const row = await store.find('otp_codes', b.otpId);
  if (!row || row.purpose !== 'register') return sendJson(res, 404, { error: 'ไม่พบรายการยืนยันอีเมลนี้ กรุณาสมัครใหม่อีกครั้ง' });
  const r = await otp.regenerate(b.otpId);
  if (!r) return sendJson(res, 400, { error: 'ไม่สามารถขอรหัสใหม่ได้ กรุณาสมัครใหม่อีกครั้ง' });
  if (r.exhausted) return sendJson(res, 429, { error: 'ขอรหัสใหม่ครบจำนวนครั้งที่กำหนดแล้ว กรุณาสมัครใหม่อีกครั้ง' });
  if (r.throttled) return sendJson(res, 429, { error: `กรุณารออีก ${r.waitSec} วินาทีก่อนขอรหัสใหม่` });
  const user = await store.find('users', row.userId);
  const mailResult = await mailer.sendOtpEmail(user.email, { code: r.code, purpose: 'register', displayName: user.displayName });
  sendJson(res, 200, { otpId: b.otpId, ...(mailResult.dev ? { devCode: r.code } : {}) });
});

/* ---------- เข้าสู่ระบบ (ขั้นที่ 1: ตรวจอีเมล/รหัสผ่าน แล้วส่ง OTP) ---------- */
api.post('/api/auth/login', async (req, res) => {
  const b = await readJsonBody(req);
  const email = String(b.email || '').trim().toLowerCase();
  // ข้อ: ไม่มี rate limit ที่ login — จำกัดทั้งต่อ IP (กัน brute-force กว้างๆ) และต่อ IP+อีเมล (กัน targeted)
  if (rateLimited(res, `login:ip:${ratelimit.clientIp(req)}`, 30, 10 * 60 * 1000)) return;
  if (email && rateLimited(res, `login:acct:${ratelimit.clientIp(req)}:${email}`, 8, 10 * 60 * 1000, 'ลองเข้าสู่ระบบผิดถี่เกินไป กรุณารอสักครู่แล้วลองใหม่')) return;
  const user = await store.whereOne('users', { email });
  if (!user || !auth.verifyPassword(b.password, user.passwordHash)) return sendJson(res, 401, { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });

  // บัญชีที่ยังไม่ได้ยืนยันอีเมล ให้กลับไปทำขั้นตอนยืนยันอีเมลให้เสร็จก่อน
  if (!user.emailVerified) {
    const { id: otpId, code } = await otp.createOtp(user.id, 'register', null, 'email');
    const mailResult = await mailer.sendOtpEmail(user.email, { code, purpose: 'register', displayName: user.displayName });
    return sendJson(res, 200, {
      pendingVerification: true, otpId, emailMasked: maskEmail(user.email),
      notice: 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล ระบบได้ส่งรหัสยืนยันไปให้ใหม่แล้ว',
      ...(mailResult.dev ? { devCode: code } : {}),
    });
  }

  const { id: otpId, code } = await otp.createOtp(user.id, 'login', null, 'email');
  const mailResult = await mailer.sendOtpEmail(user.email, { code, purpose: 'login', displayName: user.displayName });
  await logAudit(user.id, null, 'login-otp-sent', `ส่งรหัส OTP เข้าสู่ระบบไปที่ ${user.email}`, user.displayName);
  sendJson(res, 200, {
    otpRequired: true, otpId, emailMasked: maskEmail(user.email),
    ...(mailResult.dev ? { devCode: code } : {}),
  });
});

// ขั้นตอนที่ 2: ยืนยันรหัส OTP แล้วจึงออก session cookie จริง
api.post('/api/auth/login/verify-otp', async (req, res) => {
  const b = await readJsonBody(req);
  const result = await otp.verify(b.otpId, b.code, { purpose: 'login' });
  if (!result.ok) return sendJson(res, 400, { error: result.error });
  const user = await store.find('users', result.otp.userId);
  if (!user) return sendJson(res, 404, { error: 'ไม่พบบัญชีผู้ใช้' });
  auth.setSessionCookie(res, auth.createToken({ uid: user.id, role: user.role, tv: user.tokenVersion || 0 }));
  await logAudit(user.id, null, 'login', 'เข้าสู่ระบบสำเร็จ (ยืนยันด้วย OTP)', user.displayName);
  sendJson(res, 200, { user: publicUser(user) });
});

// ขอรหัส OTP เข้าสู่ระบบใหม่ (กด "ส่งรหัสอีกครั้ง")
api.post('/api/auth/login/resend-otp', async (req, res) => {
  const b = await readJsonBody(req);
  const row = await store.find('otp_codes', b.otpId);
  if (!row || row.purpose !== 'login') return sendJson(res, 404, { error: 'ไม่พบรายการ OTP นี้ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
  const r = await otp.regenerate(b.otpId);
  if (!r) return sendJson(res, 400, { error: 'ไม่สามารถขอรหัสใหม่ได้ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
  if (r.exhausted) return sendJson(res, 429, { error: 'ขอรหัสใหม่ครบจำนวนครั้งที่กำหนดแล้ว กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
  if (r.throttled) return sendJson(res, 429, { error: `กรุณารออีก ${r.waitSec} วินาทีก่อนขอรหัสใหม่` });
  const user = await store.find('users', row.userId);
  const mailResult = await mailer.sendOtpEmail(user.email, { code: r.code, purpose: 'login', displayName: user.displayName });
  sendJson(res, 200, { otpId: b.otpId, ...(mailResult.dev ? { devCode: r.code } : {}) });
});

api.post('/api/auth/logout', async (req, res) => { auth.clearSessionCookie(res); sendJson(res, 200, { ok: true }); });
// ออกจากระบบทุกอุปกรณ์ — เพิ่ม tokenVersion เพื่อเพิกถอน session เดิมทั้งหมดทันที (ไม่ใช่แค่ลบ cookie ฝั่งนี้)
api.post('/api/auth/logout-all', requireAuth(async (req, res) => {
  await store.update('users', req.user.id, { tokenVersion: (req.user.tokenVersion || 0) + 1 });
  auth.clearSessionCookie(res);
  await logAudit(req.user.id, null, 'logout-all', 'ออกจากระบบทุกอุปกรณ์ (เพิกถอน session เดิมทั้งหมด)', req.user.displayName);
  sendJson(res, 200, { ok: true });
}));
api.get('/api/auth/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return sendJson(res, 401, { error: 'ยังไม่ได้เข้าสู่ระบบ' });
  sendJson(res, 200, { user: publicUser(user), profile: profileMeta(user) });
});

/* =========================================================
 *  โปรไฟล์ตามบทบาท
 * ========================================================= */

// ข้อมูลประกอบสำหรับสร้างฟอร์ม (รายการจังหวัด ธนาคาร ประเภทนิติบุคคล ฯลฯ)
api.get('/api/meta/profile-options', (req, res) => sendJson(res, 200, {
  companyTypes: profile.COMPANY_TYPES,
  provinces: profile.PROVINCES,
  banks: profile.BANKS,
  kycTypes: profile.KYC_TYPES,
  roleLabels: profile.ROLE_LABEL,
  consentPurposes: pdpa.PURPOSES,
  consentVersion: pdpa.CONSENT_VERSION,
}));

function profileMeta(user) {
  const c = profile.completeness(user);
  return {
    completeness: c,
    isJuristic: profile.isJuristic(user),
    branchLabel: profile.branchLabel(user),
    requiredKyc: profile.requiredKyc(user),
    canIssueEtax: !!user.vatRegistered,
  };
}

api.put('/api/auth/profile', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  const { patch, errors } = profile.buildPatch(req.user, b);
  if (errors.length) return sendJson(res, 400, { error: errors[0], errors });

  // เลขประจำตัวผู้เสียภาษีต้องไม่ซ้ำกับบัญชีอื่น
  if (patch.taxId && await store.findOne('users', (u) => u.id !== req.user.id && u.taxId === patch.taxId)) {
    return sendJson(res, 409, { error: 'เลขประจำตัวผู้เสียภาษีนี้ถูกใช้โดยบัญชีอื่นแล้ว' });
  }

  // ข้อ: การเปลี่ยนเลขบัญชีธนาคารรับเงินเป็นช่องทางหลักของการโกงเปลี่ยนบัญชีรับเงิน
  // ต้องยืนยันด้วย OTP ก่อนบันทึกทุกครั้ง (เดิมแก้ได้ทันทีเหมือนข้อมูลอื่นๆ ในโปรไฟล์)
  const bankChanged = patch.bank && JSON.stringify(patch.bank) !== JSON.stringify(req.user.bank || {});
  if (bankChanged) {
    const check = await otp.verify(b.otpId, b.code, { userId: req.user.id, purpose: 'change-bank' });
    if (!check.ok) return sendJson(res, 400, { error: 'เปลี่ยนบัญชีธนาคารต้องยืนยันด้วยรหัส OTP ก่อน: ' + check.error, requireOtp: true });
  }

  // ถ้าแก้ข้อมูลสำคัญหลังผ่านการตรวจสอบแล้ว ต้องกลับไปรอตรวจสอบใหม่
  const critical = ['taxId', 'companyName', 'displayName', 'entityType', 'vatRegistered'];
  const changedCritical = critical.some((k) => JSON.stringify(patch[k]) !== undefined && patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(req.user[k]));
  const extra = {};
  if (changedCritical && req.user.verifyStatus === 'verified') {
    extra.verifyStatus = 'pending';
    extra.verifyNote = 'ข้อมูลสำคัญถูกแก้ไข ระบบส่งกลับไปตรวจสอบอีกครั้งโดยอัตโนมัติ';
  }

  const u = await store.update('users', req.user.id, { ...patch, ...extra });
  await logAudit(req.user.id, null, 'profile-update', bankChanged ? 'แก้ไขข้อมูลโปรไฟล์ (รวมถึงเปลี่ยนบัญชีธนาคาร — ยืนยันด้วย OTP แล้ว)' : 'แก้ไขข้อมูลโปรไฟล์', req.user.displayName);
  sendJson(res, 200, { user: publicUser(u), profile: profileMeta(u) });
}));

/* ---------- โลโก้และตราประทับสำหรับพิมพ์บนเอกสาร ---------- */
api.post('/api/auth/brand-image', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  const kind = b.kind === 'seal' ? 'seal' : 'logo';
  if (!b.dataBase64) return sendJson(res, 400, { error: 'ไม่พบไฟล์รูปภาพ' });
  if (!IMG_MIME[b.mime]) return sendJson(res, 415, { error: 'รองรับเฉพาะไฟล์ PNG, JPG, WEBP เท่านั้น' });
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length > IMG_MAX) return sendJson(res, 413, { error: 'ไฟล์รูปภาพต้องมีขนาดไม่เกิน 1 MB' });
  if (!magicbytes.matches(buf, b.mime)) return sendJson(res, 415, { error: 'ไฟล์ไม่ตรงกับชนิดที่แจ้ง กรุณาอัปโหลดไฟล์รูปภาพจริง' });

  const field = kind === 'seal' ? 'sealFile' : 'logoFile';
  const old = req.user[field];
  if (old && old.storedName) filestore.removeFile(store.UPLOAD_DIR, old.storedName);

  const storedName = 'brand_' + crypto.randomBytes(12).toString('hex') + '.' + IMG_MIME[b.mime];
  fs.writeFileSync(path.join(store.UPLOAD_DIR, storedName), buf);
  const meta = { storedName, mime: b.mime, size: buf.length, filename: String(b.filename || '').slice(0, 120), at: new Date().toISOString() };
  const u = await store.update('users', req.user.id, { [field]: meta });
  await logAudit(req.user.id, null, 'brand-image', kind === 'seal' ? 'อัปโหลดตราประทับบริษัท' : 'อัปโหลดโลโก้บริษัท', req.user.displayName);
  sendJson(res, 201, { user: publicUser(u), kind });
}));

api.delete('/api/auth/brand-image/:kind', requireAuth(async (req, res) => {
  const kind = req.params.kind === 'seal' ? 'seal' : 'logo';
  const field = kind === 'seal' ? 'sealFile' : 'logoFile';
  const cur = req.user[field];
  if (cur && cur.storedName) filestore.removeFile(store.UPLOAD_DIR, cur.storedName);
  const u = await store.update('users', req.user.id, { [field]: null });
  sendJson(res, 200, { user: publicUser(u) });
}));

api.get('/api/auth/brand-image/:kind', requireAuth(async (req, res) => {
  const kind = req.params.kind === 'seal' ? 'seal' : 'logo';
  const meta = req.user[kind === 'seal' ? 'sealFile' : 'logoFile'];
  if (!meta) return sendJson(res, 404, { error: 'ยังไม่ได้อัปโหลดรูปภาพนี้' });
  try {
    const buf = fs.readFileSync(path.join(store.UPLOAD_DIR, meta.storedName));
    res.writeHead(200, { 'Content-Type': meta.mime, 'Cache-Control': 'no-store', 'Content-Length': buf.length });
    res.end(buf);
  } catch { sendJson(res, 404, { error: 'ไม่พบไฟล์รูปภาพ' }); }
}));

/* =========================================================
 *  เอกสารยืนยันตัวตน (KYC) — จัดเก็บแบบเข้ารหัส
 *  ระบบไม่ขอสำเนาบัตรประชาชน เก็บเฉพาะเลข 13 หลักเท่านั้น
 * ========================================================= */
api.get('/api/kyc', requireAuth(async (req, res) => {
  const items = (await store.all('kyc_documents', (k) => k.userId === req.user.id))
    .map(({ storedName, ...rest }) => rest).reverse();
  const required = profile.requiredKyc(req.user).map((r) => ({
    ...r, ...profile.KYC_TYPES[r.type],
    uploaded: items.find((i) => i.docType === r.type) || null,
  }));
  sendJson(res, 200, {
    items, required,
    verifyStatus: req.user.verifyStatus || 'unverified',
    verifyNote: req.user.verifyNote || '',
    kycConsent: !!(req.user.consent && (req.user.consent.purposes || []).includes('kyc')),
  });
}));

api.post('/api/kyc', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  if (!profile.KYC_TYPES[b.docType]) return sendJson(res, 400, { error: 'ประเภทเอกสารไม่ถูกต้อง' });
  if (!(req.user.consent && (req.user.consent.purposes || []).includes('kyc'))) {
    return sendJson(res, 403, { error: 'กรุณาให้ความยินยอมการจัดเก็บเอกสารยืนยันตัวตนก่อน (ตั้งค่าได้ที่หน้าโปรไฟล์ หัวข้อความเป็นส่วนตัว)' });
  }
  if (!b.dataBase64) return sendJson(res, 400, { error: 'ไม่พบไฟล์' });
  if (!KYC_MIME[b.mime]) return sendJson(res, 415, { error: 'รองรับเฉพาะไฟล์ PDF, PNG, JPG, WEBP เท่านั้น' });
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (!buf.length) return sendJson(res, 400, { error: 'ไฟล์เสียหายหรือว่างเปล่า' });
  if (buf.length > KYC_MAX) return sendJson(res, 413, { error: 'ไฟล์มีขนาดเกิน 5 MB' });
  if (!magicbytes.matches(buf, b.mime)) return sendJson(res, 415, { error: 'ไฟล์ไม่ตรงกับชนิดที่แจ้ง กรุณาอัปโหลดไฟล์จริง' });

  // อัปโหลดซ้ำประเภทเดิม = แทนที่ของเดิม
  const old = await store.findOne('kyc_documents', (k) => k.userId === req.user.id && k.docType === b.docType);
  if (old) { filestore.removeFile(store.UPLOAD_DIR, old.storedName); await store.remove('kyc_documents', old.id); }

  const storedName = filestore.writeEncrypted(store.UPLOAD_DIR, buf, KYC_MIME[b.mime]);
  const row = await store.insert('kyc_documents', {
    userId: req.user.id, docType: b.docType,
    filename: String(b.filename || '').slice(0, 160), mime: b.mime, size: buf.length,
    storedName, status: 'pending', note: '',
  });
  await logAudit(req.user.id, null, 'kyc-upload', `อัปโหลด${profile.KYC_TYPES[b.docType].label} (จัดเก็บแบบเข้ารหัส)`, req.user.displayName);
  const { storedName: _sn, ...meta } = row;
  sendJson(res, 201, meta);
}));

api.get('/api/kyc/:id/file', requireAuth(async (req, res) => {
  const row = await store.find('kyc_documents', req.params.id);
  const isOwner = row && row.userId === req.user.id;
  const isReviewer = req.user.role === 'admin';
  if (!row || (!isOwner && !isReviewer)) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  try {
    const buf = filestore.readEncrypted(store.UPLOAD_DIR, row.storedName);
    // PDPA: บันทึกทุกครั้งที่มีการเปิดดูเอกสารยืนยันตัวตน โดยเฉพาะเมื่อผู้ตรวจสอบเป็นผู้เปิด
    await logAudit(row.userId, null, 'kyc-view',
      `เปิดดู${profile.KYC_TYPES[row.docType] ? profile.KYC_TYPES[row.docType].label : row.docType}` +
      (isReviewer && !isOwner ? ' โดยผู้ตรวจสอบ' : ' โดยเจ้าของบัญชี'), req.user.displayName);
    res.writeHead(200, { 'Content-Type': row.mime, 'Cache-Control': 'no-store', 'Content-Length': buf.length });
    res.end(buf);
  } catch {
    sendJson(res, 500, { error: 'เปิดไฟล์ไม่สำเร็จ ไฟล์อาจเสียหายหรือคีย์เข้ารหัสไม่ตรงกัน' });
  }
}));

api.delete('/api/kyc/:id', requireAuth(async (req, res) => {
  const row = await store.find('kyc_documents', req.params.id);
  if (!row || row.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  filestore.removeFile(store.UPLOAD_DIR, row.storedName);
  await store.remove('kyc_documents', row.id);
  await logAudit(req.user.id, null, 'kyc-delete', 'ลบเอกสารยืนยันตัวตน', req.user.displayName);
  sendJson(res, 200, { ok: true });
}));

// ส่งเอกสารให้ผู้ดูแลระบบตรวจสอบ
api.post('/api/kyc/submit', requireAuth(async (req, res) => {
  const required = profile.requiredKyc(req.user).filter((r) => r.required);
  const owned = await store.all('kyc_documents', (k) => k.userId === req.user.id);
  const missing = required.filter((r) => !owned.some((o) => o.docType === r.type))
    .map((r) => profile.KYC_TYPES[r.type].label);
  if (missing.length) return sendJson(res, 400, { error: 'ยังขาดเอกสาร: ' + missing.join(', ') });
  const c = profile.completeness(req.user);
  if (!c.ok) return sendJson(res, 400, { error: 'ข้อมูลโปรไฟล์ยังไม่ครบ — ขาด: ' + c.missing.join(', ') });

  const u = await store.update('users', req.user.id, { verifyStatus: 'pending', verifyNote: '', submittedAt: new Date().toISOString() });
  await logAudit(req.user.id, null, 'kyc-submit', 'ส่งเอกสารยืนยันตัวตนให้ผู้ดูแลระบบตรวจสอบ', req.user.displayName);
  for (const admin of await store.all('users', (x) => x.role === 'admin')) {
    await notify(admin.id, 'kyc', `มีคำขอยืนยันตัวตนใหม่จาก ${u.companyName || u.displayName}`, null);
  }
  sendJson(res, 200, { user: publicUser(u) });
}));

/* =========================================================
 *  ผู้ดูแลระบบ — ตรวจสอบและอนุมัติการยืนยันตัวตน
 * ========================================================= */
api.get('/api/admin/users', requireAdmin(async (req, res) => {
  const status = new URL(req.url, 'http://localhost').searchParams.get('status');
  let list = await store.all('users', (u) => u.role !== 'admin');
  if (status) list = list.filter((u) => (u.verifyStatus || 'unverified') === status);
  const items = (await Promise.all(list.map(async (u) => ({
    id: u.id, email: u.email, role: u.role, entityType: u.entityType,
    displayName: u.displayName, companyName: u.companyName,
    taxId: u.taxId, vatRegistered: !!u.vatRegistered,
    verifyStatus: u.verifyStatus || 'unverified', verifyNote: u.verifyNote || '',
    submittedAt: u.submittedAt || null, createdAt: u.createdAt,
    docCount: await store.count('kyc_documents', (k) => k.userId === u.id),
  })))).reverse();
  sendJson(res, 200, { items });
}));

api.get('/api/admin/users/:id', requireAdmin(async (req, res) => {
  const u = await store.find('users', req.params.id);
  if (!u || u.role === 'admin') return sendJson(res, 404, { error: 'ไม่พบผู้ใช้' });
  const docs = (await store.all('kyc_documents', (k) => k.userId === u.id)).map(({ storedName, ...r }) => r);
  sendJson(res, 200, {
    user: publicUser(u),
    profile: profileMeta(u),
    kycDocs: docs.map((d) => ({ ...d, label: (profile.KYC_TYPES[d.docType] || {}).label || d.docType })),
    addressText: profile.formatAddress(u.addr || {}),
    branchText: profile.branchLabel(u),
  });
}));

api.post('/api/admin/users/:id/verify', requireAdmin(async (req, res) => {
  const b = await readJsonBody(req);
  const u = await store.find('users', req.params.id);
  if (!u || u.role === 'admin') return sendJson(res, 404, { error: 'ไม่พบผู้ใช้' });
  // ข้อ: อนุมัติ/ไม่อนุมัติได้เฉพาะบัญชีที่ "ส่งเอกสารขอตรวจสอบแล้ว" (verifyStatus=pending) เท่านั้น
  // กันแอดมินกดอนุมัติบัญชีที่ยังไม่ได้ submit เอกสารเลย
  if (u.verifyStatus !== 'pending') {
    return sendJson(res, 400, { error: 'ผู้ใช้รายนี้ยังไม่ได้ส่งเอกสารขอตรวจสอบตัวตน จึงยังพิจารณาผลไม่ได้' });
  }
  const approve = !!b.approve;
  const note = String(b.note || '').slice(0, 500);
  if (!approve && !note) return sendJson(res, 400, { error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ เพื่อให้ผู้ใช้แก้ไขได้ถูกต้อง' });
  const updated = await store.update('users', u.id, {
    verifyStatus: approve ? 'verified' : 'rejected',
    verifyNote: note,
    verifiedAt: approve ? new Date().toISOString() : null,
    verifiedBy: req.user.displayName,
  });
  // ข้อ: สถานะรายเอกสารใน kyc_documents ค้างเป็น pending ตลอด ไม่เคยอัปเดตตามผลตรวจของแอดมิน
  for (const doc of await store.all('kyc_documents', (k) => k.userId === u.id)) {
    await store.update('kyc_documents', doc.id, { status: approve ? 'approved' : 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: req.user.displayName });
  }
  await logAudit(u.id, null, approve ? 'kyc-approve' : 'kyc-reject',
    approve ? 'ผู้ดูแลระบบอนุมัติการยืนยันตัวตน' : `ผู้ดูแลระบบไม่อนุมัติ: ${note}`, req.user.displayName);
  await notify(u.id, 'kyc', approve
    ? 'การยืนยันตัวตนของคุณได้รับการอนุมัติแล้ว'
    : `การยืนยันตัวตนไม่ผ่าน: ${note}`, null);
  sendJson(res, 200, { user: publicUser(updated) });
}));

/* =========================================================
 *  สิทธิของเจ้าของข้อมูลส่วนบุคคล (PDPA)
 * ========================================================= */

// แก้ไข/ถอนความยินยอมในข้อที่ไม่บังคับ
api.put('/api/pdpa/consent', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  const check = pdpa.validateConsent(b.consent);
  if (!check.ok) return sendJson(res, 400, { error: check.error });
  const record = pdpa.makeConsentRecord(check.purposes);
  const u = await store.update('users', req.user.id, { consent: record });
  await store.insert('consents', {
    userId: req.user.id, version: record.version, purposes: record.purposes,
    action: 'update', at: record.at,
  });
  await logAudit(req.user.id, null, 'consent-update', 'ปรับปรุงความยินยอมการใช้ข้อมูลส่วนบุคคล', req.user.displayName);
  sendJson(res, 200, { user: publicUser(u) });
}));

// สิทธิขอสำเนาข้อมูล (มาตรา 30) — ดาวน์โหลดเป็นไฟล์ JSON
api.get('/api/pdpa/my-data', requireAuth(async (req, res) => {
  const data = await pdpa.buildDataExport(store, req.user);
  const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  await logAudit(req.user.id, null, 'data-export', 'ขอสำเนาข้อมูลส่วนบุคคลของตนเอง', req.user.displayName);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="taxflow-my-data-${req.user.id}.json"`,
    'Content-Length': body.length,
  });
  res.end(body);
}));

// สิทธิขอลบข้อมูล (มาตรา 33) — ลบข้อมูลระบุตัวตน แต่คงเอกสารภาษีตามที่กฎหมายภาษีบังคับให้เก็บ
api.post('/api/pdpa/delete-account', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  if (!auth.verifyPassword(b.password || '', req.user.passwordHash)) {
    return sendJson(res, 401, { error: 'รหัสผ่านไม่ถูกต้อง' });
  }
  if (String(b.confirm || '').trim() !== 'ลบบัญชีของฉัน') {
    return sendJson(res, 400, { error: 'กรุณาพิมพ์ข้อความยืนยัน "ลบบัญชีของฉัน" ให้ถูกต้อง' });
  }
  const uid = req.user.id;
  const oldEmail = req.user.email;
  const oldName = req.user.displayName;
  const ANON_LABEL = 'ผู้ใช้ที่ลบบัญชีแล้ว';

  // ข้อ: การลบบัญชีแก้หลายตารางพร้อมกัน ถ้าล้มเหลวกลางทางไม่ควรเหลือข้อมูลค้างครึ่งๆ กลางๆ — ครอบด้วย transaction
  await store.transaction(async () => {
  // ลบไฟล์ทั้งหมดที่เป็นข้อมูลส่วนบุคคล
  for (const k of await store.all('kyc_documents', (x) => x.userId === uid)) {
    filestore.removeFile(store.UPLOAD_DIR, k.storedName);
    await store.remove('kyc_documents', k.id);
  }
  // ข้อ PDPA: การลบบัญชีเดิมตกหล่นคลังเอกสาร (library) และไฟล์แนบเอกสาร (attachments) — ต้องลบทั้งไฟล์และแถวด้วย
  for (const l of await store.all('library', (x) => x.userId === uid)) {
    filestore.removeFile(store.UPLOAD_DIR, l.storedName);
    await store.remove('library', l.id);
  }
  for (const a of await store.all('attachments', (x) => x.userId === uid)) {
    try { fs.unlinkSync(path.join(store.UPLOAD_DIR, a.storedName)); } catch {}
    await store.remove('attachments', a.id);
  }
  for (const f of ['logoFile', 'sealFile']) {
    if (req.user[f] && req.user[f].storedName) filestore.removeFile(store.UPLOAD_DIR, req.user[f].storedName);
  }
  for (const t of ['contacts', 'signatures', 'notifications', 'otp_codes']) {
    for (const row of await store.all(t, (x) => x.userId === uid)) await store.remove(t, row.id);
  }

  // ข้อ PDPA: doc_versions เป็น snapshot ของเอกสารภาษีที่ต้องเก็บไว้ตามกฎหมาย (5 ปี) จึงไม่ลบ
  // แต่ชื่อผู้แก้ไข (editor) ที่ฝังไว้ตรงๆ ต้องล้างไม่ให้ระบุตัวตนเจ้าของบัญชีที่ลบไปแล้ว
  const ownDocIds = new Set((await store.all('documents', (x) => x.userId === uid)).map((d) => d.id));
  for (const v of await store.all('doc_versions', (x) => ownDocIds.has(x.docId) && x.editor === oldName)) {
    await store.update('doc_versions', v.id, { editor: ANON_LABEL });
  }
  // audit_log ก็เก็บไว้เป็นร่องรอยตรวจสอบตามกฎหมาย แต่ต้องล้างชื่อ/อีเมลที่ระบุตัวตนออก
  // (เช่น ข้อความ "ส่งรหัส OTP ไปที่ xxx@example.com" ที่ฝังอีเมลไว้ตรงๆ ในข้อความ)
  for (const a of await store.all('audit_log')) {
    const isOwn = a.userId === uid && a.actor === oldName;
    const mentionsEmail = oldEmail && a.detail && a.detail.includes(oldEmail);
    if (!isOwn && !mentionsEmail) continue;
    await store.update('audit_log', a.id, {
      actor: isOwn ? ANON_LABEL : a.actor,
      detail: mentionsEmail ? a.detail.split(oldEmail).join('[อีเมลบัญชีที่ถูกลบ]') : a.detail,
    });
  }

  // ทำให้บัญชีไม่ระบุตัวตน แทนการลบทิ้งทั้งหมด เพราะเอกสารภาษีต้องเก็บ 5 ปี
  const anon = {
    ...profile.defaults(req.user.role),
    email: `deleted-${uid}@removed.local`,
    passwordHash: auth.hashPassword(crypto.randomBytes(24).toString('hex')),
    displayName: ANON_LABEL, companyName: '', taxId: '',
    deleted: true, deletedAt: new Date().toISOString(),
    tokenVersion: (req.user.tokenVersion || 0) + 1, // เพิกถอน session ที่ยังค้างอยู่ทุกอุปกรณ์ทันที
    consent: null, emailVerified: false, verifyStatus: 'unverified',
  };
  await store.update('users', uid, anon);
  await logAudit(uid, null, 'account-delete', 'ผู้ใช้ใช้สิทธิขอลบข้อมูลส่วนบุคคล — ลบข้อมูลระบุตัวตนแล้ว คงเหลือเฉพาะเอกสารภาษีที่กฎหมายบังคับให้เก็บ', 'ระบบ');
  }); // จบ store.transaction
  auth.clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}));

/* =========================================================
 *  OTP สำหรับขั้นตอนการลงลายมือชื่อดิจิทัล (ข้อกำหนด: ต้องยืนยันด้วย OTP ก่อนลงนามทุกครั้ง)
 * ========================================================= */
const OTP_SIGN_PURPOSES = {
  // ลงนามเอกสารของตัวเอง — ต้องเป็นเจ้าของเอกสาร
  'sign-doc': async (req, refId) => {
    const doc = await store.find('documents', refId);
    return (doc && doc.userId === req.user.id) ? doc : null;
  },
  // ลงนามตอบกลับคำขอจากคู่ค้า — ต้องเป็นผู้รับคำขอ และคำขอต้องยังรอตอบอยู่
  'sign-request': async (req, refId) => {
    const r = await store.find('requests', refId);
    return (r && r.toUserId === req.user.id && r.status === 'sent') ? r : null;
  },
  // เปลี่ยนเลขบัญชีธนาคารรับเงิน — ไม่มี refId เพราะยืนยันตัวผู้ใช้เองเท่านั้น
  'change-bank': (req) => req.user,
};

api.post('/api/otp/request', requireAuth(async (req, res) => {
  // ข้อ: ไม่มี rate limit ที่ /api/otp/request — ป้องกันการยิงส่งอีเมล OTP ถล่มผู้ใช้คนเดียวซ้ำๆ
  if (rateLimited(res, `otp-req:${req.user.id}`, 8, 10 * 60 * 1000, 'ขอรหัส OTP ถี่เกินไป กรุณารอสักครู่แล้วลองใหม่')) return;
  const b = await readJsonBody(req);
  const checker = OTP_SIGN_PURPOSES[b.purpose];
  if (!checker) return sendJson(res, 400, { error: 'ประเภทการยืนยันไม่ถูกต้อง' });
  const target = await checker(req, b.refId);
  if (!target) return sendJson(res, 404, { error: 'ไม่พบรายการที่ต้องการยืนยัน หรือคุณไม่มีสิทธิ์ทำรายการนี้' });
  const { id: otpId, code } = await otp.createOtp(req.user.id, b.purpose, b.refId);
  const mailResult = await mailer.sendOtpEmail(req.user.email, { code, purpose: b.purpose, displayName: req.user.displayName });
  sendJson(res, 200, { otpId, emailMasked: maskEmail(req.user.email), ...(mailResult.dev ? { devCode: code } : {}) });
}));

api.post('/api/otp/resend', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  const row = await store.find('otp_codes', b.otpId);
  if (!row || row.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบรายการ OTP นี้' });
  const r = await otp.regenerate(b.otpId);
  if (!r) return sendJson(res, 400, { error: 'ไม่สามารถขอรหัสใหม่ได้ กรุณาเริ่มรายการใหม่' });
  if (r.exhausted) return sendJson(res, 429, { error: 'ขอรหัสใหม่ครบจำนวนครั้งที่กำหนดแล้ว กรุณาเริ่มรายการใหม่' });
  if (r.throttled) return sendJson(res, 429, { error: `กรุณารออีก ${r.waitSec} วินาทีก่อนขอรหัสใหม่` });
  const mailResult = await mailer.sendOtpEmail(req.user.email, { code: r.code, purpose: row.purpose, displayName: req.user.displayName });
  sendJson(res, 200, { otpId: b.otpId, ...(mailResult.dev ? { devCode: r.code } : {}) });
}));

/* =========================================================
 *  TAX CALC
 * ========================================================= */
api.post('/api/wht/calc', async (req, res) => { const { amount, rate } = await readJsonBody(req); sendJson(res, 200, tax.calcWithholding(amount, rate)); });
api.post('/api/vat/calc', async (req, res) => { const { amount, rate } = await readJsonBody(req); sendJson(res, 200, tax.calcVat(amount, rate)); });
api.post('/api/pit/estimate', async (req, res) => { const b = await readJsonBody(req); sendJson(res, 200, tax.estimatePersonalIncomeTax(b.grossIncome, b)); });

/* =========================================================
 *  CONTACTS
 * ========================================================= */
api.get('/api/contacts', requireAuth(async (req, res) => sendJson(res, 200, { items: (await store.all('contacts', (c) => c.userId === req.user.id)).reverse() })));
api.post('/api/contacts', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  sendJson(res, 201, await store.insert('contacts', {
    userId: req.user.id, name: b.name || '', taxId: b.taxId || '', kind: b.kind || 'buyer',
    email: b.email || '', phone: b.phone || '', address: b.address || '', bank: b.bank || '', note: b.note || '',
  }));
}));
api.delete('/api/contacts/:id', requireAuth(async (req, res) => {
  const c = await store.find('contacts', req.params.id);
  if (!c || c.userId !== req.user.id) return sendJson(res, 404, { error: 'not found' });
  await store.remove('contacts', req.params.id); sendJson(res, 200, { deleted: true });
}));

/* =========================================================
 *  DOCUMENTS — create
 * ========================================================= */
async function createDoc(user, type, fields, extra) {
  // ข้อ: ออกเลขที่เอกสารตั้งแต่ตอน "แบบร่าง" ทำให้การลบ draft ทิ้งช่องว่างในลำดับเลข (ผิดหลักการออกเลขต่อเนื่อง)
  // จึงเลื่อนการออกเลขไปตอนที่เอกสารออกจากสถานะแบบร่างจริงๆ (ดู ensureIssued ด้านล่าง) — docNo เป็น null จนกว่าจะถึงตอนนั้น
  const doc = await store.insert('documents', {
    userId: user.id, type, docNo: null,
    status: 'draft', signed: false, signature: null,
    issueDate: bangkokDateStr(),
    ...fields,
  });
  await snapshotVersion(doc, user.displayName, 'สร้างเอกสาร (แบบร่าง ยังไม่ออกเลขที่)');
  await logAudit(user.id, doc.id, 'create', `สร้างแบบร่างเอกสารประเภท ${type}`, user.displayName);
  return doc;
}

// ออกเลขที่เอกสารจริงตอนที่เอกสารออกจากสถานะ "แบบร่าง" เป็นครั้งแรก (ตอนส่ง/อนุมัติ)
// ไม่ออกเลขให้เอกสารที่ยกเลิกตั้งแต่ยังเป็นแบบร่าง เพื่อไม่ให้เสียเลขที่ไปฟรีๆ
async function ensureIssued(doc, actorName) {
  if (doc.docNo) return doc;
  const updated = await store.update('documents', doc.id, { docNo: await makeDocNo(doc.type, doc.userId), issueDate: bangkokDateStr() });
  await logAudit(doc.userId, doc.id, 'issue', `ออกเลขที่เอกสาร ${updated.docNo}`, actorName || '');
  return updated;
}

api.post('/api/etax/invoice', requireAuth(async (req, res) => {
  const gate = profile.canIssue(req.user, 'ETAX');
  if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
  const b = await readJsonBody(req);
  const v = validateDocument('ETAX', b);
  if (!v.ok) return sendJson(res, 400, { error: 'ข้อมูลไม่ครบถ้วน', errors: v.errors });
  const items = b.items.filter((i) => i.name || i.price);
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const vat = tax.calcVat(subtotal, VAT_RATE_FIXED); // ข้อ 8: ล็อก VAT ไว้ที่ 7% เสมอ ไม่รับจากผู้ใช้
  const doc = await createDoc(req.user, 'ETAX', { docPurpose: ['self','send','record'].includes(b.docPurpose) ? b.docPurpose : 'self',
    buyer: b.buyer || '', buyerTaxId: b.buyerTaxId || '', items,
    base: vat.base, vatRate: vat.rate, vat: vat.vat, total: vat.total,
    signatureStandard: 'PAdES (จำลอง)', dueDate: b.dueDate || '',
  });
  sendJson(res, 201, doc);
}));
api.post('/api/ewht/certificate', requireAuth(async (req, res) => {
  const gate = profile.canIssue(req.user, 'EWHT');
  if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
  const b = await readJsonBody(req);
  const v = validateDocument('EWHT', b);
  if (!v.ok) return sendJson(res, 400, { error: 'ข้อมูลไม่ครบถ้วน', errors: v.errors });
  const calc = tax.calcWithholding(b.amount, validWhtRate(b.rate)); // ข้อ 8: จำกัดอัตราเฉพาะชุดที่กฎหมายกำหนด
  const doc = await createDoc(req.user, 'EWHT', { docPurpose: ['self','send','record'].includes(b.docPurpose) ? b.docPurpose : 'self',
    payee: b.payee || '', payeeTaxId: b.payeeTaxId || '', incomeType: b.incomeType || 'มาตรา 40(2)',
    description: b.description || 'ค่าจ้างผลิตเนื้อหา', ...calc, signatureStandard: 'XAdES (จำลอง)', dueDate: b.dueDate || '',
  });
  sendJson(res, 201, doc);
}));
api.post('/api/wht/store', requireAuth(async (req, res) => {
  const gate = profile.canIssue(req.user, 'WHT');
  if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
  const b = await readJsonBody(req);
  const v = validateDocument('WHT', b);
  if (!v.ok) return sendJson(res, 400, { error: 'ข้อมูลไม่ครบถ้วน', errors: v.errors });
  const calc = tax.calcWithholding(b.amount, validWhtRate(b.rate)); // ข้อ 8: จำกัดอัตราเฉพาะชุดที่กฎหมายกำหนด
  const doc = await createDoc(req.user, 'WHT', { docPurpose: 'record',
    payer: b.payer || '', description: b.description || 'ค่าจ้างผลิตเนื้อหา', incomeType: b.incomeType || 'มาตรา 40(2)', ...calc,
  });
  sendJson(res, 201, doc);
}));

/* =========================================================
 *  ใบลดหนี้ / ใบเพิ่มหนี้ (ตามประมวลรัษฎากร มาตรา 86/9 และ 86/10)
 *  ใช้แก้ไขใบกำกับภาษี (ETAX) ที่ออกไปแล้วอย่างถูกต้องตามกฎหมาย แทนการยกเลิกเอกสารทั้งฉบับ
 * ========================================================= */
const CREDIT_NOTE_REASONS = ['ลดราคาสินค้า/บริการ', 'สินค้าชำรุด/บกพร่อง', 'รับคืนสินค้า', 'คำนวณราคาผิดพลาดสูงไป', 'ยกเลิกสัญญาบางส่วน', 'อื่น ๆ'];
const DEBIT_NOTE_REASONS = ['คำนวณราคาผิดพลาดต่ำไป', 'เรียกเก็บเพิ่มเติมตามสัญญา', 'อื่น ๆ'];

function createAdjustmentNote(type, legalRef, reasons) {
  return requireAuth(async (req, res) => {
    const gate = profile.canIssue(req.user, 'ETAX');
    if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
    const b = await readJsonBody(req);
    const src = await store.find('documents', b.refDocId);
    if (!src || src.userId !== req.user.id || src.type !== 'ETAX') {
      return sendJson(res, 404, { error: 'ไม่พบใบกำกับภาษีต้นฉบับ หรือไม่ใช่เอกสารของคุณ' });
    }
    // มาตรา 86/9, 86/10 ใช้แก้ไข "ใบกำกับภาษีที่ออกไปแล้ว" เท่านั้น ไม่ใช่แบบร่าง/เอกสารที่ยกเลิกไปแล้ว
    if (!src.docNo || src.status === 'cancelled') {
      return sendJson(res, 400, { error: 'ออกใบลดหนี้/เพิ่มหนี้ได้เฉพาะใบกำกับภาษีที่ออกเลขที่แล้วและยังไม่ถูกยกเลิกเท่านั้น' });
    }
    const errors = [];
    if (!reasons.includes(b.reason)) errors.push('กรุณาเลือกเหตุผลที่ถูกต้องตามกฎหมาย');
    const adjustBase = round2(Number(b.amount) || 0);
    if (!(adjustBase > 0)) errors.push('กรุณาระบุยอดเงินส่วนต่างให้ถูกต้อง');
    if (errors.length) return sendJson(res, 400, { error: 'ข้อมูลไม่ครบถ้วน', errors });
    // ใช้อัตรา VAT เดียวกับใบกำกับภาษีต้นฉบับเสมอ ไม่รับอัตราจากผู้ใช้ตรงๆ (ตามหลักข้อ 8)
    const vat = tax.calcVat(adjustBase, src.vatRate);
    const doc = await createDoc(req.user, type, {
      docPurpose: ['self', 'send', 'record'].includes(b.docPurpose) ? b.docPurpose : 'self',
      refDocId: src.id, refDocNo: src.docNo,
      buyer: src.buyer || '', buyerTaxId: src.buyerTaxId || '',
      reason: b.reason, note: b.note || '',
      base: vat.base, vatRate: vat.rate, vat: vat.vat, total: vat.total,
      legalRef, signatureStandard: 'PAdES (จำลอง)',
    });
    await logAudit(req.user.id, doc.id, 'create', `ออก${type === 'CREDIT_NOTE' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้'}อ้างอิง ${src.docNo} (${b.reason})`, req.user.displayName);
    sendJson(res, 201, doc);
  });
}

api.get('/api/etax/adjustment-reasons', (req, res) => sendJson(res, 200, { creditNote: CREDIT_NOTE_REASONS, debitNote: DEBIT_NOTE_REASONS }));
api.post('/api/etax/credit-note', createAdjustmentNote('CREDIT_NOTE', 'ประมวลรัษฎากร มาตรา 86/9', CREDIT_NOTE_REASONS));
api.post('/api/etax/debit-note', createAdjustmentNote('DEBIT_NOTE', 'ประมวลรัษฎากร มาตรา 86/10', DEBIT_NOTE_REASONS));

/* =========================================================
 *  เอกสารธุรกิจ + สัญญา (ver5): ใบเสร็จ/ใบแจ้งหนี้/ใบเสนอราคา/PO/ใบส่งมอบงาน/ใบสำคัญจ่าย/สัญญาจ้าง
 * ========================================================= */
const BIZ_TYPES = ['RECEIPT', 'INVOICE', 'QUOTATION', 'PO', 'DELIVERY', 'PAYMENT'];
const CONTRACT_TYPES = ['CONTRACT_INF', 'CONTRACT_BRAND'];
const PAPER_TYPES = ['POA']; // เอกสารไม่มียอดเงิน

api.post('/api/docs/create', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  const type = b.type;
  const gate = profile.canIssue(req.user, type);
  if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
  if (![...BIZ_TYPES, ...CONTRACT_TYPES, ...PAPER_TYPES].includes(type)) return sendJson(res, 400, { error: 'ประเภทเอกสารไม่ถูกต้อง' });
  const errors = [];
  if (!b.party) errors.push('กรุณาระบุชื่อคู่สัญญา/คู่ค้า');
  const partyTaxIdErr = taxIdError(b.partyTaxId, 'คู่สัญญา/คู่ค้า');
  if (partyTaxIdErr) errors.push(partyTaxIdErr);
  let base = 0, vat = 0, vatRate = 0, items = [];
  if (type === 'POA') {
    if (!b.scope) errors.push('กรุณาระบุขอบเขตอำนาจที่มอบ');
  } else if (CONTRACT_TYPES.includes(type)) {
    base = round2(Number(b.fee) || 0);
    if (!(base > 0)) errors.push('กรุณาระบุค่าตอบแทนตามสัญญา');
    if (!b.scope) errors.push('กรุณาระบุขอบเขตงาน');
  } else if (type === 'PAYMENT') {
    base = round2(Number(b.amount) || 0);
    if (!(base > 0)) errors.push('กรุณาระบุยอดเงินที่ชำระ');
  } else {
    items = validLineItems(b.items);
    if (!items.length) errors.push('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ');
    errors.push(...lineItemErrors(items));
    base = round2(items.reduce((s2, i) => s2 + (Number(i.qty) || 0) * (Number(i.price) || 0), 0));
    // ข้อ 7: จะรวม VAT ในเอกสารทั่วไป (ไม่ใช่ ETAX) ได้เฉพาะบัญชีที่จดทะเบียน VAT แล้วเท่านั้น
    // (เดิมส่ง includeVat:true ได้แม้ไม่ได้จด VAT)
    if (b.includeVat) {
      if (!req.user.vatRegistered) {
        errors.push('บัญชีนี้ยังไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม จึงรวม VAT ในเอกสารนี้ไม่ได้');
      } else {
        vatRate = 7; // ข้อ 8: ล็อกอัตรา VAT ไว้ที่ 7% ตามกฎหมาย ไม่รับค่าจากผู้ใช้โดยตรง
        vat = round2(base * vatRate / 100);
      }
    }
  }
  if (errors.length) return sendJson(res, 400, { error: 'ข้อมูลไม่ครบถ้วน', errors });
  const doc = await createDoc(req.user, type, {
    party: b.party, partyTaxId: b.partyTaxId || '', partyAddress: b.partyAddress || '',
    items, base, vatRate, vat, total: round2(base + vat), net: round2(base + vat),
    description: b.description || '', note: b.note || '',
    method: b.method || '', payRef: b.payRef || '',
    scope: b.scope || '', paymentTerms: b.paymentTerms || '', startDate: b.startDate || '', endDate: b.endDate || '',
    dueDate: b.dueDate || '', validDays: b.validDays || '', deliveryDate: b.deliveryDate || '', phase: b.phase || '',
    effectiveUntil: b.effectiveUntil || '', issuerRole: req.user.role,
    docPurpose: ['self', 'send', 'record'].includes(b.docPurpose) ? b.docPurpose : 'self',
  });
  sendJson(res, 201, doc);
}));

/* =========================================================
 *  คัดลอกเอกสาร (Duplicate — ver10)
 * ========================================================= */
api.post('/api/documents/:id/duplicate', requireAuth(async (req, res) => {
  const src = await ownDoc(req);
  if (!src) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  // ข้อ 7: คัดลอกเอกสารก็ต้องผ่านเงื่อนไขการออกเอกสารเหมือนสร้างใหม่ (เดิมข้ามเงื่อนไขนี้ไปทั้งหมด)
  const gate = profile.canIssue(req.user, src.type);
  if (!gate.ok) return sendJson(res, 403, { error: gate.error, missing: gate.missing });
  const { id, docNo, status, signed, signature, counterpartySignature, pdfKey, xmlKey, createdAt, updatedAt, ...rest } = src;
  const copy = await createDoc(req.user, src.type, { ...rest, signed: false, signature: null, counterpartySignature: null });
  await logAudit(req.user.id, copy.id, 'duplicate', `คัดลอกจาก ${src.docNo}`, req.user.displayName);
  sendJson(res, 201, copy);
}));

/* =========================================================
 *  ระบบส่งเอกสารข้ามบัญชี (ver6): ขอลายเซ็น/ขอตรวจสอบ พร้อมกำหนดเวลา
 *  บริษัท↔อินฟลู · บริษัท↔เอเจนซี่ · เอเจนซี่เป็นตัวกลางส่งทั้งสองฝ่าย
 * ========================================================= */
const todayStr = () => new Date().toISOString().slice(0, 10);
const reqPublic = async (r) => {
  const doc = await store.find('documents', r.docId);
  const from = await store.find('users', r.fromUserId);
  const to = await store.find('users', r.toUserId);
  return {
    id: r.id, docId: r.docId, purpose: r.purpose, message: r.message, dueDate: r.dueDate,
    signAs: r.signAs || '', status: r.status, sentAt: r.createdAt, respondedAt: r.respondedAt || null,
    declineReason: r.declineReason || '',
    overdue: r.status === 'sent' && r.dueDate && r.dueDate < todayStr(),
    doc: doc ? { docNo: doc.docNo, type: doc.type, base: doc.base, total: doc.total ?? doc.net, party: doc.party || doc.buyer || doc.payee || doc.payer || '', status: doc.status, counterpartySigned: !!doc.counterpartySignature } : null,
    fromName: from ? (from.companyName || from.displayName) : '', fromEmail: from ? from.email : '',
    toName: to ? (to.companyName || to.displayName) : '', toEmail: to ? to.email : '',
  };
};

// ส่งเอกสารให้บัญชีอื่น (ระบุอีเมลผู้ใช้ในระบบ)
api.post('/api/documents/:id/request', requireAuth(async (req, res) => {
  let doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const b = await readJsonBody(req);
  const email = String(b.toEmail || '').trim().toLowerCase();
  if (!email) return sendJson(res, 400, { error: 'กรุณาระบุอีเมลผู้รับ' });
  const target = await store.whereOne('users', { email });
  if (!target) return sendJson(res, 404, { error: 'ไม่พบบัญชีผู้ใช้อีเมลนี้ในระบบ — คู่ค้าต้องสมัคร TaxFlow ด้วยอีเมลดังกล่าวก่อน' });
  if (target.id === req.user.id) return sendJson(res, 400, { error: 'ไม่สามารถส่งเอกสารหาตัวเองได้' });
  // ข้อ 4: ผู้ออกเอกสารต้องลงนามฝั่งตนเองก่อน จึงส่งขอลายเซ็นจากคู่ค้าได้
  if ((b.purpose || 'sign') !== 'review' && !doc.signature) {
    return sendJson(res, 400, { error: 'ผู้ออกเอกสารต้องลงนามก่อนส่งขอลายเซ็นจากคู่ค้า — ลงนามได้ที่แท็บ "ลายเซ็น" หรือปุ่มลงนามในหน้านี้' });
  }
  // ยกเลิกคำขอเดิมที่ยังค้างของเอกสารนี้
  for (const r of await store.all('requests', (r) => r.docId === doc.id && r.status === 'sent')) await store.update('requests', r.id, { status: 'cancelled' });
  const purpose = b.purpose === 'review' ? 'review' : 'sign';
  const row = await store.insert('requests', {
    docId: doc.id, fromUserId: req.user.id, toUserId: target.id, toEmail: email,
    purpose, message: b.message || '', dueDate: b.dueDate || '', signAs: b.signAs || '', status: 'sent',
  });
  if (doc.status === 'draft') {
    doc = await ensureIssued(doc, req.user.displayName); // ข้อ: ออกเลขที่จริงตอนส่งเอกสารออกจากแบบร่าง
    const updated = await store.update('documents', doc.id, { status: 'pending' });
    await snapshotVersion(updated, req.user.displayName, 'ส่งเอกสารให้คู่ค้า');
    doc = updated;
  }
  await logAudit(req.user.id, doc.id, 'send', `ส่ง ${doc.docNo} ถึง ${email} (${purpose === 'sign' ? 'ขอลายเซ็น' : 'ขอตรวจสอบ'}${b.dueDate ? ' ภายใน ' + b.dueDate : ''})`, req.user.displayName);
  const senderName = req.user.companyName || req.user.displayName;
  await notify(target.id, 'request', `${senderName} ส่งเอกสาร ${doc.docNo} ให้คุณ${purpose === 'sign' ? 'ลงนาม' : 'ตรวจสอบ'}${b.dueDate ? ' ภายในวันที่ ' + b.dueDate : ''}`, null, { reqId: row.id });
  sendJson(res, 201, await reqPublic(row));
}));

// กล่องรับเอกสาร (คำขอที่ส่งมาถึงฉัน)
api.get('/api/requests/inbox', requireAuth(async (req, res) => {
  const items = await Promise.all((await store.all('requests', (r) => r.toUserId === req.user.id)).reverse().map(reqPublic));
  sendJson(res, 200, { items, actionCount: items.filter((x) => x.status === 'sent').length });
}));

// คำขอของเอกสารหนึ่งฉบับ (ฝั่งผู้ส่ง — ใช้ในแท็บ "ส่งเอกสาร")
api.get('/api/documents/:id/requests', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  sendJson(res, 200, { items: await Promise.all((await store.all('requests', (r) => r.docId === doc.id)).reverse().map(reqPublic)) });
}));

// ผู้รับเปิดดูเอกสาร (PDF) จากคำขอ
api.get('/api/requests/:id/pdf', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return sendHtml(res, 401, '<h2>กรุณาเข้าสู่ระบบก่อน</h2>');
  const r = await store.find('requests', req.params.id);
  if (!r || (r.toUserId !== user.id && r.fromUserId !== user.id)) return sendHtml(res, 404, '<h2>ไม่พบคำขอ</h2>');
  const doc = await store.find('documents', r.docId);
  const issuer = await store.find('users', r.fromUserId);
  if (!doc || !issuer) return sendHtml(res, 404, '<h2>ไม่พบเอกสาร</h2>');
  const attachments = await store.all('attachments', (a) => a.docId === doc.id);
  await logAudit(r.fromUserId, doc.id, 'view', `${user.displayName} เปิดดูเอกสารจากคำขอ`, user.displayName);
  sendHtml(res, 200, docview.render(doc, issuer, { attachments, brand: brandCtx(issuer) }));
});

// ผู้รับลงนามตอบกลับ (ใช้คลังลายเซ็นของบัญชีตนเอง)
api.post('/api/requests/:id/sign', requireAuth(async (req, res) => {
  const r = await store.find('requests', req.params.id);
  if (!r || r.toUserId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบคำขอ' });
  if (r.status !== 'sent') return sendJson(res, 400, { error: 'คำขอนี้ถูกตอบไปแล้ว' });
  const b = await readJsonBody(req);
  const doc = await store.find('documents', r.docId);
  if (!doc) return sendJson(res, 404, { error: 'เอกสารถูกลบแล้ว' });
  // ข้อ 5: ต้องตรวจสถานะเอกสารก่อนรับลายเซ็นทุกครั้ง กันกรณีเอกสารถูกยกเลิก/เปลี่ยนสถานะไปแล้ว
  // แต่คำขอยังค้างอยู่ (เช่น เจ้าของยกเลิกเอกสารหลังส่งคำขอ)
  if (doc.status !== 'pending') {
    return sendJson(res, 400, { error: 'เอกสารนี้ไม่อยู่ในสถานะที่รับลายเซ็นได้แล้ว (อาจถูกยกเลิกหรือเปลี่ยนสถานะไปก่อนหน้านี้)' });
  }
  // ต้องยืนยันด้วยรหัส OTP ที่ส่งไปยังอีเมลก่อนลงนามทุกครั้ง
  const check = await otp.verify(b.otpId, b.code, { userId: req.user.id, purpose: 'sign-request', refId: r.id });
  if (!check.ok) return sendJson(res, 400, { error: check.error });
  if (b.image !== undefined && b.image !== null && !isValidSignatureImage(b.image)) {
    return sendJson(res, 400, { error: 'รูปลายเซ็นไม่ถูกต้อง' });
  }
  const signerName = b.signerName || req.user.displayName;
  // ข้อ 5: คู่ค้าลงนามตอบกลับแล้ว = เอกสารผ่านขั้นตอนอนุมัติ (countersign → approved)
  const updated = await store.update('documents', doc.id, {
    status: 'approved',
    counterpartySignature: {
      signerName, image: b.image || null, signedAt: new Date().toISOString(),
      byUserId: req.user.id, byEmail: req.user.email, signAs: r.signAs || '',
      contentHash: contentHash(doc),
    },
  });
  await store.update('requests', r.id, { status: 'signed', respondedAt: new Date().toISOString() });
  await snapshotVersion(updated, signerName, 'คู่ค้าลงนามตอบกลับ — เอกสารอนุมัติแล้ว');
  await logAudit(r.fromUserId, doc.id, 'countersign', `${signerName} (${req.user.email}) ลงนามเอกสาร — สถานะเปลี่ยนเป็นอนุมัติ`, signerName);
  const senderName = req.user.companyName || req.user.displayName;
  await notify(r.fromUserId, 'signed', `${senderName} ลงนามเอกสาร ${doc.docNo} เรียบร้อยแล้ว — เอกสารอนุมัติแล้ว`, doc.id);
  sendJson(res, 200, { ok: true });
}));

// ผู้รับตอบรับผลตรวจ (กรณี purpose=review) หรือปฏิเสธ
api.post('/api/requests/:id/approve', requireAuth(async (req, res) => {
  const r = await store.find('requests', req.params.id);
  if (!r || r.toUserId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบคำขอ' });
  if (r.status !== 'sent') return sendJson(res, 400, { error: 'คำขอนี้ถูกตอบไปแล้ว' });
  const doc = await store.find('documents', r.docId);
  if (!doc) return sendJson(res, 404, { error: 'เอกสารถูกลบแล้ว' });
  if (doc.status !== 'pending') {
    return sendJson(res, 400, { error: 'เอกสารนี้ไม่อยู่ในสถานะที่ตรวจสอบได้แล้ว (อาจถูกยกเลิกหรือเปลี่ยนสถานะไปก่อนหน้านี้)' });
  }
  await store.update('requests', r.id, { status: 'approved', respondedAt: new Date().toISOString() });
  // ข้อ 5: ผลตรวจสอบ "ผ่าน" จากคู่ค้า = เอกสารอนุมัติแล้ว
  const updated = await store.update('documents', doc.id, { status: 'approved' });
  await snapshotVersion(updated, req.user.displayName, 'คู่ค้าตรวจสอบผ่าน — เอกสารอนุมัติแล้ว');
  await logAudit(r.fromUserId, doc.id, 'review-ok', `${req.user.displayName} ตรวจสอบแล้ว ไม่มีแก้ไข — สถานะเปลี่ยนเป็นอนุมัติ`, req.user.displayName);
  await notify(r.fromUserId, 'approved', `${req.user.companyName || req.user.displayName} ตรวจสอบเอกสาร ${doc.docNo} แล้ว — ผ่าน`, doc.id);
  sendJson(res, 200, { ok: true });
}));

api.post('/api/requests/:id/decline', requireAuth(async (req, res) => {
  const r = await store.find('requests', req.params.id);
  if (!r || r.toUserId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบคำขอ' });
  if (r.status !== 'sent') return sendJson(res, 400, { error: 'คำขอนี้ถูกตอบไปแล้ว' });
  const b = await readJsonBody(req);
  const doc = await store.find('documents', r.docId);
  if (!doc) return sendJson(res, 404, { error: 'เอกสารถูกลบแล้ว' });
  if (doc.status !== 'pending') {
    return sendJson(res, 400, { error: 'เอกสารนี้ไม่อยู่ในสถานะที่ตีกลับได้แล้ว (อาจถูกยกเลิกหรือเปลี่ยนสถานะไปก่อนหน้านี้)' });
  }
  await store.update('requests', r.id, { status: 'declined', respondedAt: new Date().toISOString(), declineReason: b.reason || '' });
  // ข้อ 5: ตีกลับ = เอกสารไม่อนุมัติ
  const updated = await store.update('documents', doc.id, { status: 'rejected' });
  await snapshotVersion(updated, req.user.displayName, `คู่ค้าตีกลับ: ${b.reason || '-'}`);
  await logAudit(r.fromUserId, doc.id, 'declined', `${req.user.displayName} ปฏิเสธ: ${b.reason || '-'} — สถานะเปลี่ยนเป็นไม่อนุมัติ`, req.user.displayName);
  await notify(r.fromUserId, 'rejected', `${req.user.companyName || req.user.displayName} ตีกลับเอกสาร ${doc.docNo}${b.reason ? ' — ' + b.reason : ''}`, doc.id);
  sendJson(res, 200, { ok: true });
}));

// ผู้ส่งยกเลิกคำขอ
api.post('/api/requests/:id/cancel', requireAuth(async (req, res) => {
  const r = await store.find('requests', req.params.id);
  if (!r || r.fromUserId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบคำขอ' });
  if (r.status !== 'sent') return sendJson(res, 400, { error: 'คำขอนี้ปิดไปแล้ว' });
  await store.update('requests', r.id, { status: 'cancelled' });
  sendJson(res, 200, { ok: true });
}));

/* =========================================================
 *  คลังลายเซ็น (ข้อ 5): บันทึกลายเซ็น เรียกใช้ซ้ำได้
 * ========================================================= */
api.get('/api/signatures', requireAuth(async (req, res) => {
  sendJson(res, 200, { items: (await store.all('signatures', (x) => x.userId === req.user.id)).reverse() });
}));
api.post('/api/signatures', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  if (!isValidSignatureImage(b.image)) return sendJson(res, 400, { error: 'รูปลายเซ็นไม่ถูกต้อง' });
  const row = await store.insert('signatures', { userId: req.user.id, name: b.name || req.user.displayName, image: b.image });
  await logAudit(req.user.id, null, 'signature-save', `บันทึกลายเซ็น "${row.name}" เข้าคลัง`, req.user.displayName);
  sendJson(res, 201, row);
}));
api.delete('/api/signatures/:id', requireAuth(async (req, res) => {
  const x = await store.find('signatures', req.params.id);
  if (!x || x.userId !== req.user.id) return sendJson(res, 404, { error: 'not found' });
  await store.remove('signatures', x.id);
  sendJson(res, 200, { deleted: true });
}));

/* =========================================================
 *  DOCUMENTS — list / detail / edit / status / delete
 * ========================================================= */
async function ownDoc(req) {
  const doc = await store.find('documents', req.params.id);
  if (!doc || doc.userId !== req.user.id) return null;
  return doc;
}

api.get('/api/documents', requireAuth(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams;
  const type = p.get('type'), status = p.get('status'), q = (p.get('q') || '').toLowerCase();
  const contact = (p.get('contact') || '').toLowerCase();
  const from = p.get('from'), to = p.get('to');
  const rows = (await store.all('documents', (d) =>
    d.userId === req.user.id &&
    (!type || d.type === type) &&
    (!status || d.status === status) &&
    (!q || (d.docNo || '').toLowerCase().includes(q) || JSON.stringify(d).toLowerCase().includes(q)) &&
    (!contact || (`${d.buyer || ''}${d.payee || ''}${d.payer || ''}`).toLowerCase().includes(contact)) &&
    // ข้อ: กรองตาม "วันที่ออกเอกสาร" ตามเขตเวลาไทย (issueDate) แทน createdAt แบบ UTC ตรงๆ
    // (เอกสารเก่าก่อนมีฟิลด์นี้ fallback ไปใช้ createdAt) กันเอกสารที่สร้างช่วงดึกตกไปอยู่วันก่อนหน้าผิดวัน
    (!from || (d.issueDate || (d.createdAt || '').slice(0, 10)) >= from) &&
    (!to || (d.issueDate || (d.createdAt || '').slice(0, 10)) <= to)
  )).reverse();
  const withReq = await Promise.all(rows.map(async (d) => {
    const reqs = await store.all('requests', (r) => r.docId === d.id);
    const last = reqs.length ? reqs[reqs.length - 1] : null;
    if (!last) return d;
    const toU = await store.find('users', last.toUserId);
    return { ...d, sentTo: { email: last.toEmail, name: toU ? (toU.companyName || toU.displayName) : last.toEmail, status: last.status, dueDate: last.dueDate || '' } };
  }));
  sendJson(res, 200, { count: withReq.length, items: withReq });
}));

api.get('/api/documents/:id', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const attachments = (await store.all('attachments', (a) => a.docId === doc.id)).map((a) => { const { dataBase64, storedName, ...meta } = a; return meta; });
  const versions = await store.all('doc_versions', (v) => v.docId === doc.id);
  const audit = (await store.all('audit_log', (a) => a.docId === doc.id)).reverse();
  const share = await store.findOne('shares', (s) => s.docId === doc.id);
  const reqsAll = await store.all('requests', (r) => r.docId === doc.id);
  const lastReq = reqsAll.length ? await reqPublic(reqsAll[reqsAll.length - 1]) : null;
  sendJson(res, 200, { ...doc, attachments, versions, audit, share: share ? { token: share.token } : null, activeRequest: lastReq, allowedTransitions: STATUS_FLOW[doc.status] || [] });
}));

api.put('/api/documents/:id', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  if (['approved', 'archived', 'cancelled'].includes(doc.status)) return sendJson(res, 400, { error: 'เอกสารสถานะนี้แก้ไขไม่ได้' });
  // ใบลดหนี้/ใบเพิ่มหนี้อ้างอิงใบกำกับภาษีต้นฉบับตามกฎหมาย ห้ามแก้ไขเนื้อหาภายหลัง — ยกเลิกแล้วออกใหม่แทน
  if (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(doc.type)) return sendJson(res, 400, { error: 'ใบลดหนี้/ใบเพิ่มหนี้แก้ไขไม่ได้ — หากข้อมูลผิดพลาดให้ยกเลิกเอกสารนี้แล้วออกฉบับใหม่' });
  const b = await readJsonBody(req);
  let patch = {};
  const errors = [];
  const GEN_TYPES = [...BIZ_TYPES, ...CONTRACT_TYPES];
  if (GEN_TYPES.includes(doc.type)) {
    const partyTaxIdErr = taxIdError(b.partyTaxId ?? doc.partyTaxId, 'คู่สัญญา/คู่ค้า');
    if (partyTaxIdErr) errors.push(partyTaxIdErr);
    patch = { party: b.party ?? doc.party, partyTaxId: b.partyTaxId ?? doc.partyTaxId, note: b.note ?? doc.note, scope: b.scope ?? doc.scope };
    if (b.amount !== undefined || b.fee !== undefined) {
      const base = round2(Number(b.amount ?? b.fee) || doc.base);
      if (!(base > 0)) errors.push('กรุณาระบุยอดเงินให้ถูกต้อง');
      // ข้อ 8: VAT ของเอกสารทั่วไปยังคงล็อกไว้ที่ 7% ตามเดิม (ไม่รับอัตราใหม่จากผู้ใช้ตอนแก้ไข)
      const vat = doc.vatRate ? round2(base * doc.vatRate / 100) : 0;
      Object.assign(patch, { base, vat, total: round2(base + vat), net: round2(base + vat) });
    }
  } else if (doc.type === 'ETAX') {
    const items = b.items !== undefined ? validLineItems(b.items) : doc.items;
    if (!items.length) errors.push('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ');
    errors.push(...lineItemErrors(items));
    const buyerTaxIdErr = taxIdError(b.buyerTaxId ?? doc.buyerTaxId, 'ผู้ซื้อ');
    if (buyerTaxIdErr) errors.push(buyerTaxIdErr);
    const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
    const vat = tax.calcVat(subtotal, VAT_RATE_FIXED); // ข้อ 8: ล็อก VAT ไว้ที่ 7% เสมอ
    patch = { buyer: b.buyer ?? doc.buyer, buyerTaxId: b.buyerTaxId ?? doc.buyerTaxId, items, base: vat.base, vatRate: vat.rate, vat: vat.vat, total: vat.total };
  } else {
    const amount = Number(b.amount ?? doc.base);
    if (!(amount > 0)) errors.push('กรุณาระบุยอดเงินให้ถูกต้อง');
    if (doc.type === 'EWHT') {
      const payeeTaxIdErr = taxIdError(b.payeeTaxId ?? doc.payeeTaxId, 'ผู้รับเงิน');
      if (payeeTaxIdErr) errors.push(payeeTaxIdErr);
    }
    const calc = tax.calcWithholding(amount, validWhtRate(b.rate ?? doc.rate, doc.rate)); // ข้อ 8: จำกัดอัตราเฉพาะชุดที่กฎหมายกำหนด
    patch = { payee: b.payee ?? doc.payee, payer: b.payer ?? doc.payer, description: b.description ?? doc.description, incomeType: b.incomeType ?? doc.incomeType, ...calc };
  }
  if (errors.length) return sendJson(res, 400, { error: 'ข้อมูลไม่ถูกต้อง', errors });
  // ข้อ 6: เนื้อหาที่ลงนามไปแล้วเปลี่ยน = ลายเซ็นเดิมใช้อ้างอิงไม่ได้อีกต่อไป ต้องล้างทิ้งแล้วให้ลงนามใหม่
  // (กันกรณีแก้ยอดเงินหลังลงนามแล้วลายเซ็นเดิมยังติดอยู่กับเนื้อหาใหม่)
  const hadSignature = !!(doc.signature || doc.counterpartySignature);
  if (hadSignature) {
    Object.assign(patch, { signed: false, signature: null, counterpartySignature: null });
  }
  const updated = await store.update('documents', doc.id, patch);
  await snapshotVersion(updated, req.user.displayName, b.note || 'แก้ไขเอกสาร');
  await logAudit(req.user.id, doc.id, 'edit', `แก้ไข ${doc.docNo}${hadSignature ? ' — ลายเซ็นเดิมถูกล้างเพราะเนื้อหาเปลี่ยน ต้องลงนามใหม่' : ''}`, req.user.displayName);
  await notify(req.user.id, 'edit', hadSignature
    ? `แก้ไขเอกสาร ${doc.docNo} — ลายเซ็นเดิมถูกล้างแล้ว กรุณาลงนามใหม่`
    : `มีการแก้ไขเอกสาร ${doc.docNo}`, doc.id);
  sendJson(res, 200, updated);
}));

api.post('/api/documents/:id/status', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const b = await readJsonBody(req);
  const next = b.status;
  if (!(STATUS_FLOW[doc.status] || []).includes(next)) return sendJson(res, 400, { error: `เปลี่ยนจาก "${STATUS_LABEL[doc.status]}" เป็น "${STATUS_LABEL[next] || next}" ไม่ได้` });
  // ข้อ 5: เอกสารที่อยู่ระหว่างส่งให้คู่ค้าลงนาม/ตรวจสอบ (status=pending + docPurpose=send)
  // ต้องอนุมัติผ่านการลงนามหรือผลตรวจของคู่ค้าเท่านั้น เจ้าของเอกสารเปลี่ยนเป็น "อนุมัติ" เองไม่ได้
  // (ก่อนส่ง — ยังเป็น draft — ยังปิดงานเองได้ตามปกติ เพราะยังไม่มีคำขอค้างอยู่ที่ฝั่งคู่ค้า)
  if (next === 'approved' && doc.status === 'pending' && (doc.docPurpose || 'self') === 'send') {
    return sendJson(res, 400, { error: 'เอกสารนี้ถูกส่งให้คู่ค้าลงนาม/ตรวจสอบแล้ว ต้องรอผลจากคู่ค้าเท่านั้น ไม่สามารถอนุมัติเองได้' });
  }
  // ข้อ: ออกเลขที่จริงตอนเอกสารออกจากสถานะแบบร่างเป็นครั้งแรก (ยกเว้นยกเลิกตั้งแต่ยังเป็นแบบร่าง — ไม่ต้องออกเลข)
  if (doc.status === 'draft' && next !== 'cancelled') await ensureIssued(doc, req.user.displayName);
  const updated = await store.update('documents', doc.id, { status: next, statusNote: b.note || '' });
  if (next === 'cancelled') {
    const cancelledAt = new Date().toISOString();
    await store.update('documents', doc.id, { cancelledAt, cancelReason: b.note || '' });
    // ยกเลิกคำขอลงนาม/ตรวจสอบที่ยังค้างอยู่ด้วย กันคู่ค้าลงนามเอกสารที่ถูกยกเลิกไปแล้ว
    for (const r of await store.all('requests', (r) => r.docId === doc.id && r.status === 'sent')) {
      await store.update('requests', r.id, { status: 'cancelled' });
    }
  }
  await snapshotVersion(updated, req.user.displayName, `เปลี่ยนสถานะเป็น ${STATUS_LABEL[next]}`);
  await logAudit(req.user.id, doc.id, 'status', `${STATUS_LABEL[doc.status]} → ${STATUS_LABEL[next]}`, req.user.displayName);
  const notifyMap = { approved: `เอกสาร ${updated.docNo} ได้รับการอนุมัติ`, rejected: `เอกสาร ${updated.docNo} ถูกตีกลับ (ไม่อนุมัติ)`, pending: `เอกสาร ${updated.docNo} ถูกส่งเข้ารอตรวจสอบ` };
  if (notifyMap[next]) await notify(req.user.id, next, notifyMap[next], doc.id);
  sendJson(res, 200, updated);
}));

// ลบถาวรได้เฉพาะเอกสารสถานะ "แบบร่าง" เท่านั้น (ข้อ 41 ของสเปก + หลักเก็บเอกสารภาษี 5 ปี)
// สถานะอื่นต้อง "ยกเลิก" ผ่าน /api/documents/:id/status (status=cancelled) พร้อมระบุเหตุผล
// เพื่อไม่ให้เลขที่เอกสารขาดช่วงและยังมีร่องรอยตรวจสอบย้อนหลังได้
api.delete('/api/documents/:id', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  if (doc.status !== 'draft') {
    return sendJson(res, 400, {
      error: 'ลบเอกสารที่ไม่ใช่แบบร่างไม่ได้ — เอกสารที่ออกแล้วต้อง "ยกเลิก" พร้อมระบุเหตุผลแทน เพื่อรักษาลำดับเลขที่เอกสารและร่องรอยตรวจสอบตามกฎหมาย',
    });
  }
  for (const a of await store.all('attachments', (a) => a.docId === doc.id)) { try { fs.unlinkSync(path.join(store.UPLOAD_DIR, a.storedName)); } catch {} await store.remove('attachments', a.id); }
  await store.remove('documents', doc.id);
  await logAudit(req.user.id, null, 'delete', `ลบเอกสาร ${doc.docNo}`, req.user.displayName);
  sendJson(res, 200, { deleted: true });
}));

/* =========================================================
 *  VERSIONS
 * ========================================================= */
api.get('/api/documents/:id/versions', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  sendJson(res, 200, { items: await store.all('doc_versions', (v) => v.docId === doc.id) });
}));

/* =========================================================
 *  ATTACHMENTS (upload / list / download / delete)
 * ========================================================= */
const ALLOWED_MIME = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_SIZE = 5 * 1024 * 1024;

api.post('/api/documents/:id/attachments', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const b = await readJsonBody(req);
  if (!b.dataBase64) return sendJson(res, 400, { error: 'ไม่พบไฟล์' });
  if (!ALLOWED_MIME[b.mime]) return sendJson(res, 415, { error: 'รองรับเฉพาะไฟล์ PDF, PNG, JPG, WEBP เท่านั้น' });
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length > MAX_SIZE) return sendJson(res, 413, { error: 'ไฟล์มีขนาดเกิน 5 MB' });
  if (!magicbytes.matches(buf, b.mime)) return sendJson(res, 415, { error: 'ไฟล์ไม่ตรงกับชนิดที่แจ้ง กรุณาอัปโหลดไฟล์จริง' });
  const storedName = crypto.randomBytes(12).toString('hex') + '.' + ALLOWED_MIME[b.mime];
  fs.writeFileSync(path.join(store.UPLOAD_DIR, storedName), buf);
  const att = await store.insert('attachments', {
    userId: req.user.id, docId: doc.id, kind: b.kind || 'other',
    filename: b.filename || storedName, mime: b.mime, size: buf.length, storedName,
  });
  await logAudit(req.user.id, doc.id, 'upload', `แนบไฟล์ ${att.filename}`, req.user.displayName);
  const { dataBase64, storedName: sn, ...meta } = att;
  sendJson(res, 201, meta);
}));

api.get('/api/attachments/:id', requireAuth(async (req, res) => {
  const a = await store.find('attachments', req.params.id);
  if (!a || a.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบไฟล์' });
  try {
    const buf = fs.readFileSync(path.join(store.UPLOAD_DIR, a.storedName));
    res.writeHead(200, { 'Content-Type': a.mime, 'Content-Disposition': `inline; filename="file"`, 'Content-Length': buf.length });
    res.end(buf);
  } catch { sendJson(res, 404, { error: 'ไฟล์หาย' }); }
}));

api.delete('/api/attachments/:id', requireAuth(async (req, res) => {
  const a = await store.find('attachments', req.params.id);
  if (!a || a.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบไฟล์' });
  try { fs.unlinkSync(path.join(store.UPLOAD_DIR, a.storedName)); } catch {}
  await store.remove('attachments', a.id);
  await logAudit(req.user.id, a.docId, 'delete-attachment', `ลบไฟล์แนบ ${a.filename}`, req.user.displayName);
  sendJson(res, 200, { deleted: true });
}));

/* =========================================================
 *  E-SIGNATURE
 * ========================================================= */
api.post('/api/documents/:id/sign', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const b = await readJsonBody(req);
  // ต้องยืนยันด้วยรหัส OTP ที่ส่งไปยังอีเมลก่อนลงนามทุกครั้ง
  const check = await otp.verify(b.otpId, b.code, { userId: req.user.id, purpose: 'sign-doc', refId: doc.id });
  if (!check.ok) return sendJson(res, 400, { error: check.error });
  if (b.image !== undefined && b.image !== null && !isValidSignatureImage(b.image)) {
    return sendJson(res, 400, { error: 'รูปลายเซ็นไม่ถูกต้อง' });
  }
  const signature = { signerName: b.signerName || req.user.displayName, signedAt: new Date().toISOString(), image: b.image || null, contentHash: contentHash(doc) };
  const updated = await store.update('documents', doc.id, { signed: true, signature });
  await snapshotVersion(updated, req.user.displayName, 'ลงลายมือชื่อดิจิทัล (ยืนยันด้วย OTP)');
  await logAudit(req.user.id, doc.id, 'sign', `ลงนามโดย ${signature.signerName} (ยืนยันด้วย OTP)`, req.user.displayName);
  sendJson(res, 200, updated);
}));

/* =========================================================
 *  SHARE + VERIFY + QR
 * ========================================================= */
async function ensureShare(doc, userId) {
  let share = await store.findOne('shares', (s) => s.docId === doc.id);
  if (!share) share = await store.insert('shares', { token: crypto.randomBytes(10).toString('hex'), docId: doc.id, userId });
  return share;
}
// ข้อ: URL ใน QR ไม่ควรสร้างจาก header Host ที่ผู้ร้องขอกำหนดเองได้ (Host header injection)
// และไม่ควรบังคับเป็น http:// เสมอ — ให้ตั้งค่า PUBLIC_BASE_URL ใน production แทน
// (เช่น https://taxflow.example.com) มิฉะนั้น fallback ไปใช้ Host header สำหรับพัฒนา/ทดสอบในเครื่อง
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
function verifyUrl(req, token) {
  const base = PUBLIC_BASE_URL || `http://${req.headers.host || `localhost:${PORT}`}`;
  return `${base}/verify.html?token=${token}`;
}

api.post('/api/documents/:id/share', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const share = await ensureShare(doc, req.user.id);
  await logAudit(req.user.id, doc.id, 'share', `สร้างลิงก์แชร์ ${doc.docNo}`, req.user.displayName);
  sendJson(res, 200, { token: share.token, url: verifyUrl(req, share.token) });
}));

api.get('/api/documents/:id/qr.svg', requireAuth(async (req, res) => {
  const doc = await ownDoc(req);
  if (!doc) return sendJson(res, 404, { error: 'ไม่พบเอกสาร' });
  const share = await ensureShare(doc, req.user.id);
  const svg = qr.toSVG(verifyUrl(req, share.token), { scale: 4 });
  res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg);
}));

api.get('/api/verify/:token', async (req, res) => {
  const share = await store.findOne('shares', (s) => s.token === req.params.token);
  if (!share) return sendJson(res, 404, { valid: false, error: 'ไม่พบเอกสาร' });
  const doc = await store.find('documents', share.docId);
  if (!doc) return sendJson(res, 404, { valid: false, error: 'เอกสารถูกลบแล้ว' });
  const issuer = await store.find('users', doc.userId);
  // ข้อ 6: เทียบแฮชเนื้อหาปัจจุบันกับแฮชตอนลงนาม เพื่อบอกผู้ตรวจว่าเอกสารถูกแก้ไขหลังลงนามหรือไม่
  // (ปกติจะตรงกันเสมอเพราะระบบล้างลายเซ็นทิ้งทันทีที่มีการแก้ไข — นี่คือด่านตรวจซ้ำ)
  const currentHash = contentHash(doc);
  const tampered = !!(doc.signature && doc.signature.contentHash && doc.signature.contentHash !== currentHash);
  sendJson(res, 200, {
    valid: true, docNo: doc.docNo, type: doc.type, status: doc.status,
    counterparty: doc.buyer || doc.payee || doc.payer || '',
    base: doc.base, total: doc.type === 'ETAX' ? doc.total : doc.net,
    signed: doc.signed, signerName: doc.signature ? doc.signature.signerName : null,
    signedAt: doc.signature ? doc.signature.signedAt : null,
    issuer: issuer ? (issuer.companyName || issuer.displayName) : '', createdAt: doc.createdAt,
    contentHash: currentHash, tampered,
  });
});

/* =========================================================
 *  PDF / EXPORT / PRINT
 * ========================================================= */

/* ---------- โลโก้/ตราประทับสำหรับพิมพ์ลงบนเอกสาร ---------- */
// อ่านไฟล์ภาพของผู้ออกเอกสารแล้วแปลงเป็น data URI เพื่อฝังลงใน HTML ที่สั่งพิมพ์เป็น PDF
// (ต้องฝังเป็น data URI เพราะหน้าพิมพ์อาจถูกเปิดโดยผู้รับที่ไม่มีสิทธิ์เรียกไฟล์ของผู้ออกเอกสาร)
function brandDataUri(user, kind) {
  const meta = user && user[kind === 'seal' ? 'sealFile' : 'logoFile'];
  if (!meta || !meta.storedName) return null;
  try {
    const buf = fs.readFileSync(path.join(store.UPLOAD_DIR, meta.storedName));
    return `data:${meta.mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}
function brandCtx(user) {
  return {
    logo: brandDataUri(user, 'logo'),
    seal: brandDataUri(user, 'seal'),
    branchText: profile.branchLabel(user),
    addressText: profile.formatAddress(user.addr || {}) || user.address || '',
    vatRegistered: !!user.vatRegistered,
    authName: user.authName || '',
    authPosition: user.authPosition || '',
  };
}

api.get('/api/documents/:id/pdf', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return sendHtml(res, 401, '<h2>กรุณาเข้าสู่ระบบก่อน</h2>');
  const doc = await store.find('documents', req.params.id);
  if (!doc || doc.userId !== user.id) return sendHtml(res, 404, '<h2>ไม่พบเอกสาร</h2>');
  const attachments = await store.all('attachments', (a) => a.docId === doc.id);
  const share = await store.findOne('shares', (s) => s.docId === doc.id);
  const ctx = { attachments, brand: brandCtx(user) };
  if (share) ctx.qrSvg = qr.toSVG(verifyUrl(req, share.token), { scale: 2 });
  await logAudit(user.id, doc.id, 'download', `เปิด/พิมพ์ PDF ${doc.docNo}`, user.displayName);
  sendHtml(res, 200, docview.render(doc, user, ctx));
});

async function filteredDocs(req) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.searchParams;
  const type = p.get('type'), status = p.get('status');
  return (await store.all('documents', (d) => d.userId === req.user.id && (!type || d.type === type) && (!status || d.status === status))).reverse();
}
// หัวรายงานที่ผู้ใช้ตั้งค่าเองได้ (ชื่อผู้ประกอบการ เลขผู้เสียภาษี ที่อยู่ สาขา และโลโก้)
function exportBrand(user) {
  return {
    name: user.companyName || user.displayName || '',
    taxId: user.taxId ? thaiid.format(user.taxId) : '',
    address: profile.formatAddress(user.addr || {}) || user.address || '',
    branch: profile.branchLabel(user),
    logo: brandDataUri(user, 'logo'),
  };
}

api.get('/api/export/csv', requireAuth(async (req, res) => {
  const csv = exporter.toCSV(await filteredDocs(req), exportBrand(req.user));
  await logAudit(req.user.id, null, 'export', 'ส่งออก CSV', req.user.displayName);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="taxflow-documents.csv"' });
  res.end(csv);
}));
api.get('/api/export/xls', requireAuth(async (req, res) => {
  const xls = exporter.toXLS(await filteredDocs(req), exportBrand(req.user));
  await logAudit(req.user.id, null, 'export', 'ส่งออก Excel', req.user.displayName);
  res.writeHead(200, { 'Content-Type': 'application/vnd.ms-excel; charset=utf-8', 'Content-Disposition': 'attachment; filename="taxflow-documents.xls"' });
  res.end('\uFEFF' + xls);
}));

/* =========================================================
 *  DOCUMENT LIBRARY (คลังเอกสารตามหมวด — แยกตามบทบาท)
 *  เก็บไฟล์เอกสารราชการ/ธุรกิจ เช่น ภ.ง.ด.90, ภ.พ.20, สัญญาจ้าง ฯลฯ
 * ========================================================= */
const LIB_ALLOWED_MIME = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LIB_MAX_SIZE = 5 * 1024 * 1024; // 5 MB — ให้ตรงกับที่ระบุไว้ในสเปก (โค้ดเดิมเขียนไว้ 10 MB ไม่ตรงกับเอกสาร)

api.get('/api/library', requireAuth(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const category = url.searchParams.get('category');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const rows = (await store.all('library', (l) =>
    l.userId === req.user.id &&
    (!category || l.category === category) &&
    (!q || `${l.title || ''}${l.filename || ''}${l.note || ''}`.toLowerCase().includes(q))
  )).reverse().map((l) => { const { storedName, ...meta } = l; return meta; });
  sendJson(res, 200, { count: rows.length, items: rows });
}));

api.post('/api/library', requireAuth(async (req, res) => {
  const b = await readJsonBody(req);
  if (!b.category) return sendJson(res, 400, { error: 'กรุณาเลือกหมวดเอกสาร' });
  if (!b.dataBase64) return sendJson(res, 400, { error: 'ไม่พบไฟล์' });
  if (!LIB_ALLOWED_MIME[b.mime]) return sendJson(res, 415, { error: 'รองรับเฉพาะไฟล์ PDF, PNG, JPG, WEBP' });
  const buf = Buffer.from(b.dataBase64, 'base64');
  if (buf.length > LIB_MAX_SIZE) return sendJson(res, 413, { error: 'ไฟล์มีขนาดเกิน 5 MB' });
  if (!magicbytes.matches(buf, b.mime)) return sendJson(res, 415, { error: 'ไฟล์ไม่ตรงกับชนิดที่แจ้ง กรุณาอัปโหลดไฟล์จริง' });
  // ข้อ PDPA: ไฟล์ในคลังเอกสาร (เช่น ภ.ง.ด.90) อ่อนไหวพอๆ กับเอกสาร KYC จึงต้องเข้ารหัสแบบเดียวกัน
  const storedName = filestore.writeEncrypted(store.UPLOAD_DIR, buf, LIB_ALLOWED_MIME[b.mime]);
  const row = await store.insert('library', {
    userId: req.user.id, category: b.category,
    title: b.title || b.filename || 'เอกสาร', filename: b.filename || storedName,
    mime: b.mime, size: buf.length, storedName, note: b.note || '',
    year: b.year || String(new Date().getFullYear() + 543),
  });
  await logAudit(req.user.id, null, 'library-add', `เพิ่มเอกสาร "${row.title}" ในคลัง (${b.category})`, req.user.displayName);
  const { storedName: sn, ...meta } = row;
  sendJson(res, 201, meta);
}));

api.get('/api/library/:id/file', requireAuth(async (req, res) => {
  const l = await store.find('library', req.params.id);
  if (!l || l.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบไฟล์' });
  try {
    const buf = filestore.readEncrypted(store.UPLOAD_DIR, l.storedName);
    res.writeHead(200, { 'Content-Type': l.mime, 'Content-Disposition': 'inline; filename="file"', 'Content-Length': buf.length });
    res.end(buf);
  } catch { sendJson(res, 404, { error: 'ไฟล์หาย' }); }
}));

api.delete('/api/library/:id', requireAuth(async (req, res) => {
  const l = await store.find('library', req.params.id);
  if (!l || l.userId !== req.user.id) return sendJson(res, 404, { error: 'ไม่พบไฟล์' });
  filestore.removeFile(store.UPLOAD_DIR, l.storedName);
  await store.remove('library', l.id);
  await logAudit(req.user.id, null, 'library-del', `ลบเอกสาร "${l.title}" จากคลัง`, req.user.displayName);
  sendJson(res, 200, { deleted: true });
}));

/* =========================================================
 *  NOTIFICATIONS
 * ========================================================= */
api.get('/api/notifications', requireAuth(async (req, res) => {
  const items = (await store.all('notifications', (n) => n.userId === req.user.id)).reverse();
  sendJson(res, 200, { items, unread: items.filter((n) => !n.read).length });
}));
api.post('/api/notifications/:id/read', requireAuth(async (req, res) => {
  const n = await store.find('notifications', req.params.id);
  if (!n || n.userId !== req.user.id) return sendJson(res, 404, { error: 'not found' });
  await store.update('notifications', n.id, { read: true }); sendJson(res, 200, { ok: true });
}));
api.post('/api/notifications/read-all', requireAuth(async (req, res) => {
  for (const n of await store.all('notifications', (n) => n.userId === req.user.id && !n.read)) await store.update('notifications', n.id, { read: true });
  sendJson(res, 200, { ok: true });
}));

/* =========================================================
 *  AUDIT LOG (account-wide)
 * ========================================================= */
api.get('/api/audit', requireAuth(async (req, res) => {
  sendJson(res, 200, { items: (await store.all('audit_log', (a) => a.userId === req.user.id)).reverse().slice(0, 200) });
}));

/* =========================================================
 *  SUMMARIES
 * ========================================================= */
function statusCounts(docs) {
  const c = { draft: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0, archived: 0 };
  docs.forEach((d) => { if (c[d.status] !== undefined) c[d.status]++; });
  return c;
}
api.get('/api/creator/summary', requireAuth(async (req, res) => {
  const docs = await store.all('documents', (d) => d.userId === req.user.id && d.type === 'WHT');
  const gross = docs.reduce((s, d) => s + (Number(d.base) || 0), 0);
  const whtPaid = docs.reduce((s, d) => s + (Number(d.wht) || 0), 0);
  sendJson(res, 200, { documentCount: docs.length, grossIncome: round2(gross), withholdingPaid: round2(whtPaid), estimate: tax.estimatePersonalIncomeTax(gross, { withholdingPaid: whtPaid }), status: statusCounts(docs) });
}));
api.get('/api/agency/summary', requireAuth(async (req, res) => {
  const docs = await store.all('documents', (d) => d.userId === req.user.id);
  const etax = docs.filter((d) => d.type === 'ETAX'), ewht = docs.filter((d) => d.type === 'EWHT');
  sendJson(res, 200, {
    counts: { total: etax.length + ewht.length, eTaxInvoice: etax.length, eWithholding: ewht.length },
    totals: { revenue: round2(etax.reduce((s, d) => s + (+d.total || 0), 0)), vat: round2(etax.reduce((s, d) => s + (+d.vat || 0), 0)), expense: round2(ewht.reduce((s, d) => s + (+d.base || 0), 0)), withholding: round2(ewht.reduce((s, d) => s + (+d.wht || 0), 0)) },
    status: statusCounts(docs),
  });
}));

/* =========================================================
 *  STATIC
 * ========================================================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>400 Bad Request</h1>');
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<h1>404</h1><a href="/">กลับหน้าแรก</a>'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ป้องกัน XSS/MIME-sniffing เป็นชั้นที่สอง (defense in depth) — ใช้กับทุก response
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/api/')) {
    try {
      const matched = api.match(req.method, urlPath);
      if (!matched) return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
      if (matched.error) return sendJson(res, matched.error, { error: 'คำขอไม่ถูกต้อง' });
      req.params = matched.params;
      await matched.handler(req, res);
    } catch (err) {
      console.error('API error:', err);
      sendJson(res, err && err.statusCode ? err.statusCode : 500, { error: err && err.statusCode ? err.message : 'เกิดข้อผิดพลาดภายในระบบ' });
    }
    return;
  }
  serveStatic(req, res);
});

// เริ่มระบบ: ต้อง await งาน async ทั้งหมด (ต่อฐานข้อมูล/seed/ล้างข้อมูลหมดอายุ) ให้เสร็จก่อนเปิดรับ request จริง
async function main() {
  await store.ensureReady();
  const seeded = await seedUsers();
  // PDPA มาตรา 37(3): ลบข้อมูลที่พ้นระยะเวลาเก็บรักษาแล้ว — ทำตอนเริ่มระบบและทุก 6 ชั่วโมง
  const purged = await pdpa.purgeExpired(store);
  setInterval(() => { pdpa.purgeExpired(store).catch((e) => console.error('purgeExpired error:', e)); }, 6 * 60 * 60 * 1000).unref();

  server.listen(PORT, () => {
    console.log(`\n  TaxFlow running  ➜  http://localhost:${PORT}`);
    console.log(store.DB_FILE
      ? `  ฐานข้อมูล (SQLite): ${path.relative(process.cwd(), store.DB_FILE)}`
      : `  ฐานข้อมูล (PostgreSQL): ${(process.env.DATABASE_URL || '').replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@')}`);
    console.log(`  คู่มือการใช้งาน: http://localhost:${PORT}/guide.html`);
    console.log(`  ล้างข้อมูลหมดอายุตามนโยบายเก็บรักษา: OTP ${purged.otpRemoved} รายการ, แจ้งเตือน ${purged.notifyRemoved} รายการ, บัญชีที่ไม่ยืนยันอีเมลเกิน 24 ชม. ${purged.unverifiedRemoved || 0} บัญชี`);
    if (seeded.length) {
      console.log(`\n  สร้างบัญชีผู้ใช้ตัวอย่างให้แล้ว (เข้าสู่ระบบเพื่อทดลองได้ทันที):`);
      for (const u of seeded) console.log(`    • ${u.email}  (${u.role})  รหัสผ่าน: ${u.password}`);
    }
    console.log('');
  });
}

main().catch((err) => {
  console.error('เริ่มระบบไม่สำเร็จ:', err);
  process.exit(1);
});
