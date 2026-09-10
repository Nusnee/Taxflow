/* create.js — หน้าสร้างเอกสารธุรกิจ/สัญญา (ver5) ใช้ร่วมทุกบทบาท
 * เลือกประเภทจาก card → ฟอร์มปรับตามประเภท → สร้าง → เปิด modal จัดการทันที */

let CR_TYPE = null;
let CR_PURPOSE = null;
let CR_STEP = 1;

/* ---------- Wizard progress (ข้อ 1) ---------- */
const CR_STEPS = ['จุดประสงค์', 'ประเภทเอกสาร', 'กรอกข้อมูล', 'ตรวจสอบและยืนยัน'];
function crRenderProgress() {
  const bar = document.getElementById('cr-progress');
  if (!bar) return;
  bar.innerHTML = CR_STEPS.map((label, i) => {
    const n = i + 1;
    const on = CR_STEP >= n, now = CR_STEP === n;
    return `<div class="step ${on ? 'on' : ''} ${now ? 'now' : ''}">
      <div class="step-dot">${CR_STEP > n ? '✓' : n}</div><div class="step-label">${label}</div>
    </div>${n < 4 ? '<div class="step-line ' + (CR_STEP > n ? 'on' : '') + '"></div>' : ''}`;
  }).join('');
}
function crGoStep(n) {
  CR_STEP = n;
  crRenderProgress();
  const showIf = (id, cond) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !cond); };
  showIf('cr-step1-sec', n === 1);
  showIf('cr-step2-sec', n === 2);
  showIf('cr-form', n === 3);
  showIf('cr-review', n === 4);
  if (n === 4) crBuildReview();
  const head = document.getElementById('cr-progress');
  if (head) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPurposeCards() {
  const grid = document.getElementById('cr-purpose');
  if (!grid) return;
  grid.innerHTML = DOC_PURPOSES.map((pu) => `
    <button class="purpose-card ${CR_PURPOSE === pu.id ? 'active' : ''}" onclick="pickPurpose('${pu.id}')">
      <b>${pu.label}</b><small>${pu.desc}</small>
    </button>`).join('');
}
function pickPurpose(id) {
  CR_PURPOSE = id;
  renderPurposeCards();
  crGoStep(2);
  crAutoSave();
}

function renderCreateCards() {
  renderPurposeCards();
  const grid = document.getElementById('cr-cards');
  if (!grid) return;
  const types = CREATE_TYPES[ME.role] || [];
  grid.innerHTML = types.map((t) => `
    <button class="cr-card" data-type="${t.id}" onclick="pickCreateType('${t.id}')">
      <div class="cr-icon">${SVG_ICONS[t.icon] || ''}</div>
      <b>${DOC_LABEL[t.id]}</b>
      <small>${t.desc}</small>
    </button>`).join('');
  crGoStep(CR_PURPOSE ? (CR_TYPE ? 3 : 2) : 1);
  crOfferRestore();
}

