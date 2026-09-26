CREATE TABLE "opening_balance_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opening_balance_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"warehouse_id" integer NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"description" text,
	"source_evidence_ref" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"submitted_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" integer,
	"approved_at" timestamp with time zone,
	"approval_reference" text,
	"posted_by_user_id" integer,
	"posted_at" timestamp with time zone,
	"transaction_id" uuid,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "opening_balance_batches_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "opening_balance_batches_status_valid" CHECK ("opening_balance_batches"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED')),
	CONSTRAINT "opening_balance_batches_submitted_fields" CHECK ("opening_balance_batches"."status" NOT IN ('SUBMITTED', 'APPROVED', 'POSTED') OR ("opening_balance_batches"."submitted_by_user_id" IS NOT NULL AND "opening_balance_batches"."submitted_at" IS NOT NULL)),
	CONSTRAINT "opening_balance_batches_approved_fields" CHECK ("opening_balance_batches"."status" NOT IN ('APPROVED', 'POSTED') OR ("opening_balance_batches"."approved_by_user_id" IS NOT NULL AND "opening_balance_batches"."approved_at" IS NOT NULL AND length(btrim(coalesce("opening_balance_batches"."approval_reference", ''))) > 0)),
	CONSTRAINT "opening_balance_batches_posted_fields" CHECK (("opening_balance_batches"."status" = 'POSTED') = ("opening_balance_batches"."transaction_id" IS NOT NULL AND "opening_balance_batches"."posted_by_user_id" IS NOT NULL AND "opening_balance_batches"."posted_at" IS NOT NULL)),
	CONSTRAINT "opening_balance_batches_cancelled_fields" CHECK ("opening_balance_batches"."status" <> 'CANCELLED' OR ("opening_balance_batches"."cancelled_by_user_id" IS NOT NULL AND "opening_balance_batches"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "opening_balance_batches_maker_checker" CHECK ("opening_balance_batches"."approved_by_user_id" IS NULL OR ("opening_balance_batches"."approved_by_user_id" <> "opening_balance_batches"."created_by_user_id" AND "opening_balance_batches"."approved_by_user_id" IS DISTINCT FROM "opening_balance_batches"."submitted_by_user_id"))
);
--> statement-breakpoint
CREATE TABLE "opening_balance_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opening_balance_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"warehouse_location_id" integer,
	"condition_code" text DEFAULT 'USABLE' NOT NULL,
	"batch_ref" text,
	"expiry_date" date,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"unit_cost_amount" numeric,
	"currency_code" text,
	"source_line_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balance_lines_line_per_batch" UNIQUE("batch_id","line_no"),
	CONSTRAINT "opening_balance_lines_quantity_positive" CHECK ("opening_balance_lines"."quantity" > 0),
	CONSTRAINT "opening_balance_lines_quantity_finite" CHECK ("opening_balance_lines"."quantity" <> 'NaN'::numeric),
	CONSTRAINT "opening_balance_lines_quantity_scale" CHECK (scale("opening_balance_lines"."quantity") <= 6),
	CONSTRAINT "opening_balance_lines_quantity_range" CHECK ("opening_balance_lines"."quantity" < 100000000000000),
	CONSTRAINT "opening_balance_lines_cost_currency_pair" CHECK (("opening_balance_lines"."unit_cost_amount" IS NULL) = ("opening_balance_lines"."currency_code" IS NULL)),
	CONSTRAINT "opening_balance_lines_cost_nonnegative" CHECK ("opening_balance_lines"."unit_cost_amount" IS NULL OR ("opening_balance_lines"."unit_cost_amount" >= 0 AND "opening_balance_lines"."unit_cost_amount" <> 'NaN'::numeric)),
	CONSTRAINT "opening_balance_lines_currency_format" CHECK ("opening_balance_lines"."currency_code" IS NULL OR "opening_balance_lines"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "opening_balance_lines_refs_not_blank" CHECK (("opening_balance_lines"."batch_ref" IS NULL OR length(btrim("opening_balance_lines"."batch_ref")) > 0) AND ("opening_balance_lines"."serial_ref" IS NULL OR length(btrim("opening_balance_lines"."serial_ref")) > 0))
);
--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_batches" ADD CONSTRAINT "opening_balance_batches_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_batch_id_opening_balance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."opening_balance_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_condition_code_condition_codes_code_fk" FOREIGN KEY ("condition_code") REFERENCES "public"."condition_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_balance_batches_warehouse_status_idx" ON "opening_balance_batches" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "opening_balance_lines_item_idx" ON "opening_balance_lines" USING btree ("item_id");