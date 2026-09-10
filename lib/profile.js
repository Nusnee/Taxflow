'use strict';

/**
 * profile.js — โครงสร้างข้อมูลโปรไฟล์แยกตามบทบาท + การตรวจความครบถ้วน
 * -------------------------------------------------------------
 * บทบาทในระบบ
 *   creator   = อินฟลูเอนเซอร์ / ผู้ผลิตเนื้อหา  (บุคคลธรรมดาเสมอ)
 *   agency    = เอเจนซี่  (เลือกได้ว่าเป็นนิติบุคคล หรือ บุคคลธรรมดา/ฟรีแลนซ์)
 *   corporate = บริษัทผู้ว่าจ้าง / แบรนด์  (นิติบุคคลเสมอ)
 *   admin     = ผู้ดูแลระบบ / ผู้ตรวจสอบเอกสาร
 *
 * หลักการเก็บข้อมูล (PDPA — เก็บเท่าที่จำเป็น / Data Minimisation มาตรา 22)
 *   เก็บเฉพาะข้อมูลที่กฎหมายภาษีบังคับให้ปรากฏบนเอกสาร หรือจำเป็นต่อการจ่ายเงิน
 *   ไม่เก็บ: สำเนาบัตรประชาชน, วันเกิด, เพศ, ศาสนา, หมู่เลือด, สถานภาพสมรส,
 *           ข้อมูลช่องทางโซเชียล และสถิติผู้ติดตาม (ไม่เกี่ยวกับการออกเอกสารภาษี)
 */

const thaiid = require('./thaiid');

const ROLES = ['creator', 'agency', 'corporate', 'admin'];
const ROLE_LABEL = {
  creator: 'อินฟลูเอนเซอร์ / ผู้ผลิตเนื้อหา',
  agency: 'เอเจนซี่',
  corporate: 'บริษัทผู้ว่าจ้าง (แบรนด์)',
  admin: 'ผู้ดูแลระบบ',
};

const COMPANY_TYPES = [
  'บริษัทจำกัด', 'บริษัทมหาชนจำกัด', 'ห้างหุ้นส่วนจำกัด',
  'ห้างหุ้นส่วนสามัญนิติบุคคล', 'อื่น ๆ',
];

const PROVINCES = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง',
  'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์',
  'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
  'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก',
  'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร',
  'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย',
  'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์',
  'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี',
  'อุบลราชธานี',
];

const BANKS = [
  'ธนาคารกรุงเทพ', 'ธนาคารกสิกรไทย', 'ธนาคารไทยพาณิชย์', 'ธนาคารกรุงไทย',
  'ธนาคารกรุงศรีอยุธยา', 'ธนาคารทหารไทยธนชาต (ttb)', 'ธนาคารออมสิน',
  'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)', 'ธนาคารซีไอเอ็มบี ไทย',
  'ธนาคารยูโอบี', 'ธนาคารเกียรตินาคินภัทร', 'ธนาคารแลนด์ แอนด์ เฮ้าส์', 'อื่น ๆ',
];

/* =========================================================
 *  ประเภทเอกสารยืนยันตัวตน (KYC)
 * ========================================================= */
const KYC_TYPES = {
  company_cert: {
    label: 'หนังสือรับรองนิติบุคคล',
    hint: 'คัดสำเนาย้อนหลังไม่เกิน 6 เดือน — ใช้ตรวจสอบชื่อบริษัท กรรมการผู้มีอำนาจ และเลขทะเบียน 13 หลัก',
    purpose: 'ใช้ยืนยันว่านิติบุคคลมีตัวตนจริง และผู้ลงทะเบียนมีอำนาจกระทำการแทน',
  },
  vat_pp20: {
    label: 'ใบทะเบียนภาษีมูลค่าเพิ่ม (ภ.พ.20)',
    hint: 'จำเป็นเมื่อต้องการออกใบกำกับภาษีแบบเต็มรูป',
    purpose: 'ใช้ยืนยันสถานะผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม',
  },
  bank_book: {
    label: 'หน้าสมุดบัญชีธนาคาร',
    hint: 'ชื่อบัญชีต้องตรงกับชื่อผู้ลงทะเบียน — กรุณาปิดทับส่วนที่ไม่เกี่ยวข้องก่อนอัปโหลด',
    purpose: 'ใช้ยืนยันบัญชีรับเงินค่าจ้าง และกรณีคืนเงิน (Refund)',
  },
};

