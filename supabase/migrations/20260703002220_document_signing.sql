-- Document signing: zero-knowledge e-signatures.
--
-- The envelope (doc hash, ephemeral ECDSA public key, signature, typed name)
-- is encrypted client-side under an HKDF subkey of the share's CEK — the
-- server attests WHO signed (OTP-verified recipient) and WHEN, but can never
-- read WHAT was signed, not even the document's hash.

set search_path = wisp;

create table if not exists signatures (
  id                 uuid primary key default gen_random_uuid(),
  share_id           text not null references shares(id) on delete cascade, -- parent share
  recipient_id       uuid not null references recipients(id) on delete cascade,
  encrypted_envelope bytea not null,     -- sealed client-side; opaque to the server
  ip_hash            text,
  created_at         timestamptz not null default now(),
  unique (recipient_id)                  -- one signature per recipient link
);

alter table signatures enable row level security;

create index if not exists signatures_share_id_idx on signatures (share_id);

-- Single-use signing ticket, minted by /access after the OTP gate passes and
-- presented to /sign. Stored hashed; cleared on use.
alter table recipients add column if not exists sign_ticket_hash text;
alter table recipients add column if not exists sign_ticket_expires_at timestamptz;
