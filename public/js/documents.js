/* documents.js — โมดูลจัดการเอกสาร (ver4)
 * modal 6 แท็บ: ข้อมูล(สถานะ+stepper) / แก้ไข / ไฟล์แนบ / ลายเซ็น(วาด+อัปโหลด) / แชร์ / ประวัติ
 * ทุกแท็บมี try/catch — ถ้า error จะแสดงข้อความ ไม่ปล่อยจอว่าง */

const STATUS_INFO = {
  draft:     { label: 'แบบร่าง',     cls: 'st-draft' },
  pending:   { label: 'รอตรวจสอบ',  cls: 'st-pending' },
  approved:  { label: 'อนุมัติ',     cls: 'st-approved' },
  rejected:  { label: 'ไม่อนุมัติ',  cls: 'st-rejected' },
  cancelled: { label: 'ยกเลิก',      cls: 'st-cancelled' },
  archived:  { label: 'เก็บถาวร',    cls: 'st-archived' },
};

// คำอธิบายสถานะแบบเข้าใจง่าย (ข้อ 2)
const STATUS_HELP = {
  draft:     'ฉบับร่างของคุณ — แก้ไขได้อิสระ · เสร็จแล้วกด "บันทึกเสร็จสิ้น" หรือส่งให้คู่ค้าลงนาม/ตรวจสอบที่แท็บ "ส่งเอกสาร"',
  pending:   'ส่งถึงคู่ค้าแล้ว รอการลงนาม/ตรวจสอบจากอีกฝ่าย — ติดตามสถานะที่แท็บ "ส่งเอกสาร" (เมื่อได้รับตอบกลับจะแจ้งเตือนที่กระดิ่ง)',
  approved:  'เอกสารเสร็จสมบูรณ์ ใช้อ้างอิงทางบัญชี/ภาษีได้จริง — เมื่อจบงวดสามารถ "เก็บถาวร"',
  rejected:  'เอกสารถูกตีกลับ — กด "กลับไปแก้ไข" เพื่อปรับข้อมูลแล้วส่งให้คู่ค้าใหม่',
  cancelled: 'เอกสารถูกยกเลิก ไม่นำไปใช้งานต่อ (เก็บไว้เป็นหลักฐาน)',
  archived:  'เอกสารถูกเก็บเข้าคลังถาวร เรียกดูได้แต่แก้ไขไม่ได้',
};

// ปุ่มเปลี่ยนสถานะ: ป้ายที่สื่อการกระทำ ไม่ใช่แค่ชื่อสถานะ (ข้อ 2)
const ACTION_LABEL = {
  pending:   { text: 'ส่งตรวจสอบ ▸', cls: 'btn-solid' },
  approved:  { text: '✓ อนุมัติ',     cls: 'btn-solid' },
  rejected:  { text: 'ตีกลับ (ไม่อนุมัติ)', cls: 'btn-danger' },
  draft:     { text: 'กลับไปแก้ไข', cls: 'btn-ghost' },
  cancelled: { text: 'ยกเลิกเอกสาร',  cls: 'btn-danger' },
  archived:  { text: 'เก็บถาวร', cls: 'btn-ghost' },
};

const KIND_LABEL = { receipt: 'ใบเสร็จ', invoice: 'ใบกำกับภาษี', wht: 'หนังสือรับรองหัก ณ ที่จ่าย', payment: 'หลักฐานการโอนเงิน', other: 'อื่นๆ' };
function statusChip(s) { const i = STATUS_INFO[s] || { label: s || '-', cls: '' }; return `<span class="stbadge ${i.cls}">${i.label}</span>`; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('th-TH') : '-'; }

let CURRENT = null;
let onChangeCb = null;
function setDocsChangeHandler(fn) { onChangeCb = fn; }

async function openDoc(id) {
  const d = await api.get('/api/documents/' + id);
  if (d.error) return toast(d.error, 'err');
  CURRENT = d;
  renderModal(d);
}
function closeModal() { const m = document.getElementById('doc-modal'); if (m) m.remove(); CURRENT = null; }

