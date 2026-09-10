/* requests.js — กล่องรับเอกสาร (ver6): เอกสารที่คู่ค้าส่งมาให้ลงนาม/ตรวจสอบ
 * ผู้รับลงนามด้วย "คลังลายเซ็นของบัญชีตนเอง" หรือวาดใหม่ */

const RQ_ST = { sent: '<span class="stbadge st-pending">รอดำเนินการ</span>', signed: '<span class="stbadge st-approved">ลงนามแล้ว</span>', approved: '<span class="stbadge st-approved">ตรวจแล้วผ่าน</span>', declined: '<span class="stbadge st-rejected">ตีกลับแล้ว</span>', cancelled: '<span class="stbadge st-cancelled">ผู้ส่งยกเลิก</span>' };

async function loadInbox() {
  const { items, actionCount } = await api.get('/api/requests/inbox');
  updateInboxBadge(actionCount);
  const pending = (items || []).filter((r) => r.status === 'sent');
  const history = (items || []).filter((r) => r.status !== 'sent');

  const card = (r, actionable) => `
    <div class="rq-card ${r.overdue ? 'overdue' : ''}">
      <div class="rq-head">
        <div>
          <b>${DOC_LABEL[r.doc?.type] || r.doc?.type || 'เอกสาร'}</b>
          <span class="docno" style="font-size:12px;margin-left:6px">${r.doc?.docNo || ''}</span>
        </div>
        <div>${RQ_ST[r.status] || r.status}</div>
      </div>
      <div class="rq-body">
        จาก <b>${r.fromName}</b> <small class="muted">(${r.fromEmail})</small> ·
        ${r.purpose === 'sign' ? 'ขอให้คุณ<b>ลงนาม</b>' : 'ขอให้คุณ<b>ตรวจสอบ</b>'}
        ${r.signAs ? 'ในฐานะ <b>' + r.signAs + '</b>' : ''}
        ${r.dueDate ? ` · ภายในวันที่ <b${r.overdue ? ' style="color:var(--danger)"' : ''}>${r.dueDate}${r.overdue ? ' (เกินกำหนด!)' : ''}</b>` : ''}
        ${r.doc && r.doc.total ? ` · ยอด ฿${baht(r.doc.total)}` : ''}
        ${r.message ? `<div class="rq-msg">ข้อความ: ${r.message}</div>` : ''}
      </div>
      <div class="btn-row">
        <a class="btn btn-ghost btn-sm" href="/api/requests/${r.id}/pdf" target="_blank">เปิดดูเอกสาร</a>
        ${actionable && r.purpose === 'sign' ? `<button class="btn btn-solid btn-sm" onclick="openReqSign(${r.id})">ลงนาม</button>` : ''}
        ${actionable && r.purpose === 'review' ? `<button class="btn btn-success btn-sm" onclick="approveReq(${r.id})">✓ ตรวจแล้ว ผ่าน</button>` : ''}
        ${actionable ? `<button class="btn btn-danger btn-sm" onclick="declineReq(${r.id})">ตีกลับ</button>` : ''}
      </div>
    </div>`;

  const pbox = document.getElementById('inbox-pending');
  const hbox = document.getElementById('inbox-history');
  if (pbox) pbox.innerHTML = pending.map((r) => card(r, true)).join('') ||
    '<div class="empty" style="color:var(--ink-soft);padding:24px;text-align:center;">ไม่มีเอกสารรอดำเนินการ</div>';
  if (hbox) hbox.innerHTML = history.map((r) => card(r, false)).join('') ||
    '<p class="muted" style="padding:8px">ยังไม่มีประวัติ</p>';
}

function updateInboxBadge(n) {
  const b = document.getElementById('inbox-badge');
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
}

