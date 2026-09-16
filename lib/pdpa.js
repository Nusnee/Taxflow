'use strict';

/**
 * pdpa.js — การจัดการตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
 * -------------------------------------------------------------
 * ครอบคลุม
 *   1) ความยินยอมแบบแยกวัตถุประสงค์ (มาตรา 19 วรรคสาม — ต้องแยกส่วนชัดเจน
 *      ไม่รวมเป็นการยินยอมเหมารวม และต้องถอนความยินยอมได้ง่ายเท่ากับตอนให้)
 *   2) สิทธิเจ้าของข้อมูล — ขอสำเนาข้อมูล (มาตรา 30) และขอลบ (มาตรา 33)
 *   3) ระยะเวลาเก็บรักษาและการลบข้อมูลที่หมดความจำเป็น (มาตรา 37(3))
 *
 * หมายเหตุสำคัญเรื่องสิทธิขอลบ:
 *   เอกสารทางภาษีมีกฎหมายอื่นบังคับให้เก็บ (ประมวลรัษฎากร มาตรา 87/3 กำหนดให้
 *   เก็บรายงานและเอกสารประกอบไม่น้อยกว่า 5 ปี) จึงเป็นข้อยกเว้นตามมาตรา 33 วรรคท้าย
 *   ระบบจึงลบ "ข้อมูลระบุตัวตน" ได้ แต่ยังคงเอกสารภาษีไว้ในรูปแบบที่ไม่ระบุตัวบุคคล
 */

const CONSENT_VERSION = '1.0 (2569-01)';

/** วัตถุประสงค์ที่ขอความยินยอม — แยกกันชัดเจน ไม่บังคับเหมารวม */
const PURPOSES = [
  {
    key: 'service',
    required: true,
    label: 'ใช้ข้อมูลเพื่อให้บริการจัดทำและจัดเก็บเอกสารภาษี',
    detail: 'ชื่อ เลขประจำตัวผู้เสียภาษี ที่อยู่ และสถานะ VAT จะถูกนำไปแสดงบนเอกสารที่คุณออก '
      + 'เพราะเป็นรายการที่ประมวลรัษฎากรบังคับให้ปรากฏ หากไม่ยินยอมจะไม่สามารถออกเอกสารได้',
  },
  {
    key: 'identity',
    required: true,
    label: 'ใช้อีเมลเพื่อยืนยันตัวตนด้วยรหัส OTP',
    detail: 'ใช้ตอนสมัครสมาชิก เข้าสู่ระบบ และก่อนลงลายมือชื่อดิจิทัลทุกครั้ง '
      + 'ระบบเก็บเฉพาะค่าแฮชของรหัส ไม่เก็บตัวรหัสจริง',
  },
  {
    key: 'kyc',
    required: false,
    label: 'จัดเก็บเอกสารยืนยันตัวตนเพื่อให้ผู้ดูแลระบบตรวจสอบ',
    detail: 'หนังสือรับรองนิติบุคคล ภ.พ.20 และหน้าสมุดบัญชีธนาคาร จะถูกเข้ารหัสก่อนจัดเก็บ '
      + 'และเปิดดูได้เฉพาะเจ้าของบัญชีกับผู้ตรวจสอบเท่านั้น ทุกครั้งที่มีการเปิดดูจะถูกบันทึกไว้ '
      + 'ไม่ยินยอมก็ใช้งานระบบได้ แต่บัญชีจะไม่ได้รับสถานะ "ยืนยันตัวตนแล้ว"',
  },
  {
    key: 'notify',
    required: false,
    label: 'ส่งอีเมลแจ้งเตือนความเคลื่อนไหวของเอกสาร',
    detail: 'เช่น มีคู่ค้าส่งคำขอลงนามเข้ามา หรือเอกสารได้รับการอนุมัติแล้ว ถอนความยินยอมได้ทุกเมื่อ',
  },
];

const REQUIRED_KEYS = PURPOSES.filter((p) => p.required).map((p) => p.key);

/** ตรวจว่าความยินยอมที่ส่งมาครบตามที่จำเป็นหรือไม่ */
function validateConsent(given) {
  const list = Array.isArray(given) ? given : [];
  const missing = REQUIRED_KEYS.filter((k) => !list.includes(k));
  if (missing.length) {
    const labels = PURPOSES.filter((p) => missing.includes(p.key)).map((p) => p.label);
    return { ok: false, error: 'กรุณายินยอมในข้อที่จำเป็นต่อการให้บริการก่อน: ' + labels.join(' / ') };
  }
  const valid = PURPOSES.map((p) => p.key);
  return { ok: true, purposes: list.filter((k) => valid.includes(k)) };
}

/** สร้างบันทึกความยินยอม (ไม่เก็บ IP address เพื่อลดข้อมูลส่วนบุคคลที่ไม่จำเป็น) */
function makeConsentRecord(purposes) {
  return { version: CONSENT_VERSION, purposes, at: new Date().toISOString() };
}

