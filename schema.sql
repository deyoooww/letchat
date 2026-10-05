CREATE TABLE users(
 id SERIAL PRIMARY KEY, username TEXT NOT NULL, normalized_username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar_type TEXT NOT NULL DEFAULT 'cartoon',
 avatar_url TEXT, character_config JSONB NOT NULL DEFAULT '{}', password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN('owner','admin','user')),
 is_verified BOOL NOT NULL DEFAULT false, verified_at TIMESTAMPTZ, verified_by INT,
 premium_granted BOOL NOT NULL DEFAULT false,
 owner_badge_visible BOOL NOT NULL DEFAULT true, verified_badge_visible BOOL NOT NULL DEFAULT true, premium_badge_visible BOOL NOT NULL DEFAULT true,
 storage_quota BIGINT NOT NULL DEFAULT 10737418240, storage_used BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- Permanent reservation: user_id is SET NULL on delete, the row (and the name) never goes away.
CREATE TABLE username_history(
 id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE SET NULL,
 username TEXT NOT NULL, normalized_username TEXT NOT NULL UNIQUE,
 claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(), released_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','reserved','blocked')));
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ip TEXT, user_agent TEXT, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE messages(id BIGSERIAL PRIMARY KEY, sender_id INT NOT NULL REFERENCES users(id), recipient_id INT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ);
CREATE INDEX ON messages(sender_id,recipient_id,id);
-- No per-user status quota: only storage (bytes) is limited.
CREATE TABLE statuses(id BIGSERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT 'text', body TEXT, privacy TEXT NOT NULL DEFAULT 'everyone', bytes INT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '24 hours');
CREATE TABLE owner_audit_logs(id BIGSERIAL PRIMARY KEY, owner_id INT, action TEXT NOT NULL, target_type TEXT, target_id INT,
 metadata JSONB, ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
