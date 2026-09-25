CREATE TABLE "item_uom_conversions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_uom_conversions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"item_id" integer NOT NULL,
	"uom_id" integer NOT NULL,
	"factor_to_base" numeric(30, 12) NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"evidence_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"approval_ref" text,
	"source_evidence_ref" text,
	"effective_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_uom_conversions_factor_positive" CHECK ("item_uom_conversions"."factor_to_base" > 0),
	CONSTRAINT "item_uom_conversions_status_valid" CHECK ("item_uom_conversions"."status" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
	CONSTRAINT "item_uom_conversions_evidence_valid" CHECK ("item_uom_conversions"."evidence_status" IN ('VERIFIED', 'UNVERIFIED')),
	CONSTRAINT "item_uom_conversions_active_requires_approval" CHECK ("item_uom_conversions"."status" <> 'ACTIVE' OR ("item_uom_conversions"."evidence_status" = 'VERIFIED' AND length(btrim(coalesce("item_uom_conversions"."approval_ref", ''))) > 0 AND length(btrim(coalesce("item_uom_conversions"."source_evidence_ref", ''))) > 0 AND "item_uom_conversions"."effective_from" IS NOT NULL))
);
--> statement-breakpoint
-- ADR-0005: never round silently. Abort if any existing quantity would be rounded by the new scale.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory_entries" WHERE "signed_quantity" <> round("signed_quantity", 6) OR abs("signed_quantity") >= 1e14) THEN
    RAISE EXCEPTION 'BOA_QUANTITY_PRECISION: existing ledger quantities exceed NUMERIC(20,6); resolve before migrating';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "inventory_entries" ALTER COLUMN "signed_quantity" SET DATA TYPE numeric(20, 6);--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "specification" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_batch_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_expiry_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_serial_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_hazardous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "default_shelf_life_days" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "useful_life_months" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "created_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "updated_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "uoms" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "uoms" ADD COLUMN "decimal_places" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "uoms" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "uoms" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "uoms" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_uom_conversions" ADD CONSTRAINT "item_uom_conversions_uom_id_uoms_id_fk" FOREIGN KEY ("uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_uom_conversions_one_active" ON "item_uom_conversions" USING btree ("item_id","uom_id") WHERE "item_uom_conversions"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."item_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_normalized_name_unique" ON "items" USING btree (lower(regexp_replace(btrim("name"), '[[:space:]]+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "items_category_idx" ON "items" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_name_not_blank" CHECK (length(btrim("item_categories"."name")) > 0);--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_not_own_parent" CHECK ("item_categories"."parent_id" IS DISTINCT FROM "item_categories"."id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_item_code_format" CHECK ("items"."item_code" ~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$');--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_name_not_blank" CHECK (length(btrim("items"."name")) > 0);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_expiry_requires_batch" CHECK (NOT "items"."is_expiry_tracked" OR "items"."is_batch_tracked");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_positive" CHECK ("items"."default_shelf_life_days" IS NULL OR "items"."default_shelf_life_days" > 0);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shelf_life_requires_expiry" CHECK ("items"."default_shelf_life_days" IS NULL OR "items"."is_expiry_tracked");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_useful_life_positive" CHECK ("items"."useful_life_months" IS NULL OR "items"."useful_life_months" > 0);--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_name_not_blank" CHECK (length(btrim("uoms"."name")) > 0);--> statement-breakpoint
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_decimal_places_range" CHECK ("uoms"."decimal_places" BETWEEN 0 AND 6);