/** เอกสารที่ต้องใช้ตามบทบาท/ประเภทผู้เสียภาษี */
function requiredKyc(user) {
  if (!user || user.role === 'admin') return [];
  const juristic = isJuristic(user);
  const list = [];
  if (juristic) {
    list.push({ type: 'company_cert', required: true });
    list.push({ type: 'vat_pp20', required: !!user.vatRegistered });
  }
  list.push({ type: 'bank_book', required: true });
  return list;
}

function isJuristic(user) {
  if (!user) return false;
  if (user.role === 'corporate') return true;
  if (user.role === 'creator') return user.entityType === 'juristic';
  return user.entityType === 'juristic';
}

/* =========================================================
 *  การทำความสะอาด/ปรับรูปข้อมูลก่อนบันทึก
 * ========================================================= */
const s = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

function normalizeAddress(a = {}) {
  return {
    no: s(a.no, 60),
    street: s(a.street, 120),
    subdistrict: s(a.subdistrict, 80),
    district: s(a.district, 80),
    province: s(a.province, 60),
    postcode: String(a.postcode || '').replace(/\D/g, '').slice(0, 5),
  };
}

/** รวมที่อยู่แบบแยกช่องเป็นบรรทัดเดียว ใช้แสดงบนเอกสาร */
function formatAddress(a = {}) {
  const parts = [];
  if (a.no) parts.push(a.no);
  if (a.street) parts.push(a.street.startsWith('ถ.') || a.street.startsWith('ถนน') ? a.street : 'ถ.' + a.street);
  const isBkk = a.province === 'กรุงเทพมหานคร';
  if (a.subdistrict) parts.push((isBkk ? 'แขวง' : 'ต.') + a.subdistrict);
  if (a.district) parts.push((isBkk ? 'เขต' : 'อ.') + a.district);
  if (a.province) parts.push(isBkk ? a.province : 'จ.' + a.province);
  if (a.postcode) parts.push(a.postcode);
  return parts.join(' ');
}

/** ข้อความระบุสาขาที่กฎหมายบังคับให้แสดงบนใบกำกับภาษีเต็มรูป */
function branchLabel(user) {
  if (!user || !isJuristic(user)) return '';
  if (user.branchType === 'branch') {
    const code = String(user.branchCode || '').replace(/\D/g, '');
    return code ? `สาขาที่ ${code.padStart(5, '0')}` : 'สาขา';
  }
  return 'สำนักงานใหญ่';
}

/**
 * รวมข้อมูลที่ผู้ใช้ส่งมาเข้ากับโปรไฟล์เดิม พร้อมทำความสะอาด
 * คืน { patch, errors }
 */
