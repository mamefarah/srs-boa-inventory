-- M2 REDTEAM (M3 finding): Unicode-robust duplicate key for item names.
-- NFKC-normalise, lower-case, then remove invisible/format characters, all (Unicode)
-- spaces and punctuation, so spacing/punctuation/zero-width variants share one key. Requires a UTF8 database (normalize()).
CREATE OR REPLACE FUNCTION boa_item_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT regexp_replace(lower(normalize(p_name, NFKC)),
    '[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯︀-️﻿   -     　[:space:][:punct:]]',
    '', 'g');
$$;--> statement-breakpoint
DROP INDEX "items_normalized_name_unique";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "name_key" text GENERATED ALWAYS AS (boa_item_name_key(name)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "items_name_key_unique" ON "items" USING btree ("name_key");--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_quantity_finite" CHECK ("inventory_entries"."signed_quantity" <> 'NaN'::numeric);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_name_single_script" CHECK (NOT ("items"."name" ~ '[A-Za-z]' AND "items"."name" ~ '[Ͱ-ϿЀ-ԯ]'));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_name_key_not_blank" CHECK (length("items"."name_key") > 0);