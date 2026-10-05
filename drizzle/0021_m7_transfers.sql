CREATE TABLE "transfer_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transfer_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"source_location_id" integer,
	"batch_ref" text,
	"expiry_date" date,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_lines_line_per_transfer" UNIQUE("transfer_id","line_no"),
	CONSTRAINT "transfer_lines_quantity_positive" CHECK ("transfer_lines"."quantity" > 0),
	CONSTRAINT "transfer_lines_quantity_finite" CHECK ("transfer_lines"."quantity" < 'Infinity'::numeric),
	CONSTRAINT "transfer_lines_quantity_scale" CHECK (scale("transfer_lines"."quantity") <= 6),
	CONSTRAINT "transfer_lines_quantity_range" CHECK ("transfer_lines"."quantity" < 100000000000000)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_warehouse_id" integer NOT NULL,
	"destination_warehouse_id" integer NOT NULL,
	"client_ref" text,
	"create_hash" text,
	"purpose" text NOT NULL,
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
	"approval_notes" text,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "transfers_client_ref_unique" UNIQUE("created_by_user_id","client_ref"),
	CONSTRAINT "transfers_status_valid" CHECK ("transfers"."status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'IN_TRANSIT', 'DISCREPANCY', 'RECEIVED', 'CANCELLED')),
	CONSTRAINT "transfers_distinct_warehouses" CHECK ("transfers"."source_warehouse_id" <> "transfers"."destination_warehouse_id"),
	CONSTRAINT "transfers_purpose_not_blank" CHECK (length(btrim("transfers"."purpose")) > 0),
	CONSTRAINT "transfers_submitted_fields" CHECK ("transfers"."status" NOT IN ('SUBMITTED', 'APPROVED', 'IN_TRANSIT', 'DISCREPANCY', 'RECEIVED') OR ("transfers"."submitted_by_user_id" IS NOT NULL AND "transfers"."submitted_at" IS NOT NULL)),
	CONSTRAINT "transfers_approved_fields" CHECK ("transfers"."status" NOT IN ('APPROVED', 'IN_TRANSIT', 'DISCREPANCY', 'RECEIVED') OR ("transfers"."approved_by_user_id" IS NOT NULL AND "transfers"."approved_at" IS NOT NULL AND length(btrim(coalesce("transfers"."approval_reference", ''))) > 0)),
	CONSTRAINT "transfers_cancelled_fields" CHECK ("transfers"."status" <> 'CANCELLED' OR ("transfers"."cancelled_by_user_id" IS NOT NULL AND "transfers"."cancelled_at" IS NOT NULL AND length(btrim(coalesce("transfers"."cancel_reason", ''))) > 0)),
	CONSTRAINT "transfers_client_ref_pair" CHECK (("transfers"."client_ref" IS NULL) = ("transfers"."create_hash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inventory_commitments" DROP CONSTRAINT "inventory_commitments_requisition_link";--> statement-breakpoint
ALTER TABLE "inventory_commitments" DROP CONSTRAINT "inventory_commitments_type_valid";--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD COLUMN "transfer_line_id" bigint;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_source_location_id_warehouse_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_warehouse_id_warehouses_id_fk" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_lines_item_idx" ON "transfer_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "transfers_source_status_idx" ON "transfers" USING btree ("source_warehouse_id","status");--> statement-breakpoint
CREATE INDEX "transfers_destination_status_idx" ON "transfers" USING btree ("destination_warehouse_id","status");--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_transfer_line_id_transfer_lines_id_fk" FOREIGN KEY ("transfer_line_id") REFERENCES "public"."transfer_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_transfer_line_id_unique" UNIQUE("transfer_line_id");--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_source_link" CHECK (("inventory_commitments"."commitment_type" = 'REQUISITION' AND "inventory_commitments"."requisition_line_id" IS NOT NULL AND "inventory_commitments"."transfer_line_id" IS NULL) OR ("inventory_commitments"."commitment_type" = 'TRANSFER' AND "inventory_commitments"."transfer_line_id" IS NOT NULL AND "inventory_commitments"."requisition_line_id" IS NULL));--> statement-breakpoint
ALTER TABLE "inventory_commitments" ADD CONSTRAINT "inventory_commitments_type_valid" CHECK ("inventory_commitments"."commitment_type" IN ('REQUISITION', 'TRANSFER'));