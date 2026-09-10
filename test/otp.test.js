'use strict';

// ตั้ง TAXFLOW_DATA_DIR ไปที่โฟลเดอร์ชั่วคราวก่อน require store/otp เสมอ
// เพื่อไม่ให้ test แตะฐานข้อมูลจริงของระบบใน data/taxflow.db
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taxflow-otp-test-'));
process.env.TAXFLOW_DATA_DIR = TMP_DIR;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const otp = require('../lib/otp');

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test('createOtp — สร้างรหัส 6 หลัก', () => {
  const { id, code } = otp.createOtp(1, 'login', null);
  assert.match(code, /^\d{6}$/);
  assert.ok(id);
});

test('verify — รหัสถูกต้องต้องผ่าน และใช้ซ้ำไม่ได้ (เผาทิ้งทันที)', () => {
  const { id, code } = otp.createOtp(1, 'login', null);
  const first = otp.verify(id, code, { purpose: 'login' });
  assert.equal(first.ok, true);
  const second = otp.verify(id, code, { purpose: 'login' });
  assert.equal(second.ok, false);
});

test('verify — รหัสผิดต้องไม่ผ่าน', () => {
  const { id, code } = otp.createOtp(2, 'login', null);
  const wrongCode = code === '000000' ? '111111' : '000000';
  const r = otp.verify(id, wrongCode, { purpose: 'login' });
  assert.equal(r.ok, false);
});

test('verify — กรอกผิดครบ 5 ครั้งต้องล็อก แม้รหัสถูกก็ไม่ผ่านอีก', () => {
  const { id, code } = otp.createOtp(3, 'login', null);
  const wrongCode = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) otp.verify(id, wrongCode, { purpose: 'login' });
  const r = otp.verify(id, code, { purpose: 'login' });
  assert.equal(r.ok, false);
});

test('verify — purpose ไม่ตรงกับตอนสร้างต้องไม่ผ่าน (กันสวมรอย otpId ข้ามรายการ)', () => {
  const { id, code } = otp.createOtp(4, 'sign-doc', '99');
  const r = otp.verify(id, code, { purpose: 'login' });
  assert.equal(r.ok, false);
});

test('verify — refId ไม่ตรงต้องไม่ผ่าน', () => {
  const { id, code } = otp.createOtp(5, 'sign-doc', '10');
  const r = otp.verify(id, code, { purpose: 'sign-doc', refId: '20' });
  assert.equal(r.ok, false);
});

test('verify — otpId ที่ไม่มีอยู่จริงต้องไม่ผ่าน', () => {
  const r = otp.verify(999999, '123456', { purpose: 'login' });
  assert.equal(r.ok, false);
});

test('regenerate — ขอรหัสใหม่ทันทีหลังสร้าง (ยังไม่ครบ cooldown 45 วิ) ต้องถูก throttle', () => {
  const { id } = otp.createOtp(6, 'login', null);
  const r = otp.regenerate(id);
  assert.equal(r.throttled, true);
  assert.ok(r.waitSec > 0);
});

test('regenerate — otp ที่ใช้ไปแล้ว (consumed) ขอรหัสใหม่ไม่ได้', () => {
  const { id, code } = otp.createOtp(7, 'login', null);
  otp.verify(id, code, { purpose: 'login' });
  const r = otp.regenerate(id);
  assert.equal(r, null);
});