/* ---------- ลงนามตอบกลับ (ใช้คลังลายเซ็นของฉัน) ---------- */
let RQ_SIGNING = null;
async function openReqSign(reqId) {
  RQ_SIGNING = reqId;
  const { items } = await api.get('/api/signatures');
  const sigs = items || [];
  const old = document.getElementById('rq-sign-modal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'modal-bg';
  wrap.id = 'rq-sign-modal';
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-top"><h3>ลงนามเอกสาร</h3><button class="icon-btn" onclick="document.getElementById('rq-sign-modal').remove()">✕</button></div>
      <div class="field"><label>ชื่อผู้ลงนาม</label><input id="rqs-name" value="${(ME && ME.displayName) || ''}"></div>
      ${sigs.length ? `
        <div class="mlabel">เลือกจากคลังลายเซ็นของคุณ</div>
        <div class="saved-sig-list" style="margin-bottom:14px">
          ${sigs.map((x) => `<div class="saved-sig-card"><img src="${x.image}"><div class="ssc-name">${x.name}</div>
            <button class="btn btn-solid btn-sm" onclick="reqSignWith('${x.id}')">ใช้ลงนาม</button></div>`).join('')}
        </div>
` : ''}
      <div class="canvas-wrap">
        <div class="canvas-head"><span>วาดลายเซ็น</span><div class="btn-row"><button class="btn btn-ghost btn-sm" onclick="rqsUndo()">ย้อนกลับ 1 เส้น</button><button class="btn btn-ghost btn-sm" onclick="rqsClear()">เซ็นใหม่</button></div></div>
        <canvas id="rqs-canvas" class="sig-canvas" width="420" height="130"></canvas>
      </div>
      <div class="mlabel" style="margin-top:14px">หรือแนบไฟล์รูปลายเซ็น (PNG แนะนำพื้นหลังโปร่งใส)</div>
      <label class="file-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>
        เลือกไฟล์รูปลายเซ็น
        <input type="file" id="rqs-file" accept="image/png,image/jpeg,image/webp" hidden>
      </label>
      <span class="file-name" id="rqs-file-name"></span>
      <div id="rqs-upload-preview"></div>
      <label class="save-sig-check"><input type="checkbox" id="rqs-keep" checked> บันทึกเข้าคลังลายเซ็นของฉัน</label>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="rqsClear()">ล้าง</button>
        <button class="btn btn-solid btn-sm" onclick="reqSignDrawn()">ลงนามด้วยลายเซ็นที่วาด</button>
        <button class="btn btn-solid btn-sm hidden" id="rqs-upload-btn" onclick="reqSignUploaded()">ลงนามด้วยรูปที่แนบ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
  RQ_SIGS = sigs;
  rqsInitCanvas();
  const fi = document.getElementById('rqs-file');
  fi.addEventListener('change', () => {
    const f = fi.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('รองรับเฉพาะไฟล์รูปภาพ', 'err');
    if (f.size > 2 * 1024 * 1024) return toast('รูปเกิน 2 MB', 'err');
    const rd = new FileReader();
    rd.onload = () => {
      RQ_UPLOAD = rd.result;
      document.getElementById('rqs-file-name').textContent = f.name;
      document.getElementById('rqs-upload-preview').innerHTML = `<div class="preview-card"><img src="${rd.result}" class="sign-preview" style="background:#fff"></div>`;
      document.getElementById('rqs-upload-btn').classList.remove('hidden');
    };
    rd.readAsDataURL(f);
  });
}
let RQ_UPLOAD = null;
async function reqSignUploaded() {
  if (!RQ_UPLOAD) return toast('กรุณาเลือกไฟล์รูปก่อน', 'err');
  const name = document.getElementById('rqs-name').value.trim();
  if (document.getElementById('rqs-keep').checked) await api.post('/api/signatures', { name: name || (ME && ME.displayName), image: RQ_UPLOAD });
  await submitReqSign(RQ_UPLOAD, name);
  RQ_UPLOAD = null;
}
let RQ_SIGS = [], rqsCtx, rqsDrawing = false, rqsDrawn = false, rqsUndoStack = [];
function rqsInitCanvas() {
  const c = document.getElementById('rqs-canvas');
  if (!c) return;
  rqsCtx = c.getContext('2d');
  rqsUndoStack = [];
  rqsCtx.lineWidth = 2.4; rqsCtx.lineCap = 'round'; rqsCtx.strokeStyle = '#1a1a1a';
  const pos = (e) => { const r = c.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: (p.clientX - r.left) * (c.width / r.width), y: (p.clientY - r.top) * (c.height / r.height) }; };
  const st = (e) => { rqsDrawing = true; rqsDrawn = true; try { rqsUndoStack.push(rqsCtx.getImageData(0, 0, c.width, c.height)); if (rqsUndoStack.length > 40) rqsUndoStack.shift(); } catch {} const { x, y } = pos(e); rqsCtx.beginPath(); rqsCtx.moveTo(x, y); e.preventDefault(); };
  const mv = (e) => { if (!rqsDrawing) return; const { x, y } = pos(e); rqsCtx.lineTo(x, y); rqsCtx.stroke(); e.preventDefault(); };
  c.addEventListener('mousedown', st); c.addEventListener('mousemove', mv); window.addEventListener('mouseup', () => { rqsDrawing = false; });
  c.addEventListener('touchstart', st); c.addEventListener('touchmove', mv); c.addEventListener('touchend', () => { rqsDrawing = false; });
}
function rqsClear() { const c = document.getElementById('rqs-canvas'); rqsCtx.clearRect(0, 0, c.width, c.height); rqsDrawn = false; rqsUndoStack = []; }
function rqsUndo() {
  const c = document.getElementById('rqs-canvas');
  const prev = rqsUndoStack.pop();
  if (prev) { rqsCtx.putImageData(prev, 0, 0); if (!rqsUndoStack.length) rqsDrawn = false; }
  else { rqsCtx.clearRect(0, 0, c.width, c.height); rqsDrawn = false; }
}

