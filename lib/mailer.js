'use strict';

/**
 * mailer.js — ส่งอีเมลจริงด้วยโปรโตคอล SMTP ล้วน (Node core: tls) ไม่ใช้ไลบรารีภายนอก
 * -------------------------------------------------------------------------------
 * วิธีตั้งค่าให้ส่งอีเมล OTP เข้า Gmail จริง (ทำครั้งเดียว):
 *   1) เปิดการยืนยัน 2 ขั้นตอน (2-Step Verification) ในบัญชี Gmail ที่จะใช้ส่ง
 *      https://myaccount.google.com/security
 *   2) สร้าง "รหัสผ่านแอป" (App Password) ที่ https://myaccount.google.com/apppasswords
 *      (เลือกแอป "Mail" จะได้รหัส 16 หลัก เช่น abcd efgh ijkl mnop)
 *   3) คัดลอกไฟล์ data/mail.config.example.json → data/mail.config.json
 *      แล้วกรอกอีเมลผู้ส่งกับรหัสแอปที่ได้ลงไป (ไฟล์นี้จะไม่ถูกอัปโหลดไปที่ไหน อยู่ในเครื่องเท่านั้น)
 *   4) รัน `node server.js` ใหม่ — ระบบจะอ่านค่าไฟล์นี้และเริ่มส่งอีเมลจริงทันที
 *
 * ถ้ายังไม่ได้ตั้งค่า (ไม่มีไฟล์ / ไม่กรอกอีเมล-รหัส) ระบบจะเข้า "โหมดพัฒนา":
 *   - จะไม่ส่งอีเมลจริง แต่จะพิมพ์รหัส OTP ออกทาง console ของเซิร์ฟเวอร์แทน
 *   - และแนบรหัส (devCode) กลับไปกับ response ให้หน้าเว็บแสดงให้กรอกได้ทันที เพื่อไม่ให้ทดสอบระบบติดขัด
 *   - เหมาะสำหรับพัฒนา/สาธิตในเครื่อง ไม่ควรใช้ในสภาพแวดล้อมจริง
 */

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'mail.config.json');

function loadConfig() {
  // 1) ไฟล์ data/mail.config.json (แนะนำ — ไม่ต้องตั้ง environment variable)
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      if (raw.user && raw.pass) {
        return {
          host: raw.host || 'smtp.gmail.com',
          port: Number(raw.port) || 465,
          user: raw.user,
          pass: raw.pass,
          fromName: raw.fromName || 'TaxFlow',
        };
      }
    }
  } catch { /* ไฟล์ผิดรูปแบบ — ใช้ค่า env / โหมดพัฒนาแทน */ }

  // 2) environment variables (ทางเลือกสำหรับ deploy บนเซิร์ฟเวอร์จริง)
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      fromName: process.env.SMTP_FROM_NAME || 'TaxFlow',
    };
  }
  return null; // ไม่ได้ตั้งค่า -> โหมดพัฒนา
}

const CONFIG = loadConfig();
const MAIL_CONFIGURED = !!CONFIG;
// ส่งรหัส OTP กลับมาใน response (devCode) ได้เฉพาะเมื่อ "ตั้งใจ" เปิดโหมดพัฒนาอย่างชัดเจน
// เท่านั้น (TAXFLOW_DEV=1) — ไม่ใช่แค่ยังไม่ได้ตั้งค่าอีเมล เพราะมิฉะนั้นระบบยืนยันตัวตน
// ด้วย OTP ทั้งหมดจะถูกข้ามได้ทันทีถ้าลืมตั้งค่าอีเมลตอนขึ้น production
const DEV_EXPOSE_CODE = !MAIL_CONFIGURED && process.env.TAXFLOW_DEV === '1';

if (!MAIL_CONFIGURED) {
  console.log('\n[mailer] ยังไม่ได้ตั้งค่าอีเมลผู้ส่ง (data/mail.config.json) — รหัส OTP จะแสดงทาง console ของเซิร์ฟเวอร์แทนการส่งอีเมลจริง');
  console.log(DEV_EXPOSE_CODE
    ? '[mailer] TAXFLOW_DEV=1 — จะแนบรหัส OTP กลับไปกับ response ด้วย (ใช้เฉพาะพัฒนา/ทดสอบเท่านั้น ห้ามเปิดใน production)\n'
    : '[mailer] TAXFLOW_DEV ไม่ได้ตั้งเป็น 1 — จะไม่แนบรหัส OTP กลับไปกับ response (ต้องอ่านจาก console ของเซิร์ฟเวอร์)\n');
} else {
  console.log(`[mailer] ตั้งค่าอีเมลผู้ส่งแล้ว: ${CONFIG.user} (${CONFIG.host}:${CONFIG.port}) — จะส่งอีเมลจริง`);
}

