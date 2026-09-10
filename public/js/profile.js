/**
 * profile.js — หน้าโปรไฟล์แบบละเอียดตามบทบาท (ใช้ร่วมกันทั้ง creator.html และ agency.html)
 * -------------------------------------------------------------
 * แบ่งเป็น 5 กลุ่ม
 *   1. ข้อมูลผู้เสียภาษี  — ชื่อ/นิติบุคคล เลข 13 หลัก สาขา VAT
 *   2. ที่อยู่และการติดต่อ
 *   3. บัญชีธนาคาร
 *   4. โลโก้และตราประทับสำหรับพิมพ์บนเอกสาร
 *   5. เอกสารยืนยันตัวตน + ความเป็นส่วนตัว (PDPA)
 *
 * ทุกฟิลด์สร้างจาก /api/meta/profile-options จึงไม่ต้องเขียนรายการจังหวัด/ธนาคารซ้ำในไฟล์ HTML
 */

let PF_META = null;   // ตัวเลือกจากเซิร์ฟเวอร์
let PF_USER = null;   // ข้อมูลผู้ใช้ล่าสุด
let PF_INFO = null;   // ความครบถ้วน + เอกสารที่ต้องใช้

const pfq = (id) => document.getElementById(id);
const pfv = (id) => (pfq(id) ? pfq(id).value.trim() : '');

/* =========================================================
 *  เริ่มต้น
 * ========================================================= */
async function initProfile(user) {
  PF_USER = user;
  PF_META = await api.get('/api/meta/profile-options');
  const root = pfq('profile-root');
  if (!root) return;
  root.innerHTML = profileHtml();
  fillProfileForm();
  await refreshKyc();
}

function isJuristic() {
  if (!PF_USER) return false;
  if (PF_USER.role === 'corporate') return true;
  return PF_USER.entityType === 'juristic';
}

/* =========================================================
 *  โครงหน้า
 * ========================================================= */
