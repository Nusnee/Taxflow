'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const thaiid = require('../lib/thaiid');

test('isValidTaxId — เลขที่ถูกต้องตามสูตร check digit ต้องผ่าน', () => {
  assert.equal(thaiid.isValidTaxId('1100700123455'), true);
  assert.equal(thaiid.isValidTaxId('0105561112235'), true);
});

test('isValidTaxId — check digit ผิดต้องไม่ผ่าน', () => {
  assert.equal(thaiid.isValidTaxId('1234567890123'), false);
});

test('isValidTaxId — เลขซ้ำกันทั้ง 13 หลักต้องไม่ผ่าน (เช่น 1111111111111)', () => {
  assert.equal(thaiid.isValidTaxId('1111111111111'), false);
});

test('isValidTaxId — ความยาวไม่ครบ 13 หลักต้องไม่ผ่าน', () => {
  assert.equal(thaiid.isValidTaxId('110070012345'), false);
  assert.equal(thaiid.isValidTaxId(''), false);
});

test('digitsOnly — ตัดอักขระที่ไม่ใช่ตัวเลขออกทั้งหมด', () => {
  assert.equal(thaiid.digitsOnly('1-1007-00123-45-5'), '1100700123455');
  assert.equal(thaiid.digitsOnly(null), '');
});

test('explain — ข้อความ error ต้องว่างเมื่อเลขถูกต้อง', () => {
  assert.equal(thaiid.explain('1100700123455'), '');
});

test('explain — ต้องมีข้อความ error เมื่อเลขผิด', () => {
  assert.notEqual(thaiid.explain('123'), '');
  assert.notEqual(thaiid.explain(''), '');
});

test('format — จัดรูปแบบ 0-1055-61112-23-5 ให้อ่านง่าย', () => {
  assert.equal(thaiid.format('1100700123455'), '1-1007-00123-45-5');
});

test('mask — ปิดบังตัวเลขตรงกลาง เหลือหลักแรกและหลักสุดท้าย', () => {
  const masked = thaiid.mask('1100700123455');
  assert.equal(masked, '1-1007-*****-**-5');
  assert.ok(!masked.includes('00123'));
});