function renderModal(d) {
  closeModal();
  CURRENT = d; // closeModal() ล้าง CURRENT — ต้องตั้งกลับก่อน render
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.id = 'doc-modal';
  const editable = ['draft', 'pending', 'rejected'].includes(d.status);
  wrap.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-top">
        <div>
          <div class="docno" style="font-size:13px">${d.docNo}</div>
          <h3>${DOC_LABEL[d.type] || d.type} ${statusChip(d.status)}</h3>
        </div>
        <button class="icon-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="mtabs">
        <button class="mtab active" data-t="info">ข้อมูล</button>
        ${editable ? '<button class="mtab" data-t="edit">แก้ไข</button>' : ''}
        <button class="mtab" data-t="files">ไฟล์แนบ (${(d.attachments || []).length})</button>
        <button class="mtab" data-t="sign">ลายเซ็น</button>
        <button class="mtab" data-t="send">ส่งเอกสาร</button>
        <button class="mtab" data-t="share">แชร์</button>
        <button class="mtab" data-t="history">ประวัติ</button>
      </div>
      <div class="mbody" id="mbody"></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
  wrap.querySelectorAll('.mtab').forEach((b) => b.addEventListener('click', () => {
    wrap.querySelectorAll('.mtab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    renderTab(b.dataset.t);
  }));
  renderTab('info');
}

function renderTab(t) {
  const body = document.getElementById('mbody');
  try {
    renderTabInner(t, body);
  } catch (err) {
    body.innerHTML = `<div class="error-msg">เกิดข้อผิดพลาดในการแสดงผล: ${err.message}<br><small>ลองปิดแล้วเปิดใหม่ หรือรีเฟรชหน้า</small></div>`;
    console.error('renderTab error:', err);
  }
}

/* ---------- STEPPER แสดงวงจรสถานะ (ข้อ 2) ---------- */
function statusStepper(status) {
  // เส้นทางหลัก: draft → pending → approved → archived (rejected/cancelled แสดงเป็นป้ายพิเศษ)
  const steps = ['draft', 'pending', 'approved', 'archived'];
  const idx = steps.indexOf(status);
  const special = status === 'rejected' || status === 'cancelled';
  const stepHtml = steps.map((s, i) => {
    const on = !special && idx >= i;
    const now = s === status;
    return `<div class="step ${on ? 'on' : ''} ${now ? 'now' : ''}">
      <div class="step-dot">${on ? (i < idx ? '✓' : i + 1) : i + 1}</div>
      <div class="step-label">${s === 'approved' ? 'อนุมัติ / ลงนาม' : STATUS_INFO[s].label}</div>
    </div>${i < steps.length - 1 ? '<div class="step-line ' + (!special && idx > i ? 'on' : '') + '"></div>' : ''}`;
  }).join('');
  const specialNote = special ? `<div class="step-special">${status === 'rejected' ? 'เอกสารถูกตีกลับ — แก้ไขแล้วส่งใหม่ได้' : 'เอกสารถูกยกเลิก'}</div>` : '';
  return `<div class="stepper">${stepHtml}</div>${specialNote}`;
}

function renderTabInner(t, body) {
  const d = CURRENT;
  const cp = d.party || d.buyer || d.payee || d.payer || '-';
  const isWht = ['WHT', 'EWHT'].includes(d.type);
  const taxVal = isWht ? d.wht : d.vat;
  const total = isWht ? d.net : (d.total ?? d.base);

  /* ═══ ข้อมูล + สถานะ ═══ */
  if (t === 'info') {
    const waiting = d.status === 'pending' && (d.docPurpose === 'send') && d.activeRequest && d.activeRequest.status === 'sent' && !d.counterpartySignature;
    const allowed = waiting ? (d.allowedTransitions || []).filter((x) => x === 'cancelled') : (d.allowedTransitions || []);
    const transitions = allowed.map((s) => {
      let a = ACTION_LABEL[s] || { text: STATUS_INFO[s]?.label || s, cls: 'btn-ghost' };
      if (d.status === 'draft' && s === 'approved') a = { text: '✓ บันทึกเสร็จสิ้น', cls: 'btn-success' };
      return `<button class="btn btn-sm ${a.cls}" onclick="changeStatus(${d.id},'${s}')">${a.text}</button>`;
    }).join('');
    const draftHint = d.status === 'draft' && (d.docPurpose || 'self') !== 'send'
      ? '<div class="status-help" style="background:#E9F7EF;border-color:#BDE5CE">ไม่ต้องการส่งให้ใครตรวจ — กด "บันทึกเสร็จสิ้น" เพื่อปิดงานเอกสารนี้ได้ทันที</div>' : '';
    // จุดประสงค์เอกสาร + คำขอที่ส่งล่าสุด
    const pr = d.docPurpose || 'self';
    const ar = d.activeRequest;
    let purposeBanner = '';
    if (d.status === 'draft' && pr === 'send') {
      purposeBanner = `<div class="status-help">แบบร่างก่อนส่ง — ตรวจทาน/แก้ไขให้เรียบร้อย แล้วส่งให้คู่ค้าที่แท็บ "ส่งเอกสาร" <button class="btn btn-solid btn-sm" style="margin-left:8px" onclick="document.querySelector('.mtab[data-t=send]').click()">ไปที่ส่งเอกสาร</button></div>`;
    }
    if (d.status === 'pending' && ar && ar.status === 'sent') {
      purposeBanner = `<div class="wait-banner">
        <div class="wait-spin"></div>
        <div><b>รอการอนุมัติ / ลงนามจากคู่ค้า</b><br>
        <small>ส่งถึง <b>${esc(ar.toName || ar.toEmail)}</b> (${esc(ar.toEmail)}) · ${ar.purpose === 'sign' ? 'ขอลายเซ็น' : 'ขอตรวจสอบ'}${ar.dueDate ? ' · ภายในวันที่ ' + esc(ar.dueDate) : ''}${ar.overdue ? ' · <b style="color:var(--danger)">เกินกำหนด</b>' : ''}</small></div>
      </div>`;
    }
    if (d.status === 'pending' && d.counterpartySignature) {
      purposeBanner = `<div class="status-help" style="background:#E9F7EF;border-color:#BDE5CE">คู่ค้าลงนามตอบกลับแล้ว (${esc(d.counterpartySignature.signerName)}) — กด "อนุมัติ" เพื่อปิดงานเอกสารฉบับนี้</div>`;
    }
    body.innerHTML = `
      ${statusStepper(d.status)}
      <div class="status-help">${icon('info')} ${STATUS_HELP[d.status] || ''}</div>
      ${nextActionText(d) ? `<div class="next-action"><span>ขั้นตอนถัดไป</span>${nextActionText(d)}</div>` : ''}
      ${purposeBanner}
      ${draftHint}
      <div class="kv"><span>จุดประสงค์</span><b>${(typeof PURPOSE_LABEL !== 'undefined' && PURPOSE_LABEL[pr]) || 'ใช้ภายใน'}</b></div>
      ${d.signature ? `<div class="kv"><span>ลายเซ็นผู้ออกเอกสาร</span><b class="sig-chip">${d.signature.image ? `<img src="${esc(d.signature.image)}">` : ''}${esc(d.signature.signerName)}</b></div>` : ''}
      ${ar ? `<div class="kv"><span>ส่งถึง</span><b>${esc(ar.toName || ar.toEmail)} <small style="color:var(--ink-soft);font-weight:500">(${esc(ar.toEmail)})</small></b></div>` : ''}
      <div class="kv"><span>คู่ค้า/ลูกค้า</span><b>${cp}</b></div>
      <div class="kv"><span>ฐานภาษี</span><b>฿${baht(d.base)}</b></div>
      <div class="kv"><span>${isWht ? 'ภาษีหัก ณ ที่จ่าย' : 'VAT'}</span><b>฿${baht(taxVal)}</b></div>
      <div class="kv"><span>ยอดรวมสุทธิ</span><b style="color:var(--orange-deep)">฿${baht(total)}</b></div>
      <div class="kv"><span>วันที่สร้าง</span><b>${fmtDate(d.createdAt)}</b></div>
      <div class="kv"><span>แก้ไขล่าสุด</span><b>${fmtDate(d.updatedAt || d.createdAt)}</b></div>
      ${transitions ? `<div class="mrow"><div class="mlabel">ดำเนินการต่อ</div><div class="btn-row">${transitions}</div></div>` : ''}
      <div class="btn-row" style="margin-top:18px;border-top:1px solid var(--line);padding-top:16px">
        <a class="btn btn-ghost btn-sm" href="/api/documents/${d.id}/pdf" target="_blank">เปิด PDF / พิมพ์</a>
        <button class="btn btn-ghost btn-sm" onclick="duplicateDoc(${d.id})">คัดลอกเป็นฉบับใหม่</button>
        ${d.status === 'draft' ? `<button class="btn btn-danger btn-sm" onclick="deleteDoc(${d.id})">ลบเอกสาร</button>` : ''}
      </div>`;
  }

  /* ═══ แก้ไข (ข้อ 2 — ฟอร์มแก้ไขในตัว) ═══ */
  if (t === 'edit') {
    if (!['draft', 'pending', 'rejected'].includes(d.status)) {
      body.innerHTML = '<p class="muted">เอกสารสถานะนี้แก้ไขไม่ได้</p>';
      return;
    }
    const GEN = ['RECEIPT','INVOICE','QUOTATION','PO','DELIVERY','PAYMENT','CONTRACT_INF','CONTRACT_BRAND'];
    if (GEN.includes(d.type)) {
      body.innerHTML = `
        <div class="field"><label>คู่ค้า/คู่สัญญา</label><input id="ed-party" value="${(d.party || '').replace(/"/g, '&quot;')}"></div>
        <div class="row">
          <div class="field"><label>เลขผู้เสียภาษี</label><input id="ed-taxid" value="${(d.partyTaxId || '').replace(/"/g, '&quot;')}"></div>
          <div class="field"><label>ยอดเงิน (บาท)</label><input id="ed-amount" type="number" value="${d.base}"></div>
        </div>
        <div class="field"><label>หมายเหตุ</label><input id="ed-note" value="${(d.note || '').replace(/"/g, '&quot;')}"></div>
        <button class="btn btn-solid" onclick="saveEditGen(${d.id})">บันทึกการแก้ไข</button>
        <p class="hint" style="margin-top:10px">ทุกการแก้ไขถูกบันทึกเป็นเวอร์ชันใหม่ในแท็บ "ประวัติ"</p>`;
      return;
    }
    if (d.type === 'ETAX') {
      body.innerHTML = `
        <p class="muted" style="margin-bottom:14px">แก้ไขข้อมูลผู้ซื้อและอัตรา VAT (รายการสินค้าแก้ไขได้โดยสร้างเอกสารใหม่)</p>
        <div class="field"><label>ชื่อผู้ซื้อ</label><input id="ed-buyer" value="${(d.buyer || '').replace(/"/g, '&quot;')}"></div>
        <div class="row">
          <div class="field"><label>เลขผู้เสียภาษี</label><input id="ed-taxid" value="${(d.buyerTaxId || '').replace(/"/g, '&quot;')}"></div>
          <div class="field"><label>อัตรา VAT (%)</label><input id="ed-vat" type="number" value="${d.vatRate}"></div>
        </div>
        <button class="btn btn-solid" onclick="saveEdit(${d.id},'ETAX')">บันทึกการแก้ไข</button>`;
    } else {
      body.innerHTML = `
        <div class="field"><label>${d.type === 'EWHT' ? 'ชื่อผู้รับเงิน' : 'ชื่อผู้จ่ายเงิน'}</label>
          <input id="ed-party" value="${((d.type === 'EWHT' ? d.payee : d.payer) || '').replace(/"/g, '&quot;')}"></div>
        <div class="field"><label>รายละเอียด</label><input id="ed-desc" value="${(d.description || '').replace(/"/g, '&quot;')}"></div>
        <div class="row">
          <div class="field"><label>ยอดเงินก่อนหัก (บาท)</label><input id="ed-amount" type="number" value="${d.base}"></div>
          <div class="field"><label>อัตราภาษี (%)</label><input id="ed-rate" type="number" value="${d.rate}"></div>
        </div>
        <button class="btn btn-solid" onclick="saveEdit(${d.id},'${d.type}')">บันทึกการแก้ไข</button>
        <p class="hint" style="margin-top:10px">ทุกการแก้ไขจะถูกบันทึกเป็นเวอร์ชันใหม่ในแท็บ "ประวัติ"</p>`;
    }
  }

  /* ═══ ไฟล์แนบ ═══ */
  if (t === 'files') {
    const list = (d.attachments || []).map((a) => `
      <div class="att-item">
        <div class="att-meta"><b>${KIND_LABEL[a.kind] || a.kind}</b><small>${esc(a.filename)} · ${Math.round((a.size || 0) / 1024)} KB</small></div>
        <div class="btn-row">
          <a class="btn btn-ghost btn-sm" href="/api/attachments/${a.id}" target="_blank">เปิด</a>
          <button class="btn btn-danger btn-sm" onclick="delAttachment(${a.id})">ลบ</button>
        </div>
      </div>`).join('') || '<p class="muted">ยังไม่มีไฟล์แนบ</p>';
    body.innerHTML = `
      <div class="field"><label>ประเภทเอกสารแนบ</label>
        <select id="att-kind"><option value="receipt">ใบเสร็จ</option><option value="invoice">ใบกำกับภาษี</option><option value="wht">หนังสือรับรองหัก ณ ที่จ่าย</option><option value="payment">หลักฐานการโอนเงิน</option><option value="other" selected>อื่นๆ</option></select></div>
      <div class="dropzone" id="dropzone">
        <input type="file" id="file-input" accept=".pdf,image/png,image/jpeg,image/webp" hidden>
        <div class="dz-inner">
          <div class="dz-icon">▲</div>
          <div>ลากไฟล์มาวาง หรือ <a onclick="document.getElementById('file-input').click()">เลือกไฟล์</a></div>
          <small class="muted">รองรับ PDF, PNG, JPG, WEBP · ไม่เกิน 5 MB</small>
        </div>
      </div>
      <div id="preview-area"></div>
      <div class="att-list" style="margin-top:16px">${list}</div>`;
    wireDropzone(d.id);
  }

  /* ═══ ลายเซ็น (ข้อ 5 — วาด หรือ อัปโหลด PNG) ═══ */
  if (t === 'sign') {
    if (d.signed && d.signature) {
      body.innerHTML = `
        <div class="sign-done">
          <div class="sign-check">✓</div>
          <div><b>ลงลายมือชื่อดิจิทัลแล้ว</b><br><small class="muted">มาตรฐาน ${d.signatureStandard || 'จำลอง'}</small></div>
        </div>
        ${d.signature.image ? `<img src="${d.signature.image}" class="sign-preview" alt="ลายเซ็น">` : ''}
        <div class="kv"><span>ผู้ลงนาม</span><b>${d.signature.signerName}</b></div>
        <div class="kv"><span>วันและเวลาที่ลงนาม</span><b>${fmtDate(d.signature.signedAt)}</b></div>`;
      return;
    }
    body.innerHTML = `
      <div class="field"><label>ชื่อผู้ลงนาม</label><input id="signer-name" placeholder="ชื่อ-นามสกุล ผู้มีอำนาจลงนาม"></div>
      <div class="sign-mode-tabs">
        <button class="smode active" id="smode-saved" onclick="setSignMode('saved')">คลังลายเซ็น</button>
        <button class="smode" id="smode-draw" onclick="setSignMode('draw')">วาดลายเซ็น</button>
        <button class="smode" id="smode-upload" onclick="setSignMode('upload')">อัปโหลดรูป</button>
      </div>
      <div id="sign-saved-area">
        <div id="saved-sig-list" class="saved-sig-list"><p class="muted">กำลังโหลด…</p></div>
      </div>
      <div id="sign-draw-area" class="hidden">
        <canvas id="sig-canvas" class="sig-canvas" width="440" height="150"></canvas>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-ghost btn-sm" onclick="undoSig()">ย้อนกลับ 1 เส้น</button>
          <button class="btn btn-ghost btn-sm" onclick="clearSig()">ล้าง</button>
          <button class="btn btn-solid btn-sm" onclick="doSign(${d.id},'draw')">ลงลายมือชื่อดิจิทัล</button>
        </div>
        <label class="save-sig-check"><input type="checkbox" id="sig-keep" checked> บันทึกลายเซ็นนี้เข้าคลังไว้ใช้ครั้งต่อไป</label>
      </div>
      <div id="sign-upload-area" class="hidden">
        <div class="dropzone" id="sig-dropzone" style="padding:18px">
          <input type="file" id="sig-file" accept="image/png,image/jpeg,image/webp" hidden>
          <div class="dz-inner">
            <div class="dz-icon">▲</div>
            <div>ลากรูปลายเซ็น/ตราประทับบริษัทมาวาง หรือ <a onclick="document.getElementById('sig-file').click()">เลือกไฟล์</a></div>
            <small class="muted">PNG พื้นหลังโปร่งใสจะสวยที่สุด · ไม่เกิน 2 MB</small>
          </div>
        </div>
        <div id="sig-upload-preview"></div>
        <button class="btn btn-solid btn-sm hidden" id="sig-upload-btn" style="margin-top:12px" onclick="doSign(${d.id},'upload')">ลงลายมือชื่อดิจิทัลด้วยรูปนี้</button>
        <label class="save-sig-check"><input type="checkbox" id="sig-keep-up" checked> บันทึกลายเซ็นนี้เข้าคลังไว้ใช้ครั้งต่อไป</label>
      </div>`;
    initCanvas();
    wireSigUpload();
    loadSavedSignatures(d.id);
  }

  /* ═══ ส่งเอกสารให้คู่ค้าลงนาม/ตรวจ (ver6) ═══ */
  if (t === 'send') {
    const cs = d.counterpartySignature;
    const needSign = !d.signed;
    const signWarn = needSign ? `
      <div class="wait-banner" style="background:#FCF3EB;border-color:#F0D9C8">
        <div><b>ผู้ออกเอกสารยังไม่ได้ลงนาม</b><br>
        <small>ตามขั้นตอน ผู้ออกต้องลงลายมือชื่อฝั่งตนเองก่อน แล้วจึงส่งขอลายเซ็นจากคู่ค้า</small></div>
        <button class="btn btn-solid btn-sm" style="margin-left:auto;flex-shrink:0" onclick="promptSign(${d.id}, { title: 'ลงนามฝั่งผู้ออกเอกสาร', onDone: () => { const tb = document.querySelector('.mtab[data-t=send]'); if (tb) tb.click(); } })">ลงนามตอนนี้</button>
      </div>` : '';
    const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    body.innerHTML = `
      ${signWarn}
      ${cs ? `<div class="sign-done"><div class="sign-check">✓</div><div><b>คู่ค้าลงนามตอบกลับแล้ว</b><br><small class="muted">${cs.signerName} (${cs.byEmail || ''}) · ${fmtDate(cs.signedAt)}</small></div></div>` : ''}
      <div class="field"><label>ส่งถึง (อีเมลบัญชี TaxFlow ของคู่ค้า) *</label><input id="rq-email" placeholder="เช่น creator@taxflow.test"></div>
      <div class="row">
        <div class="field"><label>วัตถุประสงค์</label><select id="rq-purpose"><option value="sign">ขอลายเซ็น</option><option value="review">ขอตรวจสอบ</option></select></div>
        <div class="field"><label>กำหนดตอบกลับภายใน</label><input id="rq-due" type="date" value="${week}"></div>
      </div>
      <div class="field"><label>ลงนามในฐานะ</label><input id="rq-as" placeholder="เช่น ผู้รับจ้าง / ผู้มอบอำนาจ / ผู้รับเงิน (แสดงใต้ช่องลายเซ็น)"></div>
      <div class="field"><label>ข้อความถึงผู้รับ</label><input id="rq-msg" placeholder="เช่น รบกวนตรวจสอบและลงนามภายในกำหนดครับ"></div>
      <button class="btn btn-solid" onclick="sendRequest(${d.id})">ส่งเอกสาร</button>
      <div class="mlabel" style="margin-top:20px">ประวัติการส่ง</div>
      <div id="rq-history"><p class="muted">กำลังโหลด…</p></div>`;
    loadDocRequests(d.id);
  }

  /* ═══ แชร์ ═══ */
  if (t === 'share') {
    body.innerHTML = `
      <p class="muted" style="margin-bottom:14px">สร้างลิงก์ให้ผู้อื่นตรวจสอบเอกสาร พร้อม QR Code สำหรับสแกน</p>
      <div class="btn-row"><button class="btn btn-solid btn-sm" onclick="makeShare(${d.id})">สร้าง/แสดงลิงก์แชร์</button></div>
      <div id="share-area" style="margin-top:16px"></div>`;
    if (d.share) showShare(d.id, location.origin + '/verify.html?token=' + d.share.token);
  }

  /* ═══ ประวัติ ═══ */
  if (t === 'history') {
    const vers = [...(d.versions || [])].reverse().map((v) => `
      <div class="hist-item">
        <div class="hist-dot">${v.version}</div>
        <div><b>เวอร์ชัน ${v.version}</b> — ${esc(v.note || '')}<br>
        <small class="muted">${esc(v.editor || '-')} · ${fmtDate(v.at)}</small>
        <a class="muted" style="text-decoration:underline;cursor:pointer;font-size:11px" onclick='alert(JSON.stringify(${JSON.stringify(JSON.stringify(v.snapshot || {}))}, null, 2).slice(0, 1200))'>ดูข้อมูลเวอร์ชันนี้</a></div>
      </div>`).join('') || '<p class="muted">ไม่มีประวัติ</p>';
    const audit = (d.audit || []).map((a) => `<div class="audit-line"><b>${esc(a.action)}</b> ${esc(a.detail)} <small class="muted">· ${fmtDate(a.at)}</small></div>`).join('') || '<p class="muted">ไม่มีบันทึก</p>';
    const tlEvents = (d.audit || []).filter((a) => ['create', 'status', 'send', 'countersign', 'sign', 'review-ok', 'declined', 'duplicate'].includes(a.action)).reverse();
    const timeline = tlEvents.length ? `
      <div class="mlabel">ไทม์ไลน์เอกสาร</div>
      <div class="timeline">${tlEvents.map((a) => `
        <div class="tl-item"><div class="tl-dot"></div>
          <div><b>${a.detail || a.action}</b><br><small class="muted">${a.actor || ''} · ${fmtDate(a.at)}</small></div>
        </div>`).join('')}</div>` : '';
    body.innerHTML = `
      ${timeline}
      <div class="mlabel" style="margin-top:${tlEvents.length ? '18px' : '0'}">ประวัติเวอร์ชัน (${(d.versions || []).length})</div>
      <div class="hist-list">${vers}</div>
      <div class="mlabel" style="margin-top:18px">บันทึกการทำงานของเอกสารนี้ (Audit Log)</div>
      <div class="audit-box">${audit}</div>`;
  }
}


function nextActionText(d) {
  const pr = d.docPurpose || 'self';
  if (d.status === 'draft') {
    if (pr === 'send') return d.signed ? 'ส่งเอกสารให้คู่ค้าที่แท็บ "ส่งเอกสาร"' : 'ลงนามฝั่งผู้ออก แล้วส่งให้คู่ค้าที่แท็บ "ส่งเอกสาร"';
    return 'ตรวจทานข้อมูล แล้วกด "บันทึกเสร็จสิ้น" เพื่อปิดงาน';
  }
  if (d.status === 'pending') {
    if (d.counterpartySignature) return 'คู่ค้าลงนามแล้ว — กด "อนุมัติ" เพื่อปิดงาน';
    if (d.activeRequest && d.activeRequest.status === 'sent') return 'รอคู่ค้าตอบกลับ — ติดตาม/ยกเลิกคำขอได้ที่แท็บ "ส่งเอกสาร"';
    return 'รอการตรวจสอบ — ผู้มีอำนาจกด "อนุมัติ" หรือ "ตีกลับ"';
  }
  if (d.status === 'approved') return 'เอกสารพร้อมใช้งาน — ดาวน์โหลด PDF หรือเก็บถาวรเมื่อจบงวด';
  if (d.status === 'rejected') return 'กด "กลับไปแก้ไข" ปรับข้อมูลตามเหตุผลที่ตีกลับ แล้วส่งใหม่';
  return null;
}

/* ---------- แก้ไขเอกสาร ---------- */
async function saveEdit(id, type) {
  let bodyData = {};
  if (type === 'ETAX') {
    bodyData = { buyer: document.getElementById('ed-buyer').value, buyerTaxId: document.getElementById('ed-taxid').value, vatRate: Number(document.getElementById('ed-vat').value) || 7 };
  } else {
    const party = document.getElementById('ed-party').value;
    bodyData = {
      [type === 'EWHT' ? 'payee' : 'payer']: party,
      description: document.getElementById('ed-desc').value,
      amount: Number(document.getElementById('ed-amount').value),
      rate: Number(document.getElementById('ed-rate').value),
    };
  }
  const { ok, data } = await api.put('/api/documents/' + id, bodyData);
  if (!ok) return toast(data.error || 'บันทึกไม่สำเร็จ', 'err');
  toast('บันทึกการแก้ไขแล้ว (เวอร์ชันใหม่ถูกสร้าง)');
  await openDoc(id);
  onChangeCb && onChangeCb();
}

async function saveEditGen(id) {
  const { ok, data } = await api.put('/api/documents/' + id, {
    party: document.getElementById('ed-party').value,
    partyTaxId: document.getElementById('ed-taxid').value,
    amount: Number(document.getElementById('ed-amount').value),
    note: document.getElementById('ed-note').value,
  });
  if (!ok) return toast(data.error || 'บันทึกไม่สำเร็จ', 'err');
  toast('บันทึกการแก้ไขแล้ว');
  await openDoc(id);
  onChangeCb && onChangeCb();
}

async function duplicateDoc(id) {
  const { ok, data } = await api.post(`/api/documents/${id}/duplicate`, {});
  if (!ok) return toast(data.error || 'คัดลอกไม่สำเร็จ', 'err');
  toast('คัดลอกเป็นเอกสารฉบับใหม่ ' + data.docNo + ' (แบบร่าง)');
  await openDoc(data.id);
  onChangeCb && onChangeCb();
}

/* ---------- status ---------- */
async function changeStatus(id, status, opts = {}) {
  // ข้อ 1: ลายเซ็นอยู่ตรงขั้นตอนการอนุมัติ — ถ้าจะอนุมัติแต่ผู้ออกยังไม่ลงนาม ให้ลงนามกำกับก่อน
  if (status === 'approved' && CURRENT && !CURRENT.signed && CURRENT.type !== 'WHT' && !opts.skipSign) {
    promptSign(id, {
      title: 'ลงนามกำกับการอนุมัติ',
      note: 'ผู้ออกเอกสารลงลายมือชื่อเพื่อรับรองเอกสารก่อนปิดงาน',
      onDone: () => changeStatus(id, status, { skipSign: true }),
      onSkip: () => changeStatus(id, status, { skipSign: true }),
    });
    return;
  }
  let note = '';
  if (status === 'rejected') {
    const r = await uiPrompt('ระบุเหตุผลที่ไม่อนุมัติ เพื่อแจ้งให้ผู้เกี่ยวข้องทราบ (เว้นว่างได้)', { title: 'ตีกลับเอกสาร', placeholder: 'เช่น ยอดเงินไม่ตรงกับที่ตกลง' });
    if (r === null) return;
    note = r;
  }
  if (status === 'cancelled') {
    const okC = await uiConfirm('เอกสารที่ยกเลิกจะถูกประทับลายน้ำ "ยกเลิกแล้ว" บน PDF และไม่สามารถนำไปใช้อ้างอิงได้อีก การยกเลิกไม่สามารถย้อนกลับได้', { title: 'ยกเลิกเอกสารนี้?', confirmText: 'ยกเลิกเอกสาร', cancelText: 'กลับ' });
    if (!okC) return;
  }
  const { ok, data } = await api.post(`/api/documents/${id}/status`, { status, note });
  if (!ok) return toast(data.error || 'เปลี่ยนสถานะไม่ได้', 'err');
  toast('เปลี่ยนสถานะเป็น ' + STATUS_INFO[status].label);
  await openDoc(id);
  onChangeCb && onChangeCb();
}
async function deleteDoc(id) {
  if (!(await uiConfirm('เอกสารและไฟล์แนบทั้งหมดจะถูกลบถาวร ไม่สามารถกู้คืนได้', { title: 'ลบเอกสารนี้?', confirmText: 'ลบถาวร', cancelText: 'กลับ' }))) return;
  await api.del('/api/documents/' + id);
  toast('ลบเอกสารแล้ว'); closeModal(); onChangeCb && onChangeCb();
}

/* ---------- attachments ---------- */
let PENDING_FILE = null;
function wireDropzone(docId) {
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  const handle = (file) => previewFile(file, docId);
  input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handle(f); });
}
const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
function previewFile(file, docId) {
  if (!ALLOWED.includes(file.type)) return toast('รองรับเฉพาะ PDF, PNG, JPG, WEBP', 'err');
  if (file.size > 5 * 1024 * 1024) return toast('ไฟล์เกิน 5 MB', 'err');
  const reader = new FileReader();
  reader.onload = () => {
    PENDING_FILE = { filename: file.name, mime: file.type, dataUrl: reader.result };
    const area = document.getElementById('preview-area');
    const isImg = file.type.startsWith('image/');
    area.innerHTML = `
      <div class="preview-card">
        <div class="mlabel">ตัวอย่างก่อนบันทึก</div>
        ${isImg ? `<img src="${reader.result}" class="preview-img">` : `<div class="pdf-badge">PDF · ${file.name}</div>`}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-solid btn-sm" onclick="confirmUpload(${docId})">บันทึกไฟล์แนบ</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('preview-area').innerHTML='';PENDING_FILE=null">ยกเลิก</button>
        </div>
      </div>`;
  };
  reader.readAsDataURL(file);
}
async function confirmUpload(docId) {
  if (!PENDING_FILE) return;
  const base64 = PENDING_FILE.dataUrl.split(',')[1];
  const kind = document.getElementById('att-kind').value;
  const { ok, data } = await api.post(`/api/documents/${docId}/attachments`, { kind, filename: PENDING_FILE.filename, mime: PENDING_FILE.mime, dataBase64: base64 });
  if (!ok) return toast(data.error || 'อัปโหลดไม่สำเร็จ', 'err');
  toast('แนบไฟล์เรียบร้อย'); PENDING_FILE = null;
  await openDoc(docId);
  const tab = document.querySelector('.mtab[data-t=files]'); if (tab) tab.click();
  onChangeCb && onChangeCb();
}
async function delAttachment(id) {
  await api.del('/api/attachments/' + id);
  toast('ลบไฟล์แล้ว');
  await openDoc(CURRENT.id);
  const tab = document.querySelector('.mtab[data-t=files]'); if (tab) tab.click();
}

