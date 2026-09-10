'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const tax = require('../lib/tax');

test('calcWithholding — คำนวณภาษีหัก ณ ที่จ่ายพื้นฐาน', () => {
  const r = tax.calcWithholding(10000, 3);
  assert.equal(r.base, 10000);
  assert.equal(r.rate, 3);
  assert.equal(r.wht, 300);
  assert.equal(r.net, 9700);
});

test('calcWithholding — ค่าว่าง/ไม่ใช่ตัวเลขต้องไม่พัง คืน 0', () => {
  const r = tax.calcWithholding(undefined, undefined);
  assert.equal(r.base, 0);
  assert.equal(r.wht, 0);
  assert.equal(r.net, 0);
});

test('calcVat — คำนวณ VAT 7% พื้นฐาน', () => {
  const r = tax.calcVat(1000, 7);
  assert.equal(r.base, 1000);
  assert.equal(r.vat, 70);
  assert.equal(r.total, 1070);
});

test('calcPersonalIncomeTax — เงินได้สุทธิไม่เกิน 150,000 ไม่เสียภาษี', () => {
  const r = tax.calcPersonalIncomeTax(100000);
  assert.equal(r.totalTax, 0);
});

test('calcPersonalIncomeTax — ขั้นบันไดคำนวณถูกต้องที่ 400,000', () => {
  // 0-150,000 = 0%, 150,000-300,000 = 5% (7,500), 300,000-400,000 = 10% (10,000)
  const r = tax.calcPersonalIncomeTax(400000);
  assert.equal(r.totalTax, 17500);
});

test('estimatePersonalIncomeTax — มาตรา 40(2) หักค่าใช้จ่าย 50% เพดาน 100,000', () => {
  const r = tax.estimatePersonalIncomeTax(500000, { incomeType: '40(2)' });
  assert.equal(r.incomeType, '40(2)');
  assert.equal(r.expense, 100000); // 50% ของ 500,000 = 250,000 แต่ถูกเพดานที่ 100,000
});

test('estimatePersonalIncomeTax — มาตรา 40(8) หักค่าใช้จ่าย 60% ไม่มีเพดาน', () => {
  const r = tax.estimatePersonalIncomeTax(500000, { incomeType: '40(8)' });
  assert.equal(r.incomeType, '40(8)');
  assert.equal(r.expense, 300000); // 60% ของ 500,000 ไม่ถูกเพดาน
});

test('estimatePersonalIncomeTax — หักภาษีที่จ่ายไปแล้วออกจากยอดที่ต้องชำระ (balance)', () => {
  const r = tax.estimatePersonalIncomeTax(500000, { incomeType: '40(2)', withholdingPaid: 5000 });
  assert.equal(r.balance, r.totalTax - 5000);
});

test('estimatePersonalIncomeTax — รายได้ 0 ไม่ทำให้เกิด error หรือค่าติดลบผิดปกติ', () => {
  const r = tax.estimatePersonalIncomeTax(0);
  assert.equal(r.netIncome, 0);
  assert.equal(r.totalTax, 0);
});