function profileHtml() {
  const juristic = isJuristic();
  const canPickEntity = PF_USER.role === 'agency';
  const provOpts = '<option value="">— เลือกจังหวัด —</option>' + PF_META.provinces.map((p) => `<option>${p}</option>`).join('');
  const bankOpts = '<option value="">— เลือกธนาคาร —</option>' + PF_META.banks.map((b) => `<option>${b}</option>`).join('');
  const typeOpts = PF_META.companyTypes.map((c) => `<option>${c}</option>`).join('');

  return `
  <div id="pf-status-bar"></div>

  <div class="two-col-wide">
    <div>
      <!-- 1. ข้อมูลผู้เสียภาษี -->
      <div class="panel">
        <div class="panel-title">ข้อมูลผู้เสียภาษี</div>
        <div class="panel-sub">ข้อมูลชุดนี้จะถูกพิมพ์ลงบนเอกสารทุกฉบับในฐานะ "ผู้ออกเอกสาร"</div>

        ${canPickEntity ? `
        <div class="field">
          <label>ประเภทผู้เสียภาษี</label>
          <div class="seg">
            <label><input type="radio" name="pf-entity" value="juristic" ${juristic ? 'checked' : ''} onchange="onPfEntityChange()"><span>นิติบุคคล</span></label>
            <label><input type="radio" name="pf-entity" value="individual" ${!juristic ? 'checked' : ''} onchange="onPfEntityChange()"><span>บุคคลธรรมดา / ฟรีแลนซ์</span></label>
          </div>
          <div class="hint">การเปลี่ยนประเภทจะทำให้รายการเอกสารยืนยันตัวตนที่ต้องใช้เปลี่ยนตามไปด้วย</div>
        </div>` : ''}

        <div class="field"><label id="pf-name-label">ชื่อ-นามสกุล</label><input id="pf-name"></div>

        <div class="field ${juristic ? '' : 'hidden'}" id="pf-f-companytype">
          <label>ประเภทนิติบุคคล</label><select id="pf-companytype">${typeOpts}</select>
        </div>

        <div class="field">
          <label>เลขประจำตัวผู้เสียภาษี (13 หลัก)</label>
          <input id="pf-taxid" inputmode="numeric" maxlength="13">
          <div class="hint">ระบบเก็บเฉพาะตัวเลข 13 หลัก ไม่มีการขอสำเนาบัตรประชาชน</div>
        </div>

        <div class="two ${juristic ? '' : 'hidden'}" id="pf-f-branch">
          <div class="field">
            <label>สำนักงานใหญ่ / สาขา</label>
            <select id="pf-branchtype" onchange="onPfBranchChange()">
              <option value="head">สำนักงานใหญ่</option>
              <option value="branch">สาขา</option>
            </select>
          </div>
          <div class="field"><label>เลขที่สาขา (5 หลัก)</label><input id="pf-branchcode" inputmode="numeric" maxlength="5"></div>
        </div>

        <div class="field ${juristic ? '' : 'hidden'}" id="pf-f-auth">
          <label>กรรมการผู้มีอำนาจลงนาม</label>
          <input id="pf-authname" placeholder="ชื่อตามหนังสือรับรองนิติบุคคล">
          <input id="pf-authpos" placeholder="ตำแหน่ง" style="margin-top:8px">
        </div>

        <div class="field">
          <label>สถานะภาษีมูลค่าเพิ่ม (VAT)</label>
          <div class="seg">
            <label><input type="radio" name="pf-vat" value="no" onchange="onPfVatChange()"><span>ยังไม่ได้จดทะเบียน</span></label>
            <label><input type="radio" name="pf-vat" value="yes" onchange="onPfVatChange()"><span>จดทะเบียน VAT แล้ว</span></label>
          </div>
          <div class="hint" id="pf-vat-hint"></div>
        </div>
      </div>

      <!-- 2. ที่อยู่ -->
      <div class="panel" style="margin-top:16px">
        <div class="panel-title">ที่อยู่และการติดต่อ</div>
        <div class="panel-sub">ที่อยู่ตามที่จดทะเบียน — เป็นรายการที่กฎหมายบังคับให้ปรากฏบนใบกำกับภาษี</div>
        <div class="two">
          <div class="field"><label>บ้านเลขที่ / อาคาร</label><input id="pf-addr-no"></div>
          <div class="field"><label>ถนน</label><input id="pf-addr-street"></div>
        </div>
        <div class="two">
          <div class="field"><label>แขวง / ตำบล</label><input id="pf-addr-sub"></div>
          <div class="field"><label>เขต / อำเภอ</label><input id="pf-addr-dist"></div>
        </div>
        <div class="two">
          <div class="field"><label>จังหวัด</label><select id="pf-addr-prov">${provOpts}</select></div>
          <div class="field"><label>รหัสไปรษณีย์</label><input id="pf-addr-post" inputmode="numeric" maxlength="5"></div>
        </div>
        <div class="field"><label>เบอร์ติดต่อ</label><input id="pf-phone">
          <div class="hint">ใช้ติดต่อเรื่องเอกสารเท่านั้น ระบบส่ง OTP ทางอีเมล ไม่ได้ส่งทาง SMS</div>
        </div>
      </div>

      <!-- 3. บัญชีธนาคาร -->
      <div class="panel" style="margin-top:16px">
        <div class="panel-title">บัญชีธนาคาร</div>
        <div class="panel-sub">ใช้สำหรับรับเงินค่าจ้างและกรณีคืนเงิน — ชื่อบัญชีต้องตรงกับชื่อผู้ลงทะเบียน</div>
        <div class="two">
          <div class="field"><label>ธนาคาร</label><select id="pf-bank-name">${bankOpts}</select></div>
          <div class="field"><label>เลขที่บัญชี</label><input id="pf-bank-no"></div>
        </div>
        <div class="field"><label>ชื่อบัญชี</label><input id="pf-bank-acc"></div>
        <div class="hint" id="pf-bank-mask"></div>
      </div>

      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-solid" onclick="savePfProfile()">บันทึกข้อมูลโปรไฟล์</button>
        <button class="btn btn-ghost" onclick="fillProfileForm()">ยกเลิกการแก้ไข</button>
      </div>
    </div>

    <div>
      <!-- 4. โลโก้ / ตราประทับ -->
      <div class="panel">
        <div class="panel-title">โลโก้และตราประทับบนเอกสาร</div>
        <div class="panel-sub">ระบบจะพิมพ์โลโก้ไว้ที่หัวเอกสาร PDF และหัวรายงาน Excel ที่ส่งออก</div>
        <div class="brand-slot">
          <div class="brand-preview" id="pf-logo-box"><span class="muted">ยังไม่มีโลโก้</span></div>
          <div class="brand-actions">
            <b>โลโก้บริษัท / ผู้ประกอบการ</b>
            <small>PNG, JPG หรือ WEBP · ไม่เกิน 1 MB · แนะนำภาพแนวนอนพื้นหลังโปร่งใส</small>
            <input type="file" id="pf-logo-file" accept="image/png,image/jpeg,image/webp" hidden onchange="uploadBrand('logo')">
            <div class="btn-row">
              <button class="btn btn-ghost btn-sm" onclick="document.getElementById('pf-logo-file').click()">เลือกไฟล์</button>
              <button class="btn btn-danger btn-sm" onclick="removeBrand('logo')">ลบโลโก้</button>
            </div>
          </div>
        </div>
        <div class="brand-slot" style="margin-top:14px">
          <div class="brand-preview" id="pf-seal-box"><span class="muted">ยังไม่มีตราประทับ</span></div>
          <div class="brand-actions">
            <b>ตราประทับบริษัท (ถ้ามี)</b>
            <small>พิมพ์ไว้เหนือช่องลงนามของผู้ออกเอกสาร</small>
            <input type="file" id="pf-seal-file" accept="image/png,image/jpeg,image/webp" hidden onchange="uploadBrand('seal')">
            <div class="btn-row">
              <button class="btn btn-ghost btn-sm" onclick="document.getElementById('pf-seal-file').click()">เลือกไฟล์</button>
              <button class="btn btn-danger btn-sm" onclick="removeBrand('seal')">ลบตราประทับ</button>
            </div>
          </div>
        </div>
        <div class="note-box" style="margin-top:14px">
          โลโก้จะถูกวางไว้เหนือเนื้อหาเอกสาร ไม่ทับรายการที่กฎหมายบังคับให้แสดง
          (ชื่อเอกสาร เลขที่ วันที่ ชื่อผู้ประกอบการ เลขประจำตัวผู้เสียภาษี และสำนักงานใหญ่/สาขา)
        </div>
      </div>

      <!-- 5. เอกสารยืนยันตัวตน -->
      <div class="panel" style="margin-top:16px">
        <div class="panel-title">เอกสารยืนยันตัวตน</div>
        <div class="panel-sub">ไฟล์ทุกไฟล์ถูกเข้ารหัสก่อนจัดเก็บ และเปิดดูได้เฉพาะคุณกับผู้ตรวจสอบเท่านั้น</div>
        <div id="pf-kyc-list"><div class="muted">กำลังโหลด…</div></div>
        <input type="file" id="pf-kyc-file" accept=".pdf,image/png,image/jpeg,image/webp" hidden onchange="uploadKycFile()">
        <button class="btn btn-solid btn-block" id="pf-kyc-submit" style="margin-top:14px" onclick="submitKyc()">ส่งเอกสารให้ตรวจสอบ</button>
      </div>

      <!-- 6. ความเป็นส่วนตัว -->
      <div class="panel" style="margin-top:16px">
        <div class="panel-title">ความเป็นส่วนตัวและสิทธิของคุณ</div>
        <div class="panel-sub">ตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</div>
        <div id="pf-consent-list"></div>
        <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" onclick="saveConsent()">บันทึกความยินยอม</button>
        <div class="divider-label" style="margin-top:18px">สิทธิของเจ้าของข้อมูล</div>
        <div class="rights-row">
          <div>
            <b>ขอสำเนาข้อมูลของฉัน</b>
            <small>ดาวน์โหลดข้อมูลทั้งหมดที่ระบบเก็บไว้เป็นไฟล์ JSON (มาตรา 30)</small>
          </div>
          <a class="btn btn-ghost btn-sm" href="/api/pdpa/my-data">ดาวน์โหลด</a>
        </div>
        <div class="rights-row">
          <div>
            <b>ขอลบบัญชีและข้อมูลส่วนบุคคล</b>
            <small>ลบข้อมูลระบุตัวตนทั้งหมด (มาตรา 33) — เอกสารภาษีจะถูกเก็บต่อในรูปแบบที่ไม่ระบุตัวบุคคล
            เพราะประมวลรัษฎากรบังคับให้เก็บไม่น้อยกว่า 5 ปี</small>
          </div>
          <button class="btn btn-danger btn-sm" onclick="openDeleteAccount()">ลบบัญชี</button>
        </div>
        <div class="hint" style="margin-top:10px">
          <a href="/privacy.html" target="_blank">อ่านนโยบายความเป็นส่วนตัวฉบับเต็ม</a>
        </div>
      </div>
    </div>
  </div>`;
}

