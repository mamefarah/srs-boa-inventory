CREATE TABLE "issue_headers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "issue_headers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"warehouse_id" integer NOT NULL,
	"requisition_id" integer NOT NULL,
	"client_ref" text,
	"create_hash" text,
	"destination_scope" text NOT NULL,
	"custodian_id" integer,
	"recipient_name" text NOT NULL,
	"recipient_unit" text,
	"handover_location" text,
	"reason" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"posted_by_user_id" integer,
	"posted_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"transaction_id" uuid,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "issue_headers_transaction_unique" UNIQUE("transaction_id"),
	CONSTRAINT "issue_headers_client_ref_unique" UNIQUE("created_by_user_id","client_ref"),
	CONSTRAINT "issue_headers_status_valid" CHECK ("issue_headers"."status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
	CONSTRAINT "issue_headers_destination_valid" CHECK ("issue_headers"."destination_scope" IN ('EXTERNAL', 'INTERNAL_CUSTODY')),
	CONSTRAINT "issue_headers_recipient_not_blank" CHECK (length(btrim("issue_headers"."recipient_name")) > 0),
	CONSTRAINT "issue_headers_custody_requires_custodian" CHECK ("issue_headers"."destination_scope" <> 'INTERNAL_CUSTODY' OR "issue_headers"."custodian_id" IS NOT NULL),
	CONSTRAINT "issue_headers_posted_fields" CHECK ("issue_headers"."status" <> 'POSTED' OR ("issue_headers"."posted_by_user_id" IS NOT NULL AND "issue_headers"."posted_at" IS NOT NULL AND "issue_headers"."effective_at" IS NOT NULL AND "issue_headers"."transaction_id" IS NOT NULL)),
	CONSTRAINT "issue_headers_cancelled_fields" CHECK ("issue_headers"."status" <> 'CANCELLED' OR ("issue_headers"."cancelled_by_user_id" IS NOT NULL AND "issue_headers"."cancelled_at" IS NOT NULL AND length(btrim(coalesce("issue_headers"."cancel_reason", ''))) > 0)),
	CONSTRAINT "issue_headers_client_ref_pair" CHECK (("issue_headers"."client_ref" IS NULL) = ("issue_headers"."create_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "issue_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "issue_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"issue_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"requisition_line_id" bigint NOT NULL,
	"item_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"warehouse_location_id" integer,
	"batch_ref" text,
	"expiry_date" date,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_lines_line_per_issue" UNIQUE("issue_id","line_no"),
	CONSTRAINT "issue_lines_quantity_positive" CHECK ("issue_lines"."quantity" > 0),
	CONSTRAINT "issue_lines_quantity_finite" CHECK ("issue_lines"."quantity" < 'Infinity'::numeric),
	CONSTRAINT "issue_lines_quantity_scale" CHECK (scale("issue_lines"."quantity") <= 6),
	CONSTRAINT "issue_lines_quantity_range" CHECK ("issue_lines"."quantity" < 100000000000000)
);
--> statement-breakpoint
ALTER TABLE "document_references" DROP CONSTRAINT "document_references_entity_type_valid";--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_custodian_id_custodians_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."custodians"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_headers" ADD CONSTRAINT "issue_headers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_issue_id_issue_headers_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_requisition_line_id_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."requisition_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_lines" ADD CONSTRAINT "issue_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_headers_warehouse_status_idx" ON "issue_headers" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "issue_headers_requisition_idx" ON "issue_headers" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "issue_lines_requisition_line_idx" ON "issue_lines" USING btree ("requisition_line_id");--> statement-breakpoint
CREATE INDEX "issue_lines_item_idx" ON "issue_lines" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_entity_type_valid" CHECK ("document_references"."entity_type" IN ('RECEIPT', 'SUPPLIER_RETURN', 'ISSUE'));