function buildPatch(user, body) {
  const errors = [];
  const role = user.role;
  const patch = {};

  // ประเภทผู้เสียภาษี — corporate บังคับเป็นนิติบุคคล, creator บังคับเป็นบุคคลธรรมดา
  let entityType = user.entityType || (role === 'corporate' ? 'juristic' : 'individual');
  if (body.entityType && role === 'agency') {
    entityType = body.entityType === 'juristic' ? 'juristic' : 'individual';
  }
  if (role === 'corporate') entityType = 'juristic';
  if (role === 'creator') entityType = 'individual';
  patch.entityType = entityType;
  const juristic = entityType === 'juristic';

  // ชื่อที่แสดงบนเอกสาร
  if (body.displayName !== undefined) patch.displayName = s(body.displayName, 150);
  if (juristic) {
    patch.companyName = s(body.companyName !== undefined ? body.companyName : user.companyName, 150);
    patch.companyType = COMPANY_TYPES.includes(body.companyType) ? body.companyType : (user.companyType || 'บริษัทจำกัด');
    patch.authName = s(body.authName !== undefined ? body.authName : user.authName, 150);
    patch.authPosition = s(body.authPosition !== undefined ? body.authPosition : user.authPosition, 100);
    if (!patch.displayName) patch.displayName = patch.companyName;
  } else {
    patch.companyName = '';
    patch.companyType = '';
    patch.authName = '';
    patch.authPosition = '';
  }

  // เลขประจำตัวผู้เสียภาษี
  if (body.taxId !== undefined) {
    const taxId = thaiid.digitsOnly(body.taxId);
    if (taxId) {
      const msg = thaiid.explain(taxId);
      if (msg) errors.push(msg);
      else patch.taxId = taxId;
    } else {
      patch.taxId = '';
    }
  }

  // สำนักงานใหญ่ / สาขา (บังคับแสดงบนใบกำกับภาษีเต็มรูป)
  if (juristic) {
    patch.branchType = body.branchType === 'branch' ? 'branch' : 'head';
    patch.branchCode = patch.branchType === 'branch'
      ? String(body.branchCode || '').replace(/\D/g, '').slice(0, 5)
      : '';
    if (patch.branchType === 'branch' && !patch.branchCode) {
      errors.push('กรุณาระบุเลขที่สาขา 5 หลัก');
    }
  } else {
    patch.branchType = 'head';
    patch.branchCode = '';
  }

  // ที่อยู่
  if (body.addr !== undefined) {
    const addr = normalizeAddress(body.addr);
    if (addr.postcode && addr.postcode.length !== 5) errors.push('รหัสไปรษณีย์ต้องมี 5 หลัก');
    patch.addr = addr;
    patch.address = formatAddress(addr); // สำรองไว้ให้ส่วนที่เรียกใช้แบบเดิม
  }

  // เบอร์ติดต่อ (ใช้ติดต่อเรื่องเอกสารเท่านั้น ไม่ได้ใช้ส่ง OTP)
  if (body.phone !== undefined) {
    patch.phone = String(body.phone).replace(/[^\d+\-() ]/g, '').trim().slice(0, 25);
  }

  // สถานะภาษีมูลค่าเพิ่ม
  if (body.vatRegistered !== undefined) patch.vatRegistered = !!body.vatRegistered;
  if (body.vatRegDate !== undefined) patch.vatRegDate = s(body.vatRegDate, 20);

  // บัญชีธนาคารสำหรับรับเงิน/คืนเงิน
  if (body.bank !== undefined) {
    const b = body.bank || {};
    patch.bank = {
      bankName: s(b.bankName, 80),
      accountNo: String(b.accountNo || '').replace(/[^\d-]/g, '').slice(0, 25),
      accountName: s(b.accountName, 150),
    };
  }

  return { patch, errors };
}

/* =========================================================
 *  ตรวจความครบถ้วนก่อนอนุญาตให้ออกเอกสาร
 * ========================================================= */

/** ข้อมูลขั้นต่ำที่กฎหมายบังคับให้ปรากฏบนเอกสารภาษี */
function completeness(user) {
  const missing = [];
  if (!user) return { ok: false, missing: ['ไม่พบข้อมูลผู้ใช้'], percent: 0 };
  if (user.role === 'admin') return { ok: true, missing: [], percent: 100 };

  const juristic = isJuristic(user);
  const name = juristic ? user.companyName : user.displayName;
  const addr = user.addr || {};

  const checks = [
    [!!name, juristic ? 'ชื่อนิติบุคคล' : 'ชื่อ-นามสกุล'],
    [!!user.taxId && require('./thaiid').isValidTaxId(user.taxId), 'เลขประจำตัวผู้เสียภาษี 13 หลัก'],
    [!!addr.no, 'ที่อยู่: บ้านเลขที่'],
    [!!addr.subdistrict, 'ที่อยู่: แขวง/ตำบล'],
    [!!addr.district, 'ที่อยู่: เขต/อำเภอ'],
    [!!addr.province, 'ที่อยู่: จังหวัด'],
    [!!addr.postcode, 'ที่อยู่: รหัสไปรษณีย์'],
  ];
  if (juristic) {
    checks.push([user.branchType === 'head' || !!user.branchCode, 'สำนักงานใหญ่/เลขที่สาขา']);
    checks.push([!!user.authName, 'ชื่อกรรมการผู้มีอำนาจลงนาม']);
  }

  for (const [pass, label] of checks) if (!pass) missing.push(label);
  const percent = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { ok: missing.length === 0, missing, percent };
}

