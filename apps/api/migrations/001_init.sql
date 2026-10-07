-- ServiceHub initial schema. Money is stored as integer paise (INR * 100).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CUSTOMER','SERVICE_PROVIDER','ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE customer_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address TEXT, city TEXT, pincode TEXT
);

CREATE TABLE provider_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT,
  bio TEXT,
  experience_years INT NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  skills TEXT[] NOT NULL DEFAULT '{}',
  city TEXT,
  gstin TEXT,
  verification_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (verification_status IN ('PENDING','APPROVED','REJECTED')),
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0
);
CREATE INDEX provider_profiles_city_idx ON provider_profiles (lower(city));
CREATE INDEX provider_profiles_rating_idx ON provider_profiles (rating_avg DESC);

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX services_category_idx ON services (category_id);

CREATE TABLE provider_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  service_id INT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  price_paise INT NOT NULL CHECK (price_paise > 0),
  price_unit TEXT NOT NULL DEFAULT 'FIXED' CHECK (price_unit IN ('FIXED','PER_HOUR','PER_UNIT')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (provider_id, service_id)
);
CREATE INDEX provider_services_service_idx ON provider_services (service_id) WHERE is_active;
CREATE INDEX provider_services_price_idx ON provider_services (price_paise);

CREATE TABLE service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  pincode TEXT
);
CREATE UNIQUE INDEX service_areas_unique ON service_areas (provider_id, lower(city), coalesce(pincode, ''));
CREATE INDEX service_areas_city_idx ON service_areas (lower(city));

CREATE TABLE availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX availability_provider_idx ON availability (provider_id, weekday);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO platform_settings (key, value) VALUES ('platform_fee_percent', '10');

-- A "service request" is a booking in REQUESTED state: one entity, one state machine.
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id),
  provider_service_id UUID REFERENCES provider_services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,            -- snapshot
  category_name TEXT NOT NULL,           -- snapshot
  listed_price_paise INT,                -- snapshot of provider's listed price
  description TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT,
  preferred_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN
    ('REQUESTED','QUOTED','NEGOTIATING','ACCEPTED','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','DISPUTED')),
  agreed_price_paise INT CHECK (agreed_price_paise IS NULL OR agreed_price_paise > 0),
  platform_fee_percent NUMERIC(5,2),
  platform_fee_paise INT,
  cancelled_reason TEXT,
  cancelled_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (customer_id <> provider_id)
);
CREATE INDEX bookings_customer_idx ON bookings (customer_id, created_at DESC);
CREATE INDEX bookings_provider_idx ON bookings (provider_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status);

CREATE TABLE booking_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_attachments_idx ON booking_attachments (booking_id);

-- Quotations and negotiation share one append-only history (a quote is simply the first offer).
CREATE TABLE price_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  offered_by UUID NOT NULL REFERENCES users(id),
  offered_by_role TEXT NOT NULL CHECK (offered_by_role IN ('CUSTOMER','SERVICE_PROVIDER')),
  amount_paise INT NOT NULL CHECK (amount_paise > 0),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
CREATE INDEX price_offers_booking_idx ON price_offers (booking_id, created_at);
-- At most one live offer and one accepted offer per booking, enforced by the DB.
CREATE UNIQUE INDEX price_offers_one_pending ON price_offers (booking_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX price_offers_one_accepted ON price_offers (booking_id) WHERE status = 'ACCEPTED';

CREATE TABLE booking_status_history (
  id BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_idx ON booking_status_history (booking_id, created_at);

CREATE SEQUENCE invoice_number_seq START 1001;
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id),
  invoice_number TEXT NOT NULL UNIQUE,
  customer_snapshot JSONB NOT NULL,
  provider_snapshot JSONB NOT NULL,
  service_name TEXT NOT NULL,
  description TEXT,
  subtotal_paise INT NOT NULL CHECK (subtotal_paise >= 0),
  additional_charges_paise INT NOT NULL DEFAULT 0 CHECK (additional_charges_paise >= 0),
  discount_paise INT NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax_paise INT NOT NULL DEFAULT 0,
  total_paise INT NOT NULL CHECK (total_paise >= 0),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_price_paise INT NOT NULL CHECK (unit_price_paise >= 0),
  amount_paise INT NOT NULL CHECK (amount_paise >= 0)
);
CREATE INDEX invoice_items_idx ON invoice_items (invoice_id);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_paise INT NOT NULL CHECK (amount_paise > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH','UPI','CARD','BANK_TRANSFER','OTHER')),
  status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PENDING','PAID','FAILED','REFUNDED')),
  reference TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id),   -- one review per booking
  customer_id UUID NOT NULL REFERENCES users(id),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE','HIDDEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_provider_idx ON reviews (provider_id, created_at DESC);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  raised_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('WORK_INCOMPLETE','WRONG_PRICE','PAYMENT_ISSUE','SERVICE_QUALITY','CANCELLATION','OTHER')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  resolution TEXT,
  resolved_booking_status TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disputes_status_idx ON disputes (status, created_at DESC);
CREATE UNIQUE INDEX disputes_one_open_per_booking ON disputes (booking_id) WHERE status = 'OPEN';

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  reported_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  resolved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_user_id)
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);