/* =========================================================
 *  เติมข้อมูลลงฟอร์ม
 * ========================================================= */
function fillProfileForm() {
  const u = PF_USER;
  const juristic = isJuristic();
  const a = u.addr || {};
  const b = u.bank || {};

  pfq('pf-name').value = juristic ? (u.companyName || '') : (u.displayName || '');
  pfq('pf-name-label').textContent = juristic ? 'ชื่อนิติบุคคล (ตามหนังสือรับรอง)' : 'ชื่อ-นามสกุล';
  if (pfq('pf-companytype')) pfq('pf-companytype').value = u.companyType || PF_META.companyTypes[0];
  pfq('pf-taxid').value = u.taxId || '';
  pfq('pf-branchtype').value = u.branchType || 'head';
  pfq('pf-branchcode').value = u.branchCode || '';
  pfq('pf-authname').value = u.authName || '';
  pfq('pf-authpos').value = u.authPosition || '';
  document.querySelectorAll('input[name=pf-vat]').forEach((r) => { r.checked = (r.value === 'yes') === !!u.vatRegistered; });

  pfq('pf-addr-no').value = a.no || '';
  pfq('pf-addr-street').value = a.street || '';
  pfq('pf-addr-sub').value = a.subdistrict || '';
  pfq('pf-addr-dist').value = a.district || '';
  pfq('pf-addr-prov').value = a.province || '';
  pfq('pf-addr-post').value = a.postcode || '';
  pfq('pf-phone').value = u.phone || '';

  pfq('pf-bank-name').value = b.bankName || '';
  pfq('pf-bank-no').value = b.accountNo || '';
  pfq('pf-bank-acc').value = b.accountName || '';
  pfq('pf-bank-mask').textContent = b.accountNo ? `เลขบัญชีที่แสดงให้ผู้อื่นเห็น: ${maskAccount(b.accountNo)}` : '';

  onPfBranchChange();
  onPfVatChange();
  renderBrandPreview();
  renderConsent();
  renderStatusBar();

  ['pf-taxid', 'pf-addr-post', 'pf-branchcode'].forEach((id) => {
    const el = pfq(id);
    if (el && !el._bound) {
      el._bound = true;
      el.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
    }
  });
}

