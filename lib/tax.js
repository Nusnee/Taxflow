'use strict';

/**
 * tax.js — โมดูลคำนวณภาษี (หลักเกณฑ์กรมสรรพากร ประเทศไทย)
 * รวมตรรกะไว้ที่เดียวเพื่อทดสอบและปรับปรุงตามกฎหมายล่าสุดได้ง่าย
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ภาษีหัก ณ ที่จ่าย
function calcWithholding(amount, rate = 3) {
  const base = Number(amount) || 0;
  const r = Number(rate) || 0;
  const wht = round2((base * r) / 100);
  return { base: round2(base), rate: r, wht, net: round2(base - wht) };
}

// ภาษีมูลค่าเพิ่ม (VAT)
function calcVat(amount, rate = 7) {
  const base = Number(amount) || 0;
  const r = Number(rate) || 0;
  const vat = round2((base * r) / 100);
  return { base: round2(base), rate: r, vat, total: round2(base + vat) };
}

// อัตราภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได
const PIT_BRACKETS = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 5 },
  { upTo: 500000, rate: 10 },
  { upTo: 750000, rate: 15 },
  { upTo: 1000000, rate: 20 },
  { upTo: 2000000, rate: 25 },
  { upTo: 5000000, rate: 30 },
  { upTo: Infinity, rate: 35 },
];

function calcPersonalIncomeTax(netIncome) {
  let income = Number(netIncome) || 0;
  let remaining = income;
  let prevCap = 0;
  let totalTax = 0;
  const steps = [];
  for (const b of PIT_BRACKETS) {
    if (remaining <= 0) break;
    const span = b.upTo - prevCap;
    const taxable = Math.min(remaining, span);
    const taxInStep = round2((taxable * b.rate) / 100);
    if (taxable > 0) {
      steps.push({
        range: `${prevCap.toLocaleString()} - ${b.upTo === Infinity ? 'ขึ้นไป' : b.upTo.toLocaleString()}`,
        rate: b.rate, taxable: round2(taxable), tax: taxInStep,
      });
    }
    totalTax += taxInStep;
    remaining -= taxable;
    prevCap = b.upTo;
  }
  return {
    netIncome: round2(income),
    totalTax: round2(totalTax),
    effectiveRate: income > 0 ? round2((totalTax / income) * 100) : 0,
    steps,
  };
}

// อัตราหักค่าใช้จ่ายแบบเหมาตามประเภทเงินได้ — มาตรา 40(2) (ค่าจ้าง/ค่านายหน้า) หักได้ 50% ไม่เกิน 100,000 บาท
// ส่วน 40(8) (รับจ้างทำของ/ธุรกิจอิสระ กรณีทั่วไป) หักได้ 60% ไม่มีเพดาน ตามประกาศอธิบดีกรมสรรพากรฯ
// (เป็นค่าเหมาสำหรับระบบต้นแบบ — ผู้ใช้ปรับ expenseRate/expenseCap เองได้ถ้าเงินได้เข้าเงื่อนไขพิเศษอื่น)
const INCOME_TYPE_DEFAULTS = {
  '40(2)': { rate: 50, cap: 100000 },
  '40(8)': { rate: 60, cap: Infinity },
};

function estimatePersonalIncomeTax(grossIncome, opts = {}) {
  const gross = Number(grossIncome) || 0;
  const incomeType = opts.incomeType === '40(8)' ? '40(8)' : '40(2)';
  const defaults = INCOME_TYPE_DEFAULTS[incomeType];
  const expenseRate = opts.expenseRate ?? defaults.rate;
  const expenseCap = opts.expenseCap ?? defaults.cap;
  const personalAllowance = opts.personalAllowance ?? 60000;
  const extraDeductions = opts.extraDeductions ?? 0;
  // ภาษีที่ถูกหัก ณ ที่จ่ายไว้แล้วระหว่างปี — ใช้หักลบจากภาษีที่คำนวณได้ เพื่อบอกว่าต้องชำระเพิ่มหรือได้คืน
  const withholdingPaid = round2(Number(opts.withholdingPaid) || 0);
  const expense = Math.min(round2((gross * expenseRate) / 100), expenseCap);
  const netIncome = Math.max(0, round2(gross - expense - personalAllowance - extraDeductions));
  const calc = calcPersonalIncomeTax(netIncome);
  const balance = round2(calc.totalTax - withholdingPaid); // บวก = ต้องชำระเพิ่ม, ลบ (หรือ 0) = ได้คืนภาษี
  return {
    grossIncome: round2(gross), incomeType, expense, expenseRate, personalAllowance, extraDeductions,
    withholdingPaid, ...calc, balance,
  };
}

module.exports = { calcWithholding, calcVat, calcPersonalIncomeTax, estimatePersonalIncomeTax, PIT_BRACKETS };