function pickCreateType(type) {
  if (!CR_PURPOSE) {
    toast('กรุณาเลือกจุดประสงค์การใช้งานก่อน (ขั้นที่ 1)', 'err');
    crGoStep(1);
    return;
  }
  CR_TYPE = type;
  crGoStep(3);
  crAutoSave();
  document.querySelectorAll('.cr-card').forEach((c) => c.classList.toggle('active', c.dataset.type === type));
  const form = document.getElementById('cr-form');
  form.classList.remove('hidden');
  document.getElementById('cr-form-title').textContent = 'สร้าง' + (DOC_LABEL[type] || type);

  const isContract = type.startsWith('CONTRACT');
  const isPayment = type === 'PAYMENT';
  const isEtax = type === 'ETAX';
  const isItems = !isContract && !isPayment && type !== 'POA';

  document.getElementById('cr-items-sec').classList.toggle('hidden', !isItems);
  document.getElementById('cr-payment-sec').classList.toggle('hidden', !isPayment);
  document.getElementById('cr-contract-sec').classList.toggle('hidden', !isContract);
  document.getElementById('cr-vat-sec').classList.toggle('hidden', !isItems || isEtax);
  if (isEtax) document.getElementById('cr-vat-check').checked = true;

  // ป้ายคู่ค้าตามประเภท
  const partyLabel = { RECEIPT: 'ได้รับเงินจาก', INVOICE: 'เรียกเก็บจาก', QUOTATION: 'เสนอราคาต่อ', PO: 'สั่งซื้อจาก', DELIVERY: 'ส่งมอบให้', PAYMENT: 'จ่ายให้แก่', CONTRACT_INF: 'ผู้รับจ้าง (Influencer)', CONTRACT_BRAND: 'ผู้ว่าจ้าง (แบรนด์)', POA: 'อีกฝ่ายของหนังสือมอบอำนาจ', ETAX: 'ผู้ซื้อ/ผู้รับบริการ' }[type] || 'คู่ค้า';
  document.getElementById('cr-party-label').textContent = partyLabel + ' *';

  const isPoa = type === 'POA';
  document.getElementById('cr-poa-sec').classList.toggle('hidden', !isPoa);
  document.getElementById('cr-inv-sec').classList.toggle('hidden', type !== 'INVOICE');
  document.getElementById('cr-qtn-sec').classList.toggle('hidden', type !== 'QUOTATION');
  document.getElementById('cr-po-sec').classList.toggle('hidden', type !== 'PO');
  document.getElementById('cr-dlv-sec').classList.toggle('hidden', type !== 'DELIVERY');
  if (isPoa) { document.getElementById('cr-items-sec').classList.add('hidden'); }
  // ข้อกฎหมายกำกับประเภท
  const hint = document.getElementById('cr-hint');
  hint.innerHTML = CREATE_HINTS[type] ? icon('scale') + ' ' + CREATE_HINTS[type] : '';
  hint.classList.toggle('hidden', !CREATE_HINTS[type]);

  if (isItems && !document.querySelector('#cr-items .item-row')) crAddItem();
  crPreview();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function crAddItem(name = '', qty = 1, price = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input placeholder="รายละเอียดงาน/สินค้า" value="${name}" oninput="crPreview()">
    <input type="number" value="${qty}" oninput="crPreview()">
    <input type="number" placeholder="0.00" value="${price}" oninput="crPreview()">
    <button class="item-remove" onclick="this.parentElement.remove();crPreview()">×</button>`;
  document.getElementById('cr-items').appendChild(row);
}
function crReadItems() {
  return [...document.querySelectorAll('#cr-items .item-row')].map((r) => {
    const [d, q, p] = r.querySelectorAll('input');
    return { name: d.value, qty: Number(q.value) || 0, price: Number(p.value) || 0 };
  }).filter((i) => i.name || i.price);
}

function crPreview() {
  const box = document.getElementById('cr-preview');
  if (!CR_TYPE) return;
  let base = 0;
  if (CR_TYPE === 'POA') { box.innerHTML = '<div class="empty">หนังสือมอบอำนาจไม่มียอดเงิน — สร้างแล้วส่งให้อีกฝ่ายลงนามในแท็บ "ส่งเอกสาร"</div>'; return; }
  if (CR_TYPE.startsWith('CONTRACT')) base = Number(document.getElementById('cr-fee').value) || 0;
  else if (CR_TYPE === 'PAYMENT') base = Number(document.getElementById('cr-amount').value) || 0;
  else base = crReadItems().reduce((s, i) => s + i.qty * i.price, 0);
  if (!base) { box.innerHTML = '<div class="empty">กรอกข้อมูลเพื่อดูยอดรวม</div>'; return; }
  const useVat = !document.getElementById('cr-vat-sec').classList.contains('hidden') && document.getElementById('cr-vat-check').checked;
  const vat = useVat ? base * 0.07 : 0;
  box.innerHTML = `
    <div class="line"><span>รวมเป็นเงิน</span><b>฿${baht(base)}</b></div>
    ${useVat ? `<div class="line"><span>VAT 7%</span><b>฿${baht(vat)}</b></div>` : ''}
    <div class="line total"><span>ยอดรวมทั้งสิ้น</span><b>฿${baht(base + vat)}</b></div>`;
}

async function crSubmit() {
  if (!CR_TYPE) return toast('กรุณาเลือกประเภทเอกสาร', 'err');
  const party = document.getElementById('cr-party').value.trim();
  const partyTaxId = document.getElementById('cr-taxid').value.trim();
  const note = document.getElementById('cr-note').value.trim();

  let resp;
  if (CR_TYPE === 'ETAX') {
    resp = await api.post('/api/etax/invoice', { buyer: party, buyerTaxId: partyTaxId, items: crReadItems(), vatRate: 7, docPurpose: CR_PURPOSE });
  } else {
    const body = { type: CR_TYPE, party, partyTaxId, note, docPurpose: CR_PURPOSE, partyAddress: document.getElementById('cr-address').value.trim() };
    if (CR_TYPE.startsWith('CONTRACT')) {
      Object.assign(body, {
        fee: Number(document.getElementById('cr-fee').value),
        scope: document.getElementById('cr-scope').value.trim(),
        paymentTerms: document.getElementById('cr-terms').value.trim(),
        startDate: document.getElementById('cr-start').value,
        endDate: document.getElementById('cr-end').value,
      });
    } else if (CR_TYPE === 'PAYMENT') {
      Object.assign(body, {
        amount: Number(document.getElementById('cr-amount').value),
        method: document.getElementById('cr-method').value,
        payRef: document.getElementById('cr-ref').value.trim(),
        description: document.getElementById('cr-paydesc').value.trim(),
      });
    } else if (CR_TYPE === 'POA') {
      Object.assign(body, {
        scope: document.getElementById('cr-poa-scope').value.trim(),
        effectiveUntil: document.getElementById('cr-poa-until').value,
      });
    } else {
      Object.assign(body, {
        items: crReadItems(),
        includeVat: document.getElementById('cr-vat-check').checked,
        vatRate: 7,
        dueDate: document.getElementById('cr-duedate').value,
        validDays: document.getElementById('cr-valid').value,
        deliveryDate: (CR_TYPE === 'PO' ? document.getElementById('cr-podate').value : document.getElementById('cr-dlvdate').value),
        phase: document.getElementById('cr-phase').value.trim(),
      });
    }
    resp = await api.post('/api/docs/create', body);
  }
  const { ok, data } = resp;
  if (!ok) return toast((data.errors ? data.errors.join(' · ') : data.error) || 'สร้างไม่สำเร็จ', 'err');
  toast('สร้าง ' + (DOC_LABEL[CR_TYPE] || '') + ' เรียบร้อย (สถานะ: แบบร่าง)');
  crClearDraft();
  CR_TYPE = null; CR_PURPOSE = null; CR_STEP = 1;
  // ล้างฟอร์ม
  ['cr-party', 'cr-taxid', 'cr-address', 'cr-note', 'cr-fee', 'cr-scope', 'cr-terms', 'cr-amount', 'cr-ref', 'cr-paydesc'].forEach((i) => { const el = document.getElementById(i); if (el) el.value = ''; });
  document.getElementById('cr-items').innerHTML = '';
  if (typeof switchView === 'function') switchView('docs');
  await openDoc(data.id);
  if (CR_PURPOSE === 'send') {
    const tab = document.querySelector('.mtab[data-t=send]');
    if (tab) tab.click();
    toast('แบบร่างพร้อมแล้ว — กรอกอีเมลคู่ค้าเพื่อส่งขอลายเซ็น/ตรวจสอบ');
  }
}

// สมุดคู่ค้า: autocomplete แบบกำหนดเอง (แทน datalist เดิม)
function crWireAutofill() {
  const el = document.getElementById('cr-party');
  const panel = document.getElementById('cr-party-ac');
  if (!el || !panel || el.dataset.wired) return;
  el.dataset.wired = '1';
  const list = () => (typeof CONTACTS !== 'undefined' && CONTACTS) || [];
  const show = () => {
    const q = el.value.trim().toLowerCase();
    const hits = list().filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, 6);
    if (!hits.length) { panel.classList.add('hidden'); return; }
    panel.innerHTML = hits.map((c) => `
      <div class="ac-item" data-name="${c.name.replace(/"/g, '&quot;')}">
        <b>${c.name}</b>
        <small>${[c.taxId, c.kind === 'buyer' ? 'ลูกค้า' : 'ผู้รับเงิน'].filter(Boolean).join(' · ')}</small>
      </div>`).join('');
    panel.classList.remove('hidden');
    panel.querySelectorAll('.ac-item').forEach((it) => it.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const c = list().find((x) => x.name === it.dataset.name);
      el.value = c.name;
      document.getElementById('cr-taxid').value = c.taxId || '';
      document.getElementById('cr-address').value = c.address || '';
      panel.classList.add('hidden');
    }));
  };
  el.addEventListener('focus', show);
  el.addEventListener('input', show);
  el.addEventListener('blur', () => setTimeout(() => panel.classList.add('hidden'), 150));
}


/* ---------- ขั้นที่ 4: ตรวจสอบก่อนสร้าง (Preview — ข้อ 11) ---------- */
function crValidateStep3() {
  const party = document.getElementById('cr-party').value.trim();
  if (!party) { toast('กรุณาระบุคู่ค้า/คู่สัญญา', 'err'); return false; }
  if (CR_TYPE === 'POA') {
    if (!document.getElementById('cr-poa-scope').value.trim()) { toast('กรุณาระบุขอบเขตอำนาจ', 'err'); return false; }
  } else if (CR_TYPE.startsWith('CONTRACT')) {
    if (!(Number(document.getElementById('cr-fee').value) > 0)) { toast('กรุณาระบุค่าตอบแทน', 'err'); return false; }
    if (!document.getElementById('cr-scope').value.trim()) { toast('กรุณาระบุขอบเขตงาน', 'err'); return false; }
  } else if (CR_TYPE === 'PAYMENT') {
    if (!(Number(document.getElementById('cr-amount').value) > 0)) { toast('กรุณาระบุยอดเงิน', 'err'); return false; }
  } else if (!crReadItems().length) { toast('กรุณาเพิ่มรายการอย่างน้อย 1 รายการ', 'err'); return false; }
  return true;
}
function crToReview() { if (crValidateStep3()) crGoStep(4); }

function crBuildReview() {
  const box = document.getElementById('cr-review-body');
  if (!box) return;
  const party = document.getElementById('cr-party').value.trim();
  const taxid = document.getElementById('cr-taxid').value.trim();
  let base = 0, detail = '';
  if (CR_TYPE === 'POA') {
    detail = `<div class="kv"><span>ขอบเขตอำนาจ</span><b style="max-width:60%;text-align:right">${document.getElementById('cr-poa-scope').value}</b></div>`;
  } else if (CR_TYPE.startsWith('CONTRACT')) {
    base = Number(document.getElementById('cr-fee').value) || 0;
    detail = `<div class="kv"><span>ขอบเขตงาน</span><b style="max-width:60%;text-align:right">${document.getElementById('cr-scope').value}</b></div>
      <div class="kv"><span>ค่าตอบแทน</span><b>฿${baht(base)}</b></div>`;
  } else if (CR_TYPE === 'PAYMENT') {
    base = Number(document.getElementById('cr-amount').value) || 0;
    detail = `<div class="kv"><span>ยอดชำระ</span><b>฿${baht(base)}</b></div>
      <div class="kv"><span>วิธีชำระ</span><b>${document.getElementById('cr-method').value}</b></div>`;
  } else {
    const items = crReadItems();
    base = items.reduce((t, i) => t + i.qty * i.price, 0);
    const vat = document.getElementById('cr-vat-check').checked ? base * 0.07 : 0;
    detail = `<table class="rev-items"><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา</th><th class="num">รวม</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td>${i.name}</td><td class="num">${i.qty}</td><td class="num">${baht(i.price)}</td><td class="num">${baht(i.qty * i.price)}</td></tr>`).join('')}
    </tbody></table>
    <div class="kv"><span>รวมเป็นเงิน</span><b>฿${baht(base)}</b></div>
    ${vat ? `<div class="kv"><span>VAT 7%</span><b>฿${baht(vat)}</b></div>` : ''}
    <div class="kv"><span>ยอดรวมทั้งสิ้น</span><b style="color:var(--orange-deep)">฿${baht(base + vat)}</b></div>`;
  }
  box.innerHTML = `
    <div class="kv"><span>ประเภทเอกสาร</span><b>${DOC_LABEL[CR_TYPE]}</b></div>
    <div class="kv"><span>จุดประสงค์</span><b>${PURPOSE_LABEL[CR_PURPOSE] || ''}</b></div>
    <div class="kv"><span>คู่ค้า</span><b>${party}${taxid ? ` <small style="font-weight:500;color:var(--ink-soft)">(${taxid})</small>` : ''}</b></div>
    ${detail}
    ${document.getElementById('cr-note').value ? `<div class="kv"><span>หมายเหตุ</span><b>${document.getElementById('cr-note').value}</b></div>` : ''}
    <div class="callout" style="margin-top:14px">${CR_PURPOSE === 'send' ? 'สร้างแล้วระบบจะพาไปแท็บ "ส่งเอกสาร" — ลงนามฝั่งคุณก่อน แล้วส่งขอลายเซ็นคู่ค้า' : CR_PURPOSE === 'record' ? 'สร้างเป็นแบบร่าง จากนั้นกด "บันทึกเสร็จสิ้น" เพื่อเก็บเป็นประวัติ' : 'สร้างเป็นแบบร่าง ตรวจทานอีกครั้งแล้วกด "บันทึกเสร็จสิ้น" ได้เลย'}</div>`;
}