/* ---------- ลายเซ็น: วาด ---------- */
let sigCtx, drawing = false, hasDrawn = false, sigUndo = [];
function initCanvas() {
  const c = document.getElementById('sig-canvas');
  if (!c) return;
  sigCtx = c.getContext('2d');
  sigUndo = [];
  sigCtx.lineWidth = 2.4; sigCtx.lineCap = 'round'; sigCtx.strokeStyle = '#1a1a1a';
  const pos = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) }; };
  const start = (e) => { drawing = true; hasDrawn = true; try { sigUndo.push(sigCtx.getImageData(0, 0, c.width, c.height)); if (sigUndo.length > 40) sigUndo.shift(); } catch {} const { x, y } = pos(e); sigCtx.beginPath(); sigCtx.moveTo(x, y); e.preventDefault(); };
  const move = (e) => { if (!drawing) return; const { x, y } = pos(e); sigCtx.lineTo(x, y); sigCtx.stroke(); e.preventDefault(); };
  const end = () => { drawing = false; };
  c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
  c.addEventListener('touchstart', start); c.addEventListener('touchmove', move); c.addEventListener('touchend', end);
}
function clearSig() { const c = document.getElementById('sig-canvas'); sigCtx.clearRect(0, 0, c.width, c.height); hasDrawn = false; sigUndo = []; }
function undoSig() {
  const c = document.getElementById('sig-canvas');
  const prev = sigUndo.pop();
  if (prev) { sigCtx.putImageData(prev, 0, 0); if (!sigUndo.length) hasDrawn = false; }
  else { sigCtx.clearRect(0, 0, c.width, c.height); hasDrawn = false; }
}