/* ---------- SMTP client แบบดิบ (raw socket, ไม่ใช้ไลบรารีภายนอก) ---------- */
function smtpSend({ host, port, user, pass, from, fromName, to, subject, text }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 15000 }, () => {});
    let buf = '';
    let step = 'greet';
    let finished = false;

    const fail = (err) => { if (finished) return; finished = true; try { socket.destroy(); } catch {} reject(err); };
    const succeed = () => { if (finished) return; finished = true; try { socket.end(); } catch {} resolve(); };

    socket.setTimeout(15000, () => fail(new Error('การเชื่อมต่อ SMTP หมดเวลา (timeout)')));
    socket.on('error', (e) => fail(e));

    function write(line) { socket.write(line + '\r\n'); }

    function encodeSubject(s) {
      return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
    }
    function encodeBase64Body(s) {
      const b64 = Buffer.from(s, 'utf8').toString('base64');
      return (b64.match(/.{1,76}/g) || ['']).join('\r\n');
    }

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      // ยังไม่ครบก้อนข้อความ (บรรทัดสุดท้ายของ response ต้องเป็น "รหัส 3 หลัก + เว้นวรรค")
      if (!/^\d{3} /.test(last)) return;
      const code = last.slice(0, 3);
      buf = '';

      try {
        if (step === 'greet') {
          if (code !== '220') return fail(new Error('SMTP server ปฏิเสธการเชื่อมต่อ: ' + last));
          write(`EHLO taxflow.local`); step = 'ehlo';
        } else if (step === 'ehlo') {
          if (code !== '250') return fail(new Error('EHLO ไม่สำเร็จ: ' + last));
          write('AUTH LOGIN'); step = 'auth-user';
        } else if (step === 'auth-user') {
          if (code !== '334') return fail(new Error('เซิร์ฟเวอร์ไม่รองรับ AUTH LOGIN: ' + last));
          write(Buffer.from(user, 'utf8').toString('base64')); step = 'auth-pass';
        } else if (step === 'auth-pass') {
          if (code !== '334') return fail(new Error('ส่งชื่อผู้ใช้ไม่สำเร็จ: ' + last));
          write(Buffer.from(pass, 'utf8').toString('base64')); step = 'auth-ok';
        } else if (step === 'auth-ok') {
          if (code !== '235') return fail(new Error('เข้าสู่ระบบ SMTP ไม่สำเร็จ (ตรวจสอบอีเมล/รหัสผ่านแอปอีกครั้ง): ' + last));
          write(`MAIL FROM:<${user}>`); step = 'mail-from';
        } else if (step === 'mail-from') {
          if (code !== '250') return fail(new Error('MAIL FROM ไม่สำเร็จ: ' + last));
          write(`RCPT TO:<${to}>`); step = 'rcpt-to';
        } else if (step === 'rcpt-to') {
          if (code !== '250' && code !== '251') return fail(new Error('ไม่พบผู้รับปลายทาง หรือถูกปฏิเสธ: ' + last));
          write('DATA'); step = 'data';
        } else if (step === 'data') {
          if (code !== '354') return fail(new Error('เริ่มส่งเนื้อหาอีเมลไม่สำเร็จ: ' + last));
          const headers = [
            `From: "${fromName}" <${from}>`,
            `To: <${to}>`,
            `Subject: ${encodeSubject(subject)}`,
            `MIME-Version: 1.0`,
            `Content-Type: text/plain; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <${crypto.randomBytes(12).toString('hex')}@taxflow.local>`,
            '', encodeBase64Body(text), '',
          ].join('\r\n');
          write(headers + '.'); step = 'sent';
        } else if (step === 'sent') {
          if (code !== '250') return fail(new Error('ส่งอีเมลไม่สำเร็จ: ' + last));
          write('QUIT'); step = 'quit';
        } else if (step === 'quit') {
          succeed();
        }
      } catch (e) { fail(e); }
    });
  });
}

/* ---------- ฟังก์ชันสาธารณะ ---------- */

/** ส่งอีเมลทั่วไป — คืนค่า {ok, dev} เสมอ (ไม่ throw ออกไปนอกฟังก์ชัน) */
async function sendMail({ to, subject, text }) {
  if (!MAIL_CONFIGURED) {
    console.log(`\n[mailer] (โหมดพัฒนา — ไม่ได้ส่งอีเมลจริง)\nถึง: ${to}\nเรื่อง: ${subject}\n${text}\n`);
    return { ok: true, dev: DEV_EXPOSE_CODE };
  }
  try {
    await smtpSend({ host: CONFIG.host, port: CONFIG.port, user: CONFIG.user, pass: CONFIG.pass, from: CONFIG.user, fromName: CONFIG.fromName, to, subject, text });
    return { ok: true, dev: false };
  } catch (err) {
    console.error('[mailer] ส่งอีเมลล้มเหลว:', err.message);
    return { ok: false, dev: false, error: err.message };
  }
}

const PURPOSE_TEXT = {
  'register': 'ยืนยันอีเมลเพื่อเปิดใช้งานบัญชีใหม่',
  'login': 'เข้าสู่ระบบ',
  'sign-doc': 'ลงลายมือชื่อดิจิทัลในเอกสาร',
  'sign-request': 'ลงลายมือชื่อดิจิทัลตอบกลับเอกสารที่ได้รับ',
};

/** ส่งอีเมลรหัส OTP โดยเฉพาะ (ใช้ข้อความมาตรฐานเดียวกันทั้งระบบ) */
async function sendOtpEmail(to, { code, purpose, displayName }) {
  const action = PURPOSE_TEXT[purpose] || 'ยืนยันตัวตน';
  const subject = `รหัสยืนยัน TaxFlow: ${code}`;
  const text =
`เรียน ${displayName || ''}

รหัสยืนยันตัวตน (OTP) สำหรับ${action}ของคุณคือ

    ${code}

รหัสนี้มีอายุ 5 นาที และใช้ได้เพียงครั้งเดียว
หากคุณไม่ได้เป็นผู้ทำรายการนี้ กรุณาเปลี่ยนรหัสผ่านบัญชีของคุณทันที และไม่ต้องนำรหัสนี้ไปใช้ที่ใด

— ระบบ TaxFlow (ระบบต้นแบบเพื่อการศึกษา)`;
  const result = await sendMail({ to, subject, text });
  return { ...result, dev: !!result.dev };
}

module.exports = { sendMail, sendOtpEmail, MAIL_CONFIGURED, DEV_EXPOSE_CODE };