/** ตรวจว่าออกเอกสารประเภทนี้ได้หรือไม่ (เช่น ใบกำกับภาษีต้องจด VAT ก่อน) */
function canIssue(user, type) {
  // ข้อ 7: บัญชีที่ยังไม่ผ่านการยืนยันตัวตน (KYC) ห้ามออกเอกสารใดๆ ทั้งสิ้น
  // (เดิม canIssue ไม่ตรวจ verifyStatus เลย บัญชีที่ยังไม่ผ่าน KYC จึงออกเอกสารได้ตามปกติ)
  if (!user || (user.role !== 'admin' && user.verifyStatus !== 'verified')) {
    return {
      ok: false,
      error: 'ออกเอกสารไม่ได้ เนื่องจากบัญชีนี้ยังไม่ผ่านการยืนยันตัวตน (KYC) — กรุณาส่งเอกสารยืนยันตัวตนที่หน้าโปรไฟล์ และรอผู้ดูแลระบบอนุมัติก่อนจึงจะออกเอกสารได้',
    };
  }
  if (type === 'ETAX') {
    if (!user.vatRegistered) {
      return {
        ok: false,
        error: 'ออกใบกำกับภาษีไม่ได้ เนื่องจากบัญชีนี้ยังไม่ได้ระบุว่าเป็นผู้ประกอบการจดทะเบียนภาษีมูลค่าเพิ่ม '
          + '(ตามประมวลรัษฎากร มาตรา 86 ผู้ที่ไม่ได้จดทะเบียน VAT ไม่มีสิทธิออกใบกำกับภาษี) '
          + 'หากจดทะเบียนแล้ว กรุณาไปที่หน้าโปรไฟล์เพื่อเปิดสถานะ VAT และแนบ ภ.พ.20 — '
          + 'หรือเลือกออก "ใบเสร็จรับเงิน" / "ใบแจ้งหนี้" แทนได้',
      };
    }
  }
  const c = completeness(user);
  if (!c.ok) {
    return {
      ok: false,
      error: 'ข้อมูลโปรไฟล์ยังไม่ครบถ้วนตามที่กฎหมายกำหนดสำหรับผู้ออกเอกสาร — ขาด: ' + c.missing.join(', '),
      missing: c.missing,
    };
  }
  return { ok: true };
}

/** ค่าเริ่มต้นของโปรไฟล์เมื่อสร้างบัญชีใหม่ */
function defaults(role) {
  return {
    entityType: role === 'corporate' ? 'juristic' : 'individual',
    companyName: '', companyType: '', authName: '', authPosition: '',
    taxId: '', branchType: 'head', branchCode: '',
    addr: normalizeAddress({}), address: '', phone: '',
    vatRegistered: false, vatRegDate: '',
    bank: { bankName: '', accountNo: '', accountName: '' },
    logoFile: null, sealFile: null,
    verifyStatus: 'unverified', verifyNote: '', verifiedAt: null,
    emailVerified: false,
    tokenVersion: 0, // เพิ่มค่านี้เมื่อ logout-all หรือลบบัญชี เพื่อเพิกถอน session เดิมทั้งหมดทันที
  };
}

/* =========================================================
 *  การปิดบังข้อมูลก่อนแสดงผล (PDPA)
 * ========================================================= */
function maskAccountNo(no) {
  const d = String(no || '').replace(/\D/g, '');
  if (d.length < 4) return d ? '****' : '';
  return '*'.repeat(Math.max(0, d.length - 4)) + d.slice(-4);
}

module.exports = {
  ROLES, ROLE_LABEL, COMPANY_TYPES, PROVINCES, BANKS,
  KYC_TYPES, requiredKyc, isJuristic,
  normalizeAddress, formatAddress, branchLabel,
  buildPatch, completeness, canIssue, defaults, maskAccountNo,
};