async function reqSignWith(sigId) {
  const sig = RQ_SIGS.find((x) => String(x.id) === String(sigId));
  if (!sig) return;
  await submitReqSign(sig.image, sig.name);
}
async function reqSignDrawn() {
  if (!rqsDrawn) return toast('กรุณาวาดลายเซ็นก่อน', 'err');
  const image = document.getElementById('rqs-canvas').toDataURL('image/png');
  const name = document.getElementById('rqs-name').value.trim();
  if (document.getElementById('rqs-keep').checked) await api.post('/api/signatures', { name: name || (ME && ME.displayName), image });
  await submitReqSign(image, name);
}
async function submitReqSign(image, fallbackName) {
  const name = (document.getElementById('rqs-name')?.value || '').trim() || fallbackName;
  const result = await otpGate({
    purpose: 'sign-request', refId: RQ_SIGNING,
    title: 'ยืนยันการลงลายมือชื่อดิจิทัล',
    action: (otpId, code) => api.post(`/api/requests/${RQ_SIGNING}/sign`, { signerName: name, image, otpId, code }),
  });
  if (!result) return;
  toast('ลงนามและส่งกลับให้ผู้ส่งเรียบร้อย');
  const m = document.getElementById('rq-sign-modal'); if (m) m.remove();
  loadInbox();
}
async function approveReq(reqId) {
  const { ok, data } = await api.post(`/api/requests/${reqId}/approve`, {});
  if (!ok) return toast(data.error || 'ไม่สำเร็จ', 'err');
  toast('แจ้งผลตรวจสอบ (ผ่าน) กลับไปแล้ว');
  loadInbox();
}
async function declineReq(reqId) {
  const r = await uiPrompt('ระบุเหตุผลที่ตีกลับ เพื่อแจ้งให้ผู้ส่งทราบ (เว้นว่างได้)', { title: 'ตีกลับเอกสาร', placeholder: 'เช่น ข้อมูลไม่ครบถ้วน' });
  if (r === null) return;
  const reason = r;
  const { ok, data } = await api.post(`/api/requests/${reqId}/decline`, { reason });
  if (!ok) return toast(data.error || 'ไม่สำเร็จ', 'err');
  toast('ตีกลับเอกสารพร้อมแจ้งเหตุผลแล้ว');
  loadInbox();
}