/* ---------- ลายเซ็น: อัปโหลด PNG (ข้อ 5) ---------- */
let SIG_UPLOAD = null;
function setSignMode(mode) {
  ['saved', 'draw', 'upload'].forEach((m) => {
    const btn = document.getElementById('smode-' + m);
    if (btn) btn.classList.toggle('active', mode === m);
    const area = document.getElementById('sign-' + m + '-area');
    if (area) area.classList.toggle('hidden', mode !== m);
  });
}

/* ---------- คลังลายเซ็น (ข้อ 5) ---------- */
let SAVED_SIGS = [];
async function loadSavedSignatures(docId) {
  const { items } = await api.get('/api/signatures');
  SAVED_SIGS = items || [];
  const list = document.getElementById('saved-sig-list');
  if (!list) return;
  if (!SAVED_SIGS.length) {
    list.innerHTML = '<p class="muted">ยังไม่มีลายเซ็นในคลัง — วาดหรืออัปโหลดครั้งแรก ระบบจะบันทึกให้อัตโนมัติ แล้วครั้งต่อไปเลือกใช้จากที่นี่ได้เลย</p>';
    setSignMode('draw');
    return;
  }
  list.innerHTML = SAVED_SIGS.map((x) => `
    <div class="saved-sig-card">
      <img src="${esc(x.image)}" alt="${esc(x.name)}">
      <div class="ssc-name">${esc(x.name)}</div>
      <div class="btn-row">
        <button class="btn btn-solid btn-sm" onclick="signWithSaved(${docId},${x.id})">ใช้ลงนาม</button>
        <button class="btn btn-danger btn-sm" onclick="delSavedSig(${x.id},${docId})">ลบ</button>
      </div>
    </div>`).join('');
}
async function signWithSaved(docId, sigId) {
  const sig = SAVED_SIGS.find((x) => x.id === sigId);
  if (!sig) return;
  const nameInput = document.getElementById('signer-name');
  const name = (nameInput.value || '').trim() || sig.name;
  const result = await otpGate({
    purpose: 'sign-doc', refId: docId,
    title: 'ยืนยันการลงลายมือชื่อดิจิทัล',
    action: (otpId, code) => api.post(`/api/documents/${docId}/sign`, { signerName: name, image: sig.image, otpId, code }),
  });
  if (!result) return;
  toast('ลงลายมือชื่อด้วยลายเซ็นจากคลังเรียบร้อย');
  await openDoc(docId);
  const tab = document.querySelector('.mtab[data-t=sign]'); if (tab) tab.click();
  onChangeCb && onChangeCb();
}
async function delSavedSig(sigId, docId) {
  if (!(await uiConfirm('ลายเซ็นนี้จะถูกลบออกจากคลังของคุณ', { title: 'ลบลายเซ็น?', confirmText: 'ลบ', cancelText: 'กลับ' }))) return;
  await api.del('/api/signatures/' + sigId);
  loadSavedSignatures(docId);
}
function wireSigUpload() {
  const dz = document.getElementById('sig-dropzone');
  const input = document.getElementById('sig-file');
  if (!dz || !input) return;
  const handle = (file) => {
    if (!file.type.startsWith('image/')) return toast('รองรับเฉพาะไฟล์รูปภาพ', 'err');
    if (file.size > 2 * 1024 * 1024) return toast('รูปเกิน 2 MB', 'err');
    const reader = new FileReader();
    reader.onload = () => {
      SIG_UPLOAD = reader.result;
      document.getElementById('sig-upload-preview').innerHTML =
        `<div class="preview-card"><div class="mlabel">ตัวอย่างลายเซ็น</div><img src="${reader.result}" class="sign-preview" style="background:#fff"></div>`;
      document.getElementById('sig-upload-btn').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  };
  input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handle(f); });
}
async function doSign(id, mode) {
  const name = document.getElementById('signer-name').value.trim();
  if (!name) return toast('กรุณากรอกชื่อผู้ลงนาม', 'err');
  let image = null;
  if (mode === 'draw') {
    if (!hasDrawn) return toast('กรุณาวาดลายเซ็นก่อน', 'err');
    image = document.getElementById('sig-canvas').toDataURL('image/png');
  } else {
    if (!SIG_UPLOAD) return toast('กรุณาเลือกรูปลายเซ็นก่อน', 'err');
    image = SIG_UPLOAD;
  }
  const result = await otpGate({
    purpose: 'sign-doc', refId: id,
    title: 'ยืนยันการลงลายมือชื่อดิจิทัล',
    action: (otpId, code) => api.post(`/api/documents/${id}/sign`, { signerName: name, image, otpId, code }),
  });
  if (!result) return;
  const keepEl = document.getElementById(mode === 'draw' ? 'sig-keep' : 'sig-keep-up');
  if (keepEl && keepEl.checked) await api.post('/api/signatures', { name, image });
  toast('ลงลายมือชื่อเรียบร้อย' + (keepEl && keepEl.checked ? ' และบันทึกเข้าคลังลายเซ็นแล้ว' : ''));
  SIG_UPLOAD = null;
  await openDoc(id);
  const tab = document.querySelector('.mtab[data-t=sign]'); if (tab) tab.click();
  onChangeCb && onChangeCb();
}

