-- Per-recipient child links reference their parent for content instead of
-- duplicating the ciphertext ref / wrapped key / metadata / policy. This gives
-- the share payload a single source of truth (a policy edit no longer means N
-- row updates). Content columns become nullable for children; a CHECK still
-- forces parents to carry the payload.

set search_path = wisp;

alter table shares alter column ciphertext_ref drop not null;
alter table shares alter column encrypted_metadata drop not null;
alter table shares alter column policy drop not null;
alter table shares alter column management_token_hash drop not null;

alter table shares drop constraint if exists shares_parent_or_content;
alter table shares add constraint shares_parent_or_content check (
  parent_share_id is not null
  or (
    ciphertext_ref is not null
    and encrypted_metadata is not null
    and policy is not null
    and management_token_hash is not null
  )
);

-- Reclaim the duplicated payload from existing children (content is now read
-- from the parent). link identity + parent_share_id are all a child needs.
update shares
   set ciphertext_ref = null,
       wrapped_cek = null,
       kdf_salt = null,
       kdf_params = null,
       encrypted_metadata = null,
       policy = null,
       management_token_hash = null,
       owner_user_id = null,
       expires_at = null
 where parent_share_id is not null;
