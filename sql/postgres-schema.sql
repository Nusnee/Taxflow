-- sql/postgres-schema.sql
-- โครงสร้างฐานข้อมูล PostgreSQL สำหรับ TaxFlow — คู่ขนานกับ lib/store.js (SQLite)
-- ออกแบบด้วยแนวคิดเดียวกัน: แต่ละแถวเก็บ "ข้อมูลทั้งก้อน" เป็น JSONB ในคอลัมน์ data
-- และคัดลอกเฉพาะคอลัมน์ที่ต้อง query บ่อยออกมาเป็นคอลัมน์จริงพร้อมดัชนี (ตรงกับ INDEXED ใน store.js)
-- เพื่อให้ API/หน้าเว็บส่วนอื่นไม่ต้องแก้โครงสร้างข้อมูลเลยเมื่อย้ายฐานข้อมูล
--
-- วิธีรัน: psql "$DATABASE_URL" -f sql/postgres-schema.sql
-- (ดูขั้นตอนติดตั้งแบบละเอียดใน README.md หัวข้อ "ต่อฐานข้อมูล PostgreSQL")

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  type TEXT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  "docId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_versions (
  id BIGSERIAL PRIMARY KEY,
  "docId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  "docId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  id BIGSERIAL PRIMARY KEY,
  token TEXT UNIQUE,
  "docId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS library (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  category TEXT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS signatures (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  "docId" BIGINT,
  "fromUserId" BIGINT,
  "toUserId" BIGINT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  purpose TEXT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  "docType" TEXT,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS consents (
  id BIGSERIAL PRIMARY KEY,
  "userId" BIGINT,
  data JSONB NOT NULL
);

-- ดัชนีจริง (ตรงกับ INDEXED ใน lib/store.js และ lib/store.pg.js)
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_documents_userid ON documents ("userId");
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (type);
CREATE INDEX IF NOT EXISTS idx_contacts_userid ON contacts ("userId");
CREATE INDEX IF NOT EXISTS idx_attachments_userid ON attachments ("userId");
CREATE INDEX IF NOT EXISTS idx_attachments_docid ON attachments ("docId");
CREATE INDEX IF NOT EXISTS idx_docversions_docid ON doc_versions ("docId");
CREATE INDEX IF NOT EXISTS idx_auditlog_userid ON audit_log ("userId");
CREATE INDEX IF NOT EXISTS idx_auditlog_docid ON audit_log ("docId");
CREATE INDEX IF NOT EXISTS idx_notifications_userid ON notifications ("userId");
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares (token);
CREATE INDEX IF NOT EXISTS idx_shares_docid ON shares ("docId");
CREATE INDEX IF NOT EXISTS idx_library_userid ON library ("userId");
CREATE INDEX IF NOT EXISTS idx_library_category ON library (category);
CREATE INDEX IF NOT EXISTS idx_signatures_userid ON signatures ("userId");
CREATE INDEX IF NOT EXISTS idx_requests_docid ON requests ("docId");
CREATE INDEX IF NOT EXISTS idx_requests_fromuserid ON requests ("fromUserId");
CREATE INDEX IF NOT EXISTS idx_requests_touserid ON requests ("toUserId");
CREATE INDEX IF NOT EXISTS idx_otpcodes_userid ON otp_codes ("userId");
CREATE INDEX IF NOT EXISTS idx_otpcodes_purpose ON otp_codes (purpose);
CREATE INDEX IF NOT EXISTS idx_kycdocuments_userid ON kyc_documents ("userId");
CREATE INDEX IF NOT EXISTS idx_kycdocuments_doctype ON kyc_documents ("docType");
CREATE INDEX IF NOT EXISTS idx_consents_userid ON consents ("userId");

-- ดัชนีเสริมสำหรับค้นหาในก้อน JSONB โดยตรง (เผื่อ query ที่ store.pg.js ยังไม่มี SQL เฉพาะให้)
CREATE INDEX IF NOT EXISTS idx_documents_data_gin ON documents USING GIN (data);

COMMIT;