function onPfEntityChange() {
  const juristic = document.querySelector('input[name=pf-entity]:checked').value === 'juristic';
  ['pf-f-companytype', 'pf-f-branch', 'pf-f-auth'].forEach((id) => pfq(id).classList.toggle('hidden', !juristic));
  pfq('pf-name-label').textContent = juristic ? 'ชื่อนิติบุคคล (ตามหนังสือรับรอง)' : 'ชื่อ-นามสกุล';
}
function onPfBranchChange() {
  const isBranch = pfq('pf-branchtype').value === 'branch';
  pfq('pf-branchcode').disabled = !isBranch;
  if (!isBranch) pfq('pf-branchcode').value = '';
}
function onPfVatChange() {
  const yes = document.querySelector('input[name=pf-vat]:checked').value === 'yes';
  pfq('pf-vat-hint').textContent = yes
    ? 'เปิดสิทธิ์ออกใบกำกับภาษีเต็มรูป — ต้องแนบใบทะเบียนภาษีมูลค่าเพิ่ม (ภ.พ.20) ในหัวข้อเอกสารยืนยันตัวตนด้วย'
    : 'ผู้ที่ยังไม่ได้จดทะเบียน VAT ออกใบกำกับภาษีไม่ได้ตามมาตรา 86 แต่ยังออกใบเสร็จรับเงินและใบแจ้งหนี้ได้ตามปกติ';
}