/* ---------- Auto Save (ข้อ 12) ---------- */
const CR_FIELDS = ['cr-party', 'cr-taxid', 'cr-address', 'cr-note', 'cr-fee', 'cr-scope', 'cr-terms', 'cr-start', 'cr-end', 'cr-amount', 'cr-method', 'cr-ref', 'cr-paydesc', 'cr-duedate', 'cr-valid', 'cr-podate', 'cr-phase', 'cr-dlvdate', 'cr-poa-scope', 'cr-poa-until'];
function crDraftKey() { return 'tf_create_draft_' + ((typeof ME !== 'undefined' && ME) ? ME.email : ''); }
let crSaveTimer = null;
function crAutoSave() {
  clearTimeout(crSaveTimer);
  crSaveTimer = setTimeout(() => {
    try {
      const data = { purpose: CR_PURPOSE, type: CR_TYPE, at: Date.now(), fields: {}, items: crReadItems(), vat: !!(document.getElementById('cr-vat-check') || {}).checked };
      CR_FIELDS.forEach((id) => { const el = document.getElementById(id); if (el && el.value) data.fields[id] = el.value; });
      if (data.type || Object.keys(data.fields).length) localStorage.setItem(crDraftKey(), JSON.stringify(data));
    } catch {}
  }, 500);
}
function crClearDraft() { try { localStorage.removeItem(crDraftKey()); } catch {} }
function crOfferRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(crDraftKey()) || 'null'); } catch {}
  const bar = document.getElementById('cr-restore');
  if (!bar) return;
  if (!saved || !saved.type) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span>พบแบบร่างที่ยังกรอกไม่เสร็จ (${DOC_LABEL[saved.type] || saved.type} · ${new Date(saved.at).toLocaleString('th-TH')})</span>
    <div class="btn-row"><button class="btn btn-solid btn-sm" onclick="crRestore()">กู้คืน</button>
    <button class="btn btn-ghost btn-sm" onclick="crClearDraft();document.getElementById('cr-restore').classList.add('hidden')">ทิ้ง</button></div>`;
}
function crRestore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(crDraftKey()) || 'null'); } catch {}
  if (!saved) return;
  CR_PURPOSE = saved.purpose;
  renderPurposeCards();
  if (saved.type) pickCreateType(saved.type);
  Object.entries(saved.fields || {}).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
  const wrap = document.getElementById('cr-items');
  if (wrap && (saved.items || []).length) { wrap.innerHTML = ''; saved.items.forEach((i) => crAddItem(i.name, i.qty, i.price)); }
  const vc = document.getElementById('cr-vat-check');
  if (vc) vc.checked = !!saved.vat;
  crPreview();
  document.getElementById('cr-restore').classList.add('hidden');
  toast('กู้คืนแบบร่างแล้ว');
}
function crWireAutosave() {
  const form = document.getElementById('cr-form');
  if (form && !form.dataset.autosave) { form.dataset.autosave = '1'; form.addEventListener('input', crAutoSave); }
}
