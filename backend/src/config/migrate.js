/**
 * HandyTrust — Full Database Migration
 * Run: node src/config/migrate.js
 */

require('dotenv').config();
const { pool } = require('./database');
const logger = require('../utils/logger');

const SQL = `

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ── ENUMS ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role           AS ENUM ('customer','artisan','admin','support');
  CREATE TYPE user_status         AS ENUM ('active','suspended','pending_verification','banned');
  CREATE TYPE artisan_tier        AS ENUM ('rising','established','elite');
  CREATE TYPE verification_status AS ENUM ('unverified','pending','verified','rejected');
  CREATE TYPE job_status          AS ENUM (
    'reported','matching','matched','accepted',
    'in_progress','evidence_uploaded','pending_confirmation',
    'completed','disputed','cancelled','expired'
  );
  CREATE TYPE payment_status      AS ENUM (
    'pending','held_in_escrow','released',
    'refunded','partially_refunded','disputed'
  );
  CREATE TYPE payment_gateway     AS ENUM ('paystack','flutterwave','wallet');
  CREATE TYPE dispute_status      AS ENUM (
    'open','under_review','resolved_customer',
    'resolved_artisan','escalated','closed'
  );
  CREATE TYPE notification_type   AS ENUM (
    'job_matched','job_accepted','artisan_arrived','job_completed',
    'payment_released','dispute_opened','dispute_resolved',
    'new_message','otp','marketing'
  );
  CREATE TYPE media_type          AS ENUM (
    'before_photo','after_photo','video',
    'document','id_document','certificate','profile_photo'
  );
  CREATE TYPE service_category    AS ENUM (
    'plumbing','electrical','ac_hvac','carpentry','painting',
    'cleaning','solar','flooring','roofing','masonry',
    'landscaping','appliance_repair','event_setup','security','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone             VARCHAR(20) UNIQUE NOT NULL,
  email             VARCHAR(255) UNIQUE,
  full_name         VARCHAR(255) NOT NULL,
  avatar_url        TEXT,
  role              user_role NOT NULL DEFAULT 'customer',
  status            user_status NOT NULL DEFAULT 'pending_verification',
  password_hash     TEXT,
  phone_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  push_token        TEXT,
  whatsapp_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  language          VARCHAR(10) NOT NULL DEFAULT 'en',
  state             VARCHAR(100),
  lga               VARCHAR(100),
  wallet_balance    NUMERIC(12,2) NOT NULL DEFAULT 0,
  referral_code     VARCHAR(20) UNIQUE,
  referred_by       UUID REFERENCES users(id),
  meta              JSONB NOT NULL DEFAULT '{}',
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_phone  ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role, status);

-- ── ARTISAN PROFILES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artisan_profiles (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier                  artisan_tier NOT NULL DEFAULT 'rising',
  bio                   TEXT,
  years_experience      SMALLINT NOT NULL DEFAULT 0,
  categories            service_category[] NOT NULL DEFAULT '{}',
  skills_tags           TEXT[] NOT NULL DEFAULT '{}',
  base_rate_ngn         NUMERIC(10,2),
  is_available          BOOLEAN NOT NULL DEFAULT TRUE,
  availability_schedule JSONB NOT NULL DEFAULT '{}',
  location              GEOGRAPHY(POINT,4326),
  location_address      TEXT,
  service_radius_km     SMALLINT NOT NULL DEFAULT 10,
  verification_status   verification_status NOT NULL DEFAULT 'unverified',
  nin_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  background_checked    BOOLEAN NOT NULL DEFAULT FALSE,
  identity_ref          TEXT,
  total_jobs            INT NOT NULL DEFAULT 0,
  completed_jobs        INT NOT NULL DEFAULT 0,
  avg_rating            NUMERIC(3,2) NOT NULL DEFAULT 0,
  total_reviews         INT NOT NULL DEFAULT 0,
  response_rate         NUMERIC(5,2) NOT NULL DEFAULT 100,
  avg_response_time_min INT NOT NULL DEFAULT 0,
  subscription_active   BOOLEAN NOT NULL DEFAULT FALSE,
  subscription_expires  TIMESTAMPTZ,
  total_earned_ngn      NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending_payout_ngn    NUMERIC(12,2) NOT NULL DEFAULT 0,
  bank_code             VARCHAR(10),
  bank_account_number   VARCHAR(20),
  bank_account_name     VARCHAR(255),
  paystack_recipient_code TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_artisan_location   ON artisan_profiles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_artisan_categories ON artisan_profiles USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_artisan_available  ON artisan_profiles(is_available, verification_status, tier);

-- ── OTP TOKENS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone      VARCHAR(20) NOT NULL,
  code       VARCHAR(6) NOT NULL,
  purpose    VARCHAR(50) NOT NULL,
  attempts   SMALLINT NOT NULL DEFAULT 0,
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_tokens(phone, purpose, verified);

-- ── REFRESH TOKENS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  device_info TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── JOBS ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference           VARCHAR(20) UNIQUE,
  customer_id         UUID NOT NULL REFERENCES users(id),
  artisan_id          UUID REFERENCES users(id),
  status              job_status NOT NULL DEFAULT 'reported',
  category            service_category NOT NULL,
  sub_category        VARCHAR(100),
  title               VARCHAR(255) NOT NULL,
  description         TEXT NOT NULL,
  ai_classification   JSONB,
  urgency_level       SMALLINT NOT NULL DEFAULT 2 CHECK (urgency_level BETWEEN 1 AND 5),
  location            GEOGRAPHY(POINT,4326) NOT NULL,
  location_address    TEXT NOT NULL,
  location_meta       JSONB NOT NULL DEFAULT '{}',
  scheduled_at        TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by        UUID REFERENCES users(id),
  agreed_price_ngn    NUMERIC(10,2),
  final_price_ngn     NUMERIC(10,2),
  platform_fee_ngn    NUMERIC(10,2),
  artisan_payout_ngn  NUMERIC(10,2),
  payment_status      payment_status NOT NULL DEFAULT 'pending',
  payment_gateway     payment_gateway,
  escrow_ref          TEXT,
  customer_rating     SMALLINT CHECK (customer_rating BETWEEN 1 AND 5),
  customer_review     TEXT,
  artisan_response    TEXT,
  review_at           TIMESTAMPTZ,
  ai_match_scores     JSONB,
  matched_artisans    JSONB,
  is_rebook           BOOLEAN NOT NULL DEFAULT FALSE,
  original_job_id     UUID REFERENCES jobs(id),
  meta                JSONB NOT NULL DEFAULT '{}',
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_customer  ON jobs(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_artisan   ON jobs(artisan_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_location  ON jobs USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_jobs_reference ON jobs(reference);

-- ── JOB INVITATIONS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_invitations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  artisan_id    UUID NOT NULL REFERENCES users(id),
  is_rising_pro BOOLEAN NOT NULL DEFAULT FALSE,
  match_score   NUMERIC(5,2),
  eta_minutes   SMALLINT,
  distance_km   NUMERIC(6,2),
  status        VARCHAR(30) NOT NULL DEFAULT 'pending',
  viewed_at     TIMESTAMPTZ,
  responded_at  TIMESTAMPTZ,
  decline_reason TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_job     ON job_invitations(job_id);
CREATE INDEX IF NOT EXISTS idx_invitations_artisan ON job_invitations(artisan_id, status);

-- ── MESSAGES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id),
  content      TEXT,
  media_url    TEXT,
  media_type   VARCHAR(30),
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  is_agreement BOOLEAN NOT NULL DEFAULT FALSE,
  read_at      TIMESTAMPTZ,
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_job ON messages(job_id, created_at);

-- ── JOB EVIDENCE ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_evidence (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  media_type      media_type NOT NULL,
  url             TEXT NOT NULL,
  thumbnail_url   TEXT,
  file_size_kb    INT,
  mime_type       VARCHAR(50),
  geo_lat         NUMERIC(9,6),
  geo_lng         NUMERIC(9,6),
  captured_at     TIMESTAMPTZ NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_tamper_proof BOOLEAN NOT NULL DEFAULT TRUE,
  hash            TEXT NOT NULL,
  meta            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_evidence_job ON job_evidence(job_id, media_type);

-- ── JOB CHECKLISTS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_checklists (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id     UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  items      JSONB NOT NULL DEFAULT '[]',
  signed_by  UUID REFERENCES users(id),
  signed_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PAYMENTS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES jobs(id),
  payer_id          UUID NOT NULL REFERENCES users(id),
  payee_id          UUID REFERENCES users(id),
  amount_ngn        NUMERIC(12,2) NOT NULL,
  fee_ngn           NUMERIC(10,2) NOT NULL DEFAULT 0,
  platform_cut_ngn  NUMERIC(10,2) NOT NULL DEFAULT 0,
  artisan_net_ngn   NUMERIC(12,2) NOT NULL DEFAULT 0,
  gateway           payment_gateway NOT NULL,
  gateway_ref       TEXT,
  gateway_meta      JSONB NOT NULL DEFAULT '{}',
  status            payment_status NOT NULL DEFAULT 'pending',
  escrow_held_at    TIMESTAMPTZ,
  released_at       TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  refund_reason     TEXT,
  initiated_by      UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_job   ON payments(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_id, status);

-- ── DISPUTES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES jobs(id),
  payment_id        UUID REFERENCES payments(id),
  raised_by         UUID NOT NULL REFERENCES users(id),
  against           UUID NOT NULL REFERENCES users(id),
  reason            TEXT NOT NULL,
  category          VARCHAR(100),
  status            dispute_status NOT NULL DEFAULT 'open',
  assigned_to       UUID REFERENCES users(id),
  resolution        TEXT,
  resolution_type   VARCHAR(50),
  refund_amount_ngn NUMERIC(12,2),
  evidence_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  sla_deadline      TIMESTAMPTZ NOT NULL,
  resolved_at       TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  meta              JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disputes_job    ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, sla_deadline);

-- ── ARTISAN LOCATION TRACKING ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artisan_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artisan_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
  location    GEOGRAPHY(POINT,4326) NOT NULL,
  speed_kmh   NUMERIC(5,2),
  bearing     SMALLINT,
  accuracy_m  NUMERIC(6,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '4 hours')
);
CREATE INDEX IF NOT EXISTS idx_artisan_loc ON artisan_locations(artisan_id, expires_at DESC);

-- ── REVIEWS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id               UUID NOT NULL UNIQUE REFERENCES jobs(id),
  reviewer_id          UUID NOT NULL REFERENCES users(id),
  reviewee_id          UUID NOT NULL REFERENCES users(id),
  rating               SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text          TEXT,
  quality_score        SMALLINT CHECK (quality_score BETWEEN 1 AND 5),
  punctuality_score    SMALLINT CHECK (punctuality_score BETWEEN 1 AND 5),
  communication_score  SMALLINT CHECK (communication_score BETWEEN 1 AND 5),
  value_score          SMALLINT CHECK (value_score BETWEEN 1 AND 5),
  artisan_response     TEXT,
  is_verified          BOOLEAN NOT NULL DEFAULT TRUE,
  helpful_count        INT NOT NULL DEFAULT 0,
  flags                INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id, rating, created_at DESC);

-- ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           notification_type NOT NULL,
  title          VARCHAR(255) NOT NULL,
  body           TEXT NOT NULL,
  data           JSONB NOT NULL DEFAULT '{}',
  read           BOOLEAN NOT NULL DEFAULT FALSE,
  sent_push      BOOLEAN NOT NULL DEFAULT FALSE,
  sent_sms       BOOLEAN NOT NULL DEFAULT FALSE,
  sent_whatsapp  BOOLEAN NOT NULL DEFAULT FALSE,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ── AUDIT LOGS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id),
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(100),
  entity_id  UUID,
  old_value  JSONB,
  new_value  JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

-- ── SERVICE CONFIGS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_configs (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category           service_category UNIQUE NOT NULL,
  display_name       VARCHAR(100) NOT NULL,
  icon               TEXT,
  base_price_ngn     NUMERIC(10,2),
  checklist_template JSONB NOT NULL DEFAULT '[]',
  matching_weights   JSONB NOT NULL DEFAULT '{}',
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUTO updated_at TRIGGER ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','artisan_profiles','jobs','payments',
    'disputes','reviews','job_checklists'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ── JOB REFERENCE TRIGGER ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_job_reference()
RETURNS TRIGGER AS $$
BEGIN
  NEW.reference := 'HT-' || UPPER(SUBSTRING(MD5(NEW.id::TEXT) FROM 1 FOR 6));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_reference ON jobs;
CREATE TRIGGER trg_job_reference
  BEFORE INSERT ON jobs FOR EACH ROW
  WHEN (NEW.reference IS NULL)
  EXECUTE FUNCTION generate_job_reference();
`;

async function migrate() {
    const client = await pool.connect();
    try {
        logger.info('Running migration…');
        await client.query(SQL);
        logger.info('✅ Migration complete');
    } catch (err) {
        logger.error('Migration failed', { error: err.message });
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();