/* =========================================================
 *  แถบสถานะโปรไฟล์
 * ========================================================= */
const VERIFY_LABEL = {
  unverified: { text: 'ยังไม่ได้ยืนยันตัวตน', cls: 'st-grey' },
  pending: { text: 'รอผู้ดูแลระบบตรวจสอบ', cls: 'st-amber' },
  verified: { text: 'ยืนยันตัวตนแล้ว', cls: 'st-green' },
  rejected: { text: 'การยืนยันตัวตนไม่ผ่าน', cls: 'st-red' },
};

function renderStatusBar() {
  const box = pfq('pf-status-bar');
  if (!box) return;
  const info = PF_INFO || {};
  const c = (PROFILE_META && PROFILE_META.completeness) || { percent: 0, missing: [], ok: false };
  const v = VERIFY_LABEL[PF_USER.verifyStatus || 'unverified'];
  const note = PF_USER.verifyNote ? `<div class="status-note">หมายเหตุจากผู้ตรวจสอบ: ${PF_USER.verifyNote}</div>` : '';
  const missing = c.ok ? '' :
    `<div class="status-note">ข้อมูลที่ยังขาด: ${c.missing.join(', ')} — ต้องกรอกให้ครบก่อนจึงจะออกเอกสารได้</div>`;
  box.innerHTML = `
    <div class="status-card">
      <div class="status-line">
        <div>
          <div class="status-head">ความครบถ้วนของโปรไฟล์</div>
          <div class="bar"><i style="width:${c.percent}%"></i></div>
        </div>
        <div class="status-pct">${c.percent}%</div>
        <span class="st-pill ${v.cls}">${v.text}</span>
      </div>
      ${missing}${note}
    </div>`;
}

/* =========================================================
 *  บันทึกโปรไฟล์
 * ========================================================= */
async function savePfProfile() {
  const juristic = PF_USER.role === 'agency'
    ? document.querySelector('input[name=pf-entity]:checked').value === 'juristic'
    : isJuristic();
  const name = pfv('pf-name');
  const body = {
    entityType: juristic ? 'juristic' : 'individual',
    displayName: name,
    companyName: juristic ? name : '',
    companyType: juristic ? pfq('pf-companytype').value : '',
    authName: juristic ? pfv('pf-authname') : '',
    authPosition: juristic ? pfv('pf-authpos') : '',
    taxId: pfv('pf-taxid'),
    branchType: juristic ? pfq('pf-branchtype').value : 'head',
    branchCode: juristic ? pfv('pf-branchcode') : '',
    vatRegistered: document.querySelector('input[name=pf-vat]:checked').value === 'yes',
    addr: {
      no: pfv('pf-addr-no'), street: pfv('pf-addr-street'),
      subdistrict: pfv('pf-addr-sub'), district: pfv('pf-addr-dist'),
      province: pfv('pf-addr-prov'), postcode: pfv('pf-addr-post'),
    },
    phone: pfv('pf-phone'),
    bank: { bankName: pfq('pf-bank-name').value, accountNo: pfv('pf-bank-no'), accountName: pfv('pf-bank-acc') },
  };
  const { ok, data } = await api.put('/api/auth/profile', body);
  if (!ok) return toast(data.error || 'บันทึกไม่สำเร็จ', 'err');
  PF_USER = data.user;
  PROFILE_META = data.profile;
  if (typeof ME !== 'undefined') ME = data.user;
  fillProfileForm();
  await refreshKyc();
  toast('บันทึกข้อมูลโปรไฟล์แล้ว');
}

/* =========================================================
 *  โลโก้ / ตราประทับ
 * ========================================================= */