/* ---------- ส่งเอกสารข้ามบัญชี ---------- */
const RQ_STATUS = { sent: '<span class="stbadge st-pending">รอตอบกลับ</span>', signed: '<span class="stbadge st-approved">ลงนามแล้ว</span>', approved: '<span class="stbadge st-approved">ตรวจแล้วผ่าน</span>', declined: '<span class="stbadge st-rejected">ถูกตีกลับ</span>', cancelled: '<span class="stbadge st-cancelled">ยกเลิก</span>' };
async function sendRequest(docId) {
  const toEmail = document.getElementById('rq-email').value.trim();
  if (!toEmail) return toast('กรุณาระบุอีเมลผู้รับ', 'err');
  const { ok, data } = await api.post(`/api/documents/${docId}/request`, {
    toEmail,
    purpose: document.getElementById('rq-purpose').value,
    dueDate: document.getElementById('rq-due').value,
    signAs: document.getElementById('rq-as').value.trim(),
    message: document.getElementById('rq-msg').value.trim(),
  });
  if (!ok) return toast(data.error || 'ส่งไม่สำเร็จ', 'err');
  toast('ส่งเอกสารถึง ' + toEmail + ' แล้ว — อีกฝ่ายจะเห็นในกล่องรับเอกสาร + กระดิ่งแจ้งเตือน');
  await openDoc(docId);
  const tab = document.querySelector('.mtab[data-t=send]'); if (tab) tab.click();
  onChangeCb && onChangeCb();
}
async function loadDocRequests(docId) {
  const { items } = await api.get(`/api/documents/${docId}/requests`);
  const box = document.getElementById('rq-history');
  if (!box) return;
  box.innerHTML = (items || []).map((r) => `
    <div class="rq-item ${r.overdue ? 'overdue' : ''}">
      <div>
        <b>${esc(r.toName || r.toEmail)}</b> <small class="muted">(${esc(r.toEmail)})</small><br>
        <small>${r.purpose === 'sign' ? 'ขอลายเซ็น' : 'ขอตรวจสอบ'} · ส่ง ${fmtDate(r.sentAt)}${r.dueDate ? ' · ภายใน ' + esc(r.dueDate) : ''}${r.overdue ? ' · <b style="color:var(--danger)">เกินกำหนด</b>' : ''}</small>
        ${r.declineReason ? `<br><small style="color:var(--danger)">เหตุผล: ${esc(r.declineReason)}</small>` : ''}
      </div>
      <div style="text-align:right">
        <div>${RQ_STATUS[r.status] || r.status}</div>
        ${r.status === 'sent' ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="cancelRequest(${r.id},${docId})">ยกเลิกคำขอ</button>` : ''}
      </div>
    </div>`).join('') || '<p class="muted">ยังไม่เคยส่งเอกสารนี้ให้ใคร</p>';
}
async function cancelRequest(reqId, docId) {
  await api.post(`/api/requests/${reqId}/cancel`, {});
  toast('ยกเลิกคำขอแล้ว');
  loadDocRequests(docId);
}

/* ---------- share ---------- */
async function makeShare(id) {
  const { ok, data } = await api.post(`/api/documents/${id}/share`, {});
  if (!ok) return toast(data.error || 'สร้างลิงก์ไม่สำเร็จ', 'err');
  showShare(id, data.url);
}
function showShare(id, url) {
  const area = document.getElementById('share-area');
  const subject = encodeURIComponent('เอกสารภาษีสำหรับตรวจสอบ');
  const bodyM = encodeURIComponent('ตรวจสอบเอกสารได้ที่: ' + url);
  area.innerHTML = `
    <div class="field"><label>ลิงก์สำหรับตรวจสอบ</label>
      <div class="copy-row"><input id="share-url" value="${url}" readonly><button class="btn btn-ghost btn-sm" onclick="copyShare()">คัดลอก</button></div></div>
    <div class="share-grid">
      <a class="btn btn-ghost btn-sm" href="mailto:?subject=${subject}&body=${bodyM}">ส่งอีเมล</a>
      <a class="btn btn-ghost btn-sm" href="/api/documents/${id}/qr.svg" download="qr-${id}.svg">ดาวน์โหลด QR</a>
    </div>
    <div class="qr-wrap"><img src="/api/documents/${id}/qr.svg?t=${Date.now()}" alt="QR ตรวจสอบเอกสาร" class="qr-img"><small class="muted">สแกนเพื่อตรวจสอบเอกสาร</small></div>`;
}
function copyShare() { const el = document.getElementById('share-url'); el.select(); navigator.clipboard && navigator.clipboard.writeText(el.value); toast('คัดลอกลิงก์แล้ว'); }


/* ---------- promptSign: modal ลงนามกลาง (ใช้ตอนอนุมัติ + ก่อนส่งเอกสาร) ---------- */
let PS_OPTS = null, PS_SIGS = [], psCtx, psDrawing = false, psDrawn = false, PS_UPLOAD = null, psUndoStack = [];
async function promptSign(docId, opts = {}) {
  PS_OPTS = { docId, ...opts };
  const { items } = await api.get('/api/signatures');
  PS_SIGS = items || [];
  const old = document.getElementById('sign-prompt-modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.id = 'sign-prompt-modal';
  wrap.style.zIndex = '120';
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-top"><h3>${opts.title || 'ลงนามเอกสาร'}</h3><button class="icon-btn" onclick="document.getElementById('sign-prompt-modal').remove()">✕</button></div>
      ${opts.note ? `<p class="muted" style="margin-bottom:12px">${opts.note}</p>` : ''}
      <div class="field"><label>ชื่อผู้ลงนาม</label><input id="ps-name" value="${esc((typeof ME !== 'undefined' && ME && ME.displayName) || '')}"></div>
      ${PS_SIGS.length ? `
        <div class="mlabel">เลือกจากคลังลายเซ็นของคุณ</div>
        <div class="saved-sig-list" style="margin-bottom:12px">
          ${PS_SIGS.map((x) => `<div class="saved-sig-card"><img src="${esc(x.image)}"><div class="ssc-name">${esc(x.name)}</div>
            <button class="btn btn-solid btn-sm" onclick="psUseSaved(${x.id})">ใช้ลงนาม</button></div>`).join('')}
        </div>` : ''}
      <div class="canvas-wrap">
        <div class="canvas-head"><span>วาดลายเซ็น</span><div class="btn-row"><button class="btn btn-ghost btn-sm" onclick="psUndo()">ย้อนกลับ 1 เส้น</button><button class="btn btn-ghost btn-sm" onclick="psClear()">เซ็นใหม่</button></div></div>
        <canvas id="ps-canvas" class="sig-canvas" width="420" height="120"></canvas>
      </div>
      <div class="mlabel" style="margin-top:14px">หรือแนบไฟล์รูปลายเซ็น (PNG แนะนำพื้นหลังโปร่งใส)</div>
      <label class="file-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>
        เลือกไฟล์รูปลายเซ็น
        <input type="file" id="ps-file" accept="image/png,image/jpeg,image/webp" hidden>
      </label>
      <span class="file-name" id="ps-file-name"></span>
      <div id="ps-upload-preview"></div>
      <label class="save-sig-check"><input type="checkbox" id="ps-keep" checked> บันทึกลายเซ็นนี้เข้าคลังของฉัน</label>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-solid btn-sm" onclick="psSignDrawn()">ลงนามด้วยลายเซ็นที่วาด</button>
        <button class="btn btn-solid btn-sm hidden" id="ps-upload-btn" onclick="psSignUploaded()">ลงนามด้วยรูปที่แนบ</button>
      </div>
      ${opts.onSkip ? '<a class="muted" style="display:inline-block;margin-top:12px;font-size:12px;text-decoration:underline;cursor:pointer" onclick="psSkip()">ข้ามการลงนาม (ดำเนินการต่อโดยไม่เซ็น)</a>' : ''}
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  psInitCanvas();
  const fi = document.getElementById('ps-file');
  fi.addEventListener('change', () => {
    const f = fi.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('รองรับเฉพาะไฟล์รูปภาพ', 'err');
    if (f.size > 2 * 1024 * 1024) return toast('รูปเกิน 2 MB', 'err');
    const rd = new FileReader();
    rd.onload = () => {
      PS_UPLOAD = rd.result;
      document.getElementById('ps-file-name').textContent = f.name;
      document.getElementById('ps-upload-preview').innerHTML = `<div class="preview-card"><img src="${rd.result}" class="sign-preview" style="background:#fff"></div>`;
      document.getElementById('ps-upload-btn').classList.remove('hidden');
    };
    rd.readAsDataURL(f);
  });
}
function psInitCanvas() {
  const c = document.getElementById('ps-canvas');
  if (!c) return;
  psCtx = c.getContext('2d');
  psUndoStack = [];
  psCtx.lineWidth = 2.4; psCtx.lineCap = 'round'; psCtx.strokeStyle = '#1a1a1a';
  const pos = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) }; };
  const st = (e) => { psDrawing = true; psDrawn = true; try { psUndoStack.push(psCtx.getImageData(0, 0, c.width, c.height)); if (psUndoStack.length > 40) psUndoStack.shift(); } catch {} const { x, y } = pos(e); psCtx.beginPath(); psCtx.moveTo(x, y); e.preventDefault(); };
  const mv = (e) => { if (!psDrawing) return; const { x, y } = pos(e); psCtx.lineTo(x, y); psCtx.stroke(); e.preventDefault(); };
  c.addEventListener('mousedown', st); c.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => { psDrawing = false; });
  c.addEventListener('touchstart', st); c.addEventListener('touchmove', mv); c.addEventListener('touchend', () => { psDrawing = false; });
}
function psClear() { const c = document.getElementById('ps-canvas'); psCtx.clearRect(0, 0, c.width, c.height); psDrawn = false; psUndoStack = []; }
function psUndo() {
  const c = document.getElementById('ps-canvas');
  const prev = psUndoStack.pop();
  if (prev) { psCtx.putImageData(prev, 0, 0); if (!psUndoStack.length) psDrawn = false; }
  else { psCtx.clearRect(0, 0, c.width, c.height); psDrawn = false; }
}
async function psUseSaved(sigId) {
  const sig = PS_SIGS.find((x) => x.id === sigId);
  if (sig) await psSubmit(sig.image, sig.name, false);
}
async function psSignDrawn() {
  if (!psDrawn) return toast('กรุณาวาดลายเซ็นก่อน', 'err');
  await psSubmit(document.getElementById('ps-canvas').toDataURL('image/png'), null, document.getElementById('ps-keep').checked);
}
async function psSignUploaded() {
  if (!PS_UPLOAD) return toast('กรุณาเลือกไฟล์รูปก่อน', 'err');
  await psSubmit(PS_UPLOAD, null, document.getElementById('ps-keep').checked);
}
async function psSubmit(image, fallbackName, keep) {
  const name = (document.getElementById('ps-name').value || '').trim() || fallbackName || (typeof ME !== 'undefined' && ME ? ME.displayName : '');
  const result = await otpGate({
    purpose: 'sign-doc', refId: PS_OPTS.docId,
    title: 'ยืนยันการลงลายมือชื่อดิจิทัล',
    action: (otpId, code) => api.post(`/api/documents/${PS_OPTS.docId}/sign`, { signerName: name, image, otpId, code }),
  });
  if (!result) return;
  if (keep) await api.post('/api/signatures', { name, image });
  toast('ลงนามเรียบร้อย' + (keep ? ' และบันทึกเข้าคลังลายเซ็นแล้ว' : ''));
  const m = document.getElementById('sign-prompt-modal'); if (m) m.remove();
  PS_UPLOAD = null; psDrawn = false;
  await openDoc(PS_OPTS.docId);
  onChangeCb && onChangeCb();
  if (PS_OPTS.onDone) PS_OPTS.onDone();
}
function psSkip() {
  const m = document.getElementById('sign-prompt-modal'); if (m) m.remove();
  if (PS_OPTS && PS_OPTS.onSkip) PS_OPTS.onSkip();
}
