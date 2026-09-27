CREATE TABLE "inventory_commitments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_commitments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"commitment_type" text NOT NULL,
	"requisition_line_id" bigint,
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"warehouse_location_id" integer,
	"condition_code" text DEFAULT 'USABLE' NOT NULL,
	"batch_ref" text,
	"expiry_date" date,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"quantity_base_uom" numeric NOT NULL,
	"quantity_fulfilled" numeric DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_by_user_id" integer,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "inventory_commitments_requisition_line_id_unique" UNIQUE("requisition_line_id"),
	CONSTRAINT "inventory_commitments_type_valid" CHECK ("inventory_commitments"."commitment_type" IN ('REQUISITION')),
	CONSTRAINT "inventory_commitments_status_valid" CHECK ("inventory_commitments"."status" IN ('ACTIVE', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RELEASED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "inventory_commitments_requisition_link" CHECK ("inventory_commitments"."commitment_type" <> 'REQUISITION' OR "inventory_commitments"."requisition_line_id" IS NOT NULL),
	CONSTRAINT "inventory_commitments_quantity_positive" CHECK ("inventory_commitments"."quantity_base_uom" > 0),
	CONSTRAINT "inventory_commitments_quantity_finite" CHECK ("inventory_commitments"."quantity_base_uom" < 'Infinity'::numeric),
	CONSTRAINT "inventory_commitments_quantity_scale" CHECK (scale("inventory_commitments"."quantity_base_uom") <= 6),
	CONSTRAINT "inventory_commitments_quantity_range" CHECK ("inventory_commitments"."quantity_base_uom" < 100000000000000),
	CONSTRAINT "inventory_commitments_fulfilled_valid" CHECK ("inventory_commitments"."quantity_fulfilled" >= 0 AND "inventory_commitments"."quantity_fulfilled" <= "inventory_commitments"."quantity_base_uom" AND "inventory_commitments"."quantity_fulfilled" < 'Infinity'::numeric AND scale("inventory_commitments"."quantity_fulfilled") <= 6),
	CONSTRAINT "inventory_commitments_released_fields" CHECK ("inventory_commitments"."status" <> 'RELEASED' OR ("inventory_commitments"."released_by_user_id" IS NOT NULL AND "inventory_commitments"."released_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "requisition_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requisition_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"requisition_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"requested_quantity" numeric NOT NULL,
	"approved_quantity" numeric,
	"warehouse_location_id" integer,
	"funding_source_id" integer,
	"project_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requisition_lines_line_per_requisition" UNIQUE("requisition_id","line_no"),
	CONSTRAINT "requisition_lines_requested_quantity_positive" CHECK ("requisition_lines"."requested_quantity" > 0),
	CONSTRAINT "requisition_lines_requested_quantity_finite" CHECK ("requisition_lines"."requested_quantity" < 'Infinity'::numeric),
	CONSTRAINT "requisition_lines_requested_quantity_scale" CHECK (scale("requisition_lines"."requested_quantity") <= 6),
	CONSTRAINT "requisition_lines_requested_quantity_range" CHECK ("requisition_lines"."requested_quantity" < 100000000000000),
	CONSTRAINT "requisition_lines_approved_quantity_valid" CHECK ("requisition_lines"."approved_quantity" IS NULL OR ("requisition_lines"."approved_quantity" >= 0 AND "requisition_lines"."approved_quantity" <= "requisition_lines"."requested_quantity" AND "requisition_lines"."approved_quantity" < 'Infinity'::numeric AND scale("requisition_lines"."approved_quantity") <= 6))
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requisitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"warehouse_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"intended_recipient" text,
	"source_evidence_ref" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"submitted_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"decision_outcome" text,
	"approval_reference" text,
	"decision_notes" text,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "requisitions_purpose_not_blank" CHECK (length(btrim("requisitions"."purpose")) > 0),
	CONSTRAINT "requisitions_status_valid" CHECK ("requisitions"."status" IN ('DRAFT', 'SUBMITTED', 'DECIDED', 'CANCELLED')),
	CONSTRAINT "requisitions_decision_outcome_valid" CHECK ("requisitions"."decision_outcome" IS NULL OR "requisitions"."decision_outcome" IN ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED')),
	CONSTRAINT "requisitions_submitted_fields" CHECK ("requisitions"."status" NOT IN ('SUBMITTED', 'DECIDED') OR ("requisitions"."submitted_by_user_id" IS NOT NULL AND "requisitions"."submitted_at" IS NOT NULL AND length(btrim(coalesce("requisitions"."source_evidence_ref", ''))) > 0)),
	CONSTRAINT "requisitions_decided_fields" CHECK ("requisitions"."status" <> 'DECIDED' OR ("requisitions"."decided_by_user_id" IS NOT NULL AND "requisitions"."decided_at" IS NOT NULL AND "requisitions"."decision_outcome" IS NOT NULL AND length(btrim(coalesce("requisitions"."approval_reference", ''))) > 0)),
	CONSTRAINT "requisitions_cancelled_fields" CHECK ("requisitions"."status" <> 'CANCELLED' OR ("requisitions"."cancelled_by_user_id" IS NOT NULL AND "requisitions"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "requisitions_maker_checker" CHECK ("requisitions"."decided_by_user_id" IS NULL OR ("requisitions"."decided_by_user_id" <> "requisitions"."created_by_user_id" AND "requisitions"."decided_by_user_id" IS DISTINCT FROM "requisitions"."submitted_by_user_id"))
);
--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_requisition_line_id_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."requisition_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_condition_code_condition_codes_code_fk" FOREIGN KEY ("condition_code") REFERENCES "public"."condition_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_lines" ADD CONSTRAINT "requisition_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_commitments_warehouse_item_idx" ON "inventory_commitments" USING btree ("warehouse_id","item_id","status");--> statement-breakpoint
CREATE INDEX "requisition_lines_item_idx" ON "requisition_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "requisitions_warehouse_status_idx" ON "requisitions" USING btree ("warehouse_id","status");