function renderBrandPreview() {
  const set = (kind) => {
    const box = pfq(kind === 'seal' ? 'pf-seal-box' : 'pf-logo-box');
    const meta = PF_USER[kind === 'seal' ? 'sealFile' : 'logoFile'];
    box.innerHTML = meta
      ? `<img src="/api/auth/brand-image/${kind}?t=${Date.now()}" alt="">`
      : `<span class="muted">${kind === 'seal' ? 'ยังไม่มีตราประทับ' : 'ยังไม่มีโลโก้'}</span>`;
  };
  set('logo'); set('seal');
}

async function uploadBrand(kind) {
  const input = pfq(kind === 'seal' ? 'pf-seal-file' : 'pf-logo-file');
  const file = input.files[0];
  if (!file) return;
  if (file.size > 1024 * 1024) { input.value = ''; return toast('ไฟล์ต้องมีขนาดไม่เกิน 1 MB', 'err'); }
  const dataBase64 = await readFileAsBase64(file);
  const { ok, data } = await api.post('/api/auth/brand-image', { kind, filename: file.name, mime: file.type, dataBase64 });
  input.value = '';
  if (!ok) return toast(data.error || 'อัปโหลดไม่สำเร็จ', 'err');
  PF_USER = data.user;
  if (typeof ME !== 'undefined') ME = data.user;
  renderBrandPreview();
  toast(kind === 'seal' ? 'อัปโหลดตราประทับแล้ว' : 'อัปโหลดโลโก้แล้ว — เอกสารที่พิมพ์หลังจากนี้จะมีโลโก้ของคุณ');
}

async function removeBrand(kind) {
  if (!PF_USER[kind === 'seal' ? 'sealFile' : 'logoFile']) return;
  const { ok, data } = await api.del('/api/auth/brand-image/' + kind);
  if (!ok) return toast(data.error || 'ลบไม่สำเร็จ', 'err');
  PF_USER = data.user;
  if (typeof ME !== 'undefined') ME = data.user;
  renderBrandPreview();
  toast('ลบรูปภาพแล้ว');
}

/* =========================================================
 *  เอกสารยืนยันตัวตน (KYC)
 * ========================================================= */
let PF_KYC_TARGET = null;

async function refreshKyc() {
  PF_INFO = await api.get('/api/kyc');
  const box = pfq('pf-kyc-list');
  if (!box) return;

  if (!PF_INFO.kycConsent) {
    box.innerHTML = `<div class="note-box warn">
      คุณยังไม่ได้ให้ความยินยอมการจัดเก็บเอกสารยืนยันตัวตน จึงยังอัปโหลดไม่ได้ —
      เปิดความยินยอมได้ที่หัวข้อ "ความเป็นส่วนตัวและสิทธิของคุณ" ด้านล่าง
    </div>`;
    pfq('pf-kyc-submit').classList.add('hidden');
    renderStatusBar();
    return;
  }
  pfq('pf-kyc-submit').classList.remove('hidden');

  box.innerHTML = PF_INFO.required.map((r) => {
    const up = r.uploaded;
    return `<div class="kyc-row ${up ? 'has-file' : ''}">
      <div class="kyc-main">
        <b>${r.label} ${r.required ? '<span class="req-tag">จำเป็น</span>' : '<span class="opt-tag">ถ้ามี</span>'}</b>
        <small>${r.hint}</small>
        <small class="purpose">วัตถุประสงค์: ${r.purpose}</small>
        ${up ? `<div class="kyc-file">แนบแล้ว: ${up.filename || 'ไฟล์'} · ${Math.round((up.size || 0) / 1024)} KB</div>` : ''}
      </div>
      <div class="kyc-act">
        ${up ? `<a class="btn btn-ghost btn-sm" href="/api/kyc/${up.id}/file" target="_blank">เปิดดู</a>
                <button class="btn btn-danger btn-sm" onclick="deleteKyc(${up.id})">ลบ</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="pickKyc('${r.type}')">อัปโหลด</button>`}
      </div>
    </div>`;
  }).join('') || '<div class="muted">บทบาทนี้ไม่ต้องใช้เอกสารยืนยันตัวตนเพิ่มเติม</div>';

  renderStatusBar();
}

