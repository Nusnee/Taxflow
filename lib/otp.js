'use strict';

/**
 * otp.js — ระบบรหัสยืนยันตัวตนแบบครั้งเดียว (One-Time Password)
 * -------------------------------------------------------------
 * ใช้ 3 จุดในระบบ:
 *   1) ขั้นตอนสมัครสมาชิก   (purpose = 'register')  — ยืนยันว่าอีเมลเป็นของผู้สมัครจริง
 *   2) ขั้นตอนเข้าสู่ระบบ    (purpose = 'login')
 *   3) ขั้นตอนการลงนามเอกสาร (purpose = 'sign-doc' / 'sign-request')
 *
 * ช่องทางส่งรหัส (channel)
 *   ระบบออกแบบให้รองรับหลายช่องทาง แต่เปิดใช้จริงเฉพาะ 'email'
 *   ช่องทาง 'sms' ทำไว้เป็นโครงสร้างเท่านั้น ยังไม่เปิดใช้ เหตุผล:
 *     - ต้องเรียก API ของผู้ให้บริการภายนอก ซึ่งขัดกับข้อกำหนดไม่ใช้ dependency ภายนอก
 *     - มีค่าใช้จ่ายรายข้อความและต้องจดทะเบียนชื่อผู้ส่งในนามนิติบุคคล
 *     - เบอร์โทรศัพท์เป็นข้อมูลส่วนบุคคลเพิ่มเติมที่ระบบยังไม่มีความจำเป็นต้องเก็บ
 *   กรณีที่ SMS เหมาะกว่าอีเมล (บันทึกไว้เป็นข้อเสนอแนะการพัฒนาต่อ):
 *     เปลี่ยนอีเมล/กู้คืนบัญชี, เปลี่ยนเลขบัญชีธนาคารรับเงิน, ลงนามเอกสารมูลค่าสูง
 *     เพราะทั้งสามกรณีควรยืนยันผ่านช่องทางที่แยกจากช่องทางที่ใช้เข้าสู่ระบบ
 *
 * เก็บเฉพาะ "แฮช" ของรหัส ไม่เก็บรหัสจริงลงฐานข้อมูล
 * รหัสมีอายุ 5 นาที, กรอกผิดได้ไม่เกิน 5 ครั้ง, ขอรหัสใหม่ได้ทุก 45 วินาที
 */

const crypto = require('crypto');
const store = require('./store');

const OTP_TTL_MS = 5 * 60 * 1000;       // อายุรหัส 5 นาที
const RESEND_COOLDOWN_MS = 45 * 1000;   // ขอรหัสใหม่ได้ทุก 45 วินาที
const MAX_ATTEMPTS = 5;                 // กรอกผิดได้สูงสุด 5 ครั้ง
const CHANNELS = ['email', 'sms'];      // ช่องทางที่รองรับ (เปิดใช้จริงเฉพาะ email)
const ACTIVE_CHANNELS = ['email'];      // ช่องทางที่เปิดใช้งานจริงในเวอร์ชันนี้

function genCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** สร้างรหัส OTP ใหม่ 1 ชุด คืนค่า { id, code } — code จะถูกส่งอีเมลแล้วทิ้ง ไม่เก็บซ้ำ */
function createOtp(userId, purpose, refId, channel = 'email') {
  const code = genCode();
  const now = Date.now();
  const row = store.insert('otp_codes', {
    userId, purpose, refId: refId != null ? String(refId) : null,
    channel: CHANNELS.includes(channel) ? channel : 'email',
    codeHash: hashCode(code),
    attempts: 0,
    consumed: false,
    lastSentAt: now,
    expiresAt: now + OTP_TTL_MS,
  });
  return { id: row.id, code };
}

function canResend(row) {
  return Date.now() - (row.lastSentAt || 0) > RESEND_COOLDOWN_MS;
}

/** ออกรหัสใหม่ให้ otp เดิม (กรณีกด "ส่งรหัสอีกครั้ง") */
function regenerate(otpId) {
  const row = store.find('otp_codes', otpId);
  if (!row || row.consumed) return null;
  if (!canResend(row)) {
    return { throttled: true, waitSec: Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - row.lastSentAt)) / 1000) };
  }
  const code = genCode();
  const now = Date.now();
  store.update('otp_codes', row.id, {
    codeHash: hashCode(code), attempts: 0, lastSentAt: now, expiresAt: now + OTP_TTL_MS,
  });
  return { code };
}

/**
 * ตรวจสอบรหัส OTP — ใช้แล้วจะ "เผาทิ้ง" ทันที (ใช้ซ้ำไม่ได้)
 * เงื่อนไขเสริม userId/purpose/refId ป้องกันการสวมรอยใช้ otpId ของรายการอื่น
 */
function verify(otpId, code, { userId, purpose, refId } = {}) {
  const row = store.find('otp_codes', otpId);
  if (!row) return { ok: false, error: 'ไม่พบรายการยืนยันตัวตนนี้ กรุณาขอรหัสใหม่' };
  if (row.consumed) return { ok: false, error: 'รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่' };
  if (Date.now() > row.expiresAt) return { ok: false, error: 'รหัส OTP หมดอายุ กรุณาขอรหัสใหม่' };
  if (userId != null && row.userId !== userId) return { ok: false, error: 'รายการยืนยันตัวตนไม่ถูกต้อง' };
  if (purpose && row.purpose !== purpose) return { ok: false, error: 'รายการยืนยันตัวตนไม่ถูกต้อง' };
  if (refId !== undefined && String(row.refId || '') !== String(refId ?? '')) {
    return { ok: false, error: 'รายการยืนยันตัวตนไม่ถูกต้อง' };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: 'กรอกรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่' };
  if (!code || hashCode(code) !== row.codeHash) {
    store.update('otp_codes', row.id, { attempts: row.attempts + 1 });
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, error: `รหัส OTP ไม่ถูกต้อง${left > 0 ? ` (เหลืออีก ${left} ครั้ง)` : ''}` };
  }
  store.update('otp_codes', row.id, { consumed: true });
  return { ok: true, otp: row };
}

module.exports = { createOtp, regenerate, verify, canResend, CHANNELS, ACTIVE_CHANNELS };