/**
 * รวบรวมข้อมูลทั้งหมดของผู้ใช้เพื่อใช้สิทธิขอสำเนา (มาตรา 30)
 * ตัดข้อมูลที่เป็นความลับด้านความปลอดภัยออก (แฮชรหัสผ่าน, ชื่อไฟล์จริงบนดิสก์)
 */
async function buildDataExport(store, user) {
  const strip = (o, keys) => {
    const c = { ...o };
    for (const k of keys) delete c[k];
    return c;
  };
  const uid = user.id;
  const [documents, contacts, kycDocs, library, signatures, notifications, auditLog, consents] = await Promise.all([
    store.all('documents', (d) => d.userId === uid),
    store.all('contacts', (c) => c.userId === uid),
    store.all('kyc_documents', (k) => k.userId === uid),
    store.all('library', (l) => l.userId === uid),
    store.all('signatures', (s) => s.userId === uid),
    store.all('notifications', (n) => n.userId === uid),
    store.all('audit_log', (a) => a.userId === uid),
    store.all('consents', (c) => c.userId === uid),
  ]);
  return {
    ส่งออกเมื่อ: new Date().toISOString(),
    หมายเหตุ: 'ไฟล์นี้เป็นสำเนาข้อมูลส่วนบุคคลของคุณตามมาตรา 30 แห่ง พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
    บัญชีผู้ใช้: strip(user, ['passwordHash']),
    เอกสารที่ออก: documents,
    สมุดคู่ค้า: contacts,
    เอกสารยืนยันตัวตน: kycDocs.map((k) => strip(k, ['storedName'])),
    คลังเอกสาร: library.map((l) => strip(l, ['storedName'])),
    ลายเซ็นที่บันทึกไว้: signatures.map((s) => strip(s, ['dataUrl'])),
    การแจ้งเตือน: notifications,
    บันทึกการใช้งาน: auditLog,
    บันทึกความยินยอม: consents,
  };
}

/* ---------- ระยะเวลาเก็บรักษา ---------- */
const OTP_RETENTION_MS = 24 * 60 * 60 * 1000;      // เก็บ OTP ที่ใช้/หมดอายุแล้วไม่เกิน 24 ชม.
const NOTIFY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // แจ้งเตือนที่อ่านแล้วเก็บ 90 วัน
const UNVERIFIED_ACCOUNT_RETENTION_MS = 24 * 60 * 60 * 1000; // บัญชีที่ยังไม่ยืนยันอีเมลเกิน 24 ชม. ให้ลบทิ้ง

/**
 * ล้างข้อมูลที่หมดความจำเป็นแล้ว — เรียกตอนเซิร์ฟเวอร์เริ่มทำงานและทุก 6 ชั่วโมง
 * ไม่แตะเอกสารภาษี เพราะมีกฎหมายอื่นบังคับให้เก็บ 5 ปี
 */
async function purgeExpired(store) {
  const now = Date.now();
  let otpRemoved = 0;
  let notifyRemoved = 0;
  let unverifiedRemoved = 0;

  for (const row of await store.all('otp_codes')) {
    const done = row.consumed || (row.expiresAt && now > row.expiresAt);
    const old = now - new Date(row.createdAt || 0).getTime() > OTP_RETENTION_MS;
    if (done && old) { await store.remove('otp_codes', row.id); otpRemoved++; }
  }
  for (const row of await store.all('notifications', (n) => n.read)) {
    if (now - new Date(row.at || row.createdAt || 0).getTime() > NOTIFY_RETENTION_MS) {
      await store.remove('notifications', row.id); notifyRemoved++;
    }
  }
  // บัญชีที่สมัครแล้วไม่ยืนยันอีเมลภายใน 24 ชม. ให้ลบทิ้ง (ไม่ใช่ anonymize เพราะยังไม่เคยมีสิทธิ์เข้าระบบ
  // จึงไม่มีเอกสารภาษี/ข้อมูลอื่นผูกอยู่) เพื่อปลดอีเมลและเลขผู้เสียภาษีที่ถูกจองไว้ตลอดกาลคืนให้คนอื่นสมัครได้
  for (const row of await store.all('users', (u) => !u.emailVerified && !u.deleted)) {
    if (now - new Date(row.createdAt || 0).getTime() > UNVERIFIED_ACCOUNT_RETENTION_MS) {
      for (const t of ['contacts', 'signatures', 'notifications', 'otp_codes', 'documents', 'kyc_documents']) {
        for (const r of await store.all(t, (x) => x.userId === row.id)) await store.remove(t, r.id);
      }
      await store.remove('users', row.id);
      unverifiedRemoved++;
    }
  }
  return { otpRemoved, notifyRemoved, unverifiedRemoved };
}

module.exports = {
  CONSENT_VERSION, PURPOSES, validateConsent, makeConsentRecord,
  buildDataExport, purgeExpired,
};