function pickKyc(docType) {
  PF_KYC_TARGET = docType;
  pfq('pf-kyc-file').click();
}

async function uploadKycFile() {
  const input = pfq('pf-kyc-file');
  const file = input.files[0];
  if (!file || !PF_KYC_TARGET) return;
  if (file.size > 5 * 1024 * 1024) { input.value = ''; return toast('ไฟล์ต้องมีขนาดไม่เกิน 5 MB', 'err'); }
  const dataBase64 = await readFileAsBase64(file);
  const { ok, data } = await api.post('/api/kyc', {
    docType: PF_KYC_TARGET, filename: file.name, mime: file.type, dataBase64,
  });
  input.value = ''; PF_KYC_TARGET = null;
  if (!ok) return toast(data.error || 'อัปโหลดไม่สำเร็จ', 'err');
  await refreshKyc();
  toast('อัปโหลดเอกสารแล้ว (จัดเก็บแบบเข้ารหัส)');
}

async function deleteKyc(id) {
  if (!confirm('ยืนยันการลบเอกสารฉบับนี้?')) return;
  const { ok, data } = await api.del('/api/kyc/' + id);
  if (!ok) return toast(data.error || 'ลบไม่สำเร็จ', 'err');
  await refreshKyc();
  toast('ลบเอกสารแล้ว');
}

async function submitKyc() {
  const { ok, data } = await api.post('/api/kyc/submit', {});
  if (!ok) return toast(data.error || 'ส่งตรวจสอบไม่สำเร็จ', 'err');
  PF_USER = data.user;
  if (typeof ME !== 'undefined') ME = data.user;
  await refreshKyc();
  toast('ส่งเอกสารให้ผู้ดูแลระบบตรวจสอบแล้ว');
}

/* =========================================================
 *  ความยินยอมและสิทธิตาม PDPA
 * ========================================================= */
function renderConsent() {
  const given = (PF_USER.consent && PF_USER.consent.purposes) || [];
  pfq('pf-consent-list').innerHTML = PF_META.consentPurposes.map((p) => `
    <label class="consent-item compact">
      <input type="checkbox" class="pf-consent-cb" value="${p.key}"
        ${given.includes(p.key) ? 'checked' : ''} ${p.required ? 'disabled checked' : ''}>
      <div>
        <b>${p.label} ${p.required ? '<span class="req-tag">จำเป็น</span>' : '<span class="opt-tag">เลือกได้</span>'}</b>
        <small>${p.detail}</small>
      </div>
    </label>`).join('')
    + `<div class="hint" style="margin-top:8px">เวอร์ชันนโยบายที่คุณยินยอมไว้: ${(PF_USER.consent && PF_USER.consent.version) || '—'}</div>`;
}

async function saveConsent() {
  const given = Array.from(document.querySelectorAll('.pf-consent-cb'))
    .filter((c) => c.checked || c.disabled).map((c) => c.value);
  const { ok, data } = await api.put('/api/pdpa/consent', { consent: given });
  if (!ok) return toast(data.error || 'บันทึกไม่สำเร็จ', 'err');
  PF_USER = data.user;
  if (typeof ME !== 'undefined') ME = data.user;
  renderConsent();
  await refreshKyc();
  toast('บันทึกความยินยอมแล้ว');
}

function openDeleteAccount() {
  const pass = prompt('ยืนยันตัวตนก่อนลบบัญชี — กรุณากรอกรหัสผ่านของคุณ');
  if (!pass) return;
  const confirmText = prompt('การลบบัญชีย้อนกลับไม่ได้ หากยืนยัน กรุณาพิมพ์ข้อความ:  ลบบัญชีของฉัน');
  if (!confirmText) return;
  api.post('/api/pdpa/delete-account', { password: pass, confirm: confirmText }).then(({ ok, data }) => {
    if (!ok) return toast(data.error || 'ลบบัญชีไม่สำเร็จ', 'err');
    alert('ลบข้อมูลส่วนบุคคลของคุณเรียบร้อยแล้ว ระบบจะออกจากระบบทันที');
    location.href = '/login.html';
  });
}
