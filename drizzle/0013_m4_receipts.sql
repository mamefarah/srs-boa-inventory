CREATE TABLE "document_references" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_references_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"document_date" date NOT NULL,
	"source_unit" text,
	"prepared_by_name" text,
	"prepared_by_title" text,
	"checked_by_name" text,
	"checked_by_title" text,
	"approved_by_name" text,
	"approved_by_title" text,
	"recipient_name" text,
	"recipient_title" text,
	"approval_date" date,
	"physical_file_ref" text,
	"remarks" text,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_references_entity_type_number_unique" UNIQUE("entity_type","entity_id","document_type","document_number"),
	CONSTRAINT "document_references_entity_type_valid" CHECK ("document_references"."entity_type" IN ('RECEIPT', 'SUPPLIER_RETURN')),
	CONSTRAINT "document_references_entity_id_not_blank" CHECK (length(btrim("document_references"."entity_id")) > 0),
	CONSTRAINT "document_references_document_type_not_blank" CHECK (length(btrim("document_references"."document_type")) > 0),
	CONSTRAINT "document_references_document_number_not_blank" CHECK (length(btrim("document_references"."document_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_headers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_headers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"warehouse_id" integer NOT NULL,
	"source_party_name" text NOT NULL,
	"source_reference" text,
	"description" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"submitted_by_user_id" integer,
	"submitted_at" timestamp with time zone,
	"arrival_effective_at" timestamp with time zone,
	"arrived_by_user_id" integer,
	"arrived_at" timestamp with time zone,
	"arrival_transaction_id" uuid,
	"inspection_effective_at" timestamp with time zone,
	"inspected_by_user_id" integer,
	"inspected_at" timestamp with time zone,
	"inspection_transaction_id" uuid,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "receipt_headers_arrival_transaction_id_unique" UNIQUE("arrival_transaction_id"),
	CONSTRAINT "receipt_headers_inspection_transaction_id_unique" UNIQUE("inspection_transaction_id"),
	CONSTRAINT "receipt_headers_source_party_not_blank" CHECK (length(btrim("receipt_headers"."source_party_name")) > 0),
	CONSTRAINT "receipt_headers_status_valid" CHECK ("receipt_headers"."status" IN ('DRAFT', 'SUBMITTED', 'ARRIVED', 'INSPECTED', 'CANCELLED')),
	CONSTRAINT "receipt_headers_submitted_fields" CHECK ("receipt_headers"."status" NOT IN ('SUBMITTED', 'ARRIVED', 'INSPECTED') OR ("receipt_headers"."submitted_by_user_id" IS NOT NULL AND "receipt_headers"."submitted_at" IS NOT NULL)),
	CONSTRAINT "receipt_headers_arrival_fields" CHECK ("receipt_headers"."status" NOT IN ('ARRIVED', 'INSPECTED') OR ("receipt_headers"."arrival_effective_at" IS NOT NULL AND "receipt_headers"."arrived_by_user_id" IS NOT NULL AND "receipt_headers"."arrived_at" IS NOT NULL AND "receipt_headers"."arrival_transaction_id" IS NOT NULL)),
	CONSTRAINT "receipt_headers_inspection_fields" CHECK (("receipt_headers"."status" = 'INSPECTED') = ("receipt_headers"."inspection_effective_at" IS NOT NULL AND "receipt_headers"."inspected_by_user_id" IS NOT NULL AND "receipt_headers"."inspected_at" IS NOT NULL AND "receipt_headers"."inspection_transaction_id" IS NOT NULL)),
	CONSTRAINT "receipt_headers_cancelled_fields" CHECK ("receipt_headers"."status" <> 'CANCELLED' OR ("receipt_headers"."cancelled_by_user_id" IS NOT NULL AND "receipt_headers"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"expected_quantity" numeric,
	"warehouse_location_id" integer,
	"batch_ref" text,
	"expiry_date" date,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"unit_cost_amount" numeric,
	"currency_code" text,
	"source_line_ref" text,
	"notes" text,
	"accepted_quantity" numeric DEFAULT '0' NOT NULL,
	"rejected_quantity" numeric DEFAULT '0' NOT NULL,
	"damaged_quantity" numeric DEFAULT '0' NOT NULL,
	"quarantine_quantity" numeric DEFAULT '0' NOT NULL,
	"inspection_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_lines_line_per_receipt" UNIQUE("receipt_id","line_no"),
	CONSTRAINT "receipt_lines_quantity_positive" CHECK ("receipt_lines"."quantity" > 0),
	CONSTRAINT "receipt_lines_quantity_finite" CHECK ("receipt_lines"."quantity" < 'Infinity'::numeric),
	CONSTRAINT "receipt_lines_quantity_scale" CHECK (scale("receipt_lines"."quantity") <= 6),
	CONSTRAINT "receipt_lines_quantity_range" CHECK ("receipt_lines"."quantity" < 100000000000000),
	CONSTRAINT "receipt_lines_expected_quantity_positive" CHECK ("receipt_lines"."expected_quantity" IS NULL OR "receipt_lines"."expected_quantity" > 0),
	CONSTRAINT "receipt_lines_expected_quantity_finite" CHECK ("receipt_lines"."expected_quantity" IS NULL OR "receipt_lines"."expected_quantity" < 'Infinity'::numeric),
	CONSTRAINT "receipt_lines_expected_quantity_scale" CHECK ("receipt_lines"."expected_quantity" IS NULL OR scale("receipt_lines"."expected_quantity") <= 6),
	CONSTRAINT "receipt_lines_expected_quantity_range" CHECK ("receipt_lines"."expected_quantity" IS NULL OR "receipt_lines"."expected_quantity" < 100000000000000),
	CONSTRAINT "receipt_lines_cost_currency_pair" CHECK (("receipt_lines"."unit_cost_amount" IS NULL) = ("receipt_lines"."currency_code" IS NULL)),
	CONSTRAINT "receipt_lines_cost_nonnegative" CHECK ("receipt_lines"."unit_cost_amount" IS NULL OR ("receipt_lines"."unit_cost_amount" >= 0 AND "receipt_lines"."unit_cost_amount" < 'Infinity'::numeric)),
	CONSTRAINT "receipt_lines_currency_format" CHECK ("receipt_lines"."currency_code" IS NULL OR "receipt_lines"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "receipt_lines_refs_not_blank" CHECK (("receipt_lines"."batch_ref" IS NULL OR length(btrim("receipt_lines"."batch_ref")) > 0) AND ("receipt_lines"."serial_ref" IS NULL OR length(btrim("receipt_lines"."serial_ref")) > 0)),
	CONSTRAINT "receipt_lines_outcomes_nonnegative" CHECK ("receipt_lines"."accepted_quantity" >= 0 AND "receipt_lines"."rejected_quantity" >= 0 AND "receipt_lines"."damaged_quantity" >= 0 AND "receipt_lines"."quarantine_quantity" >= 0),
	CONSTRAINT "receipt_lines_outcomes_finite" CHECK ("receipt_lines"."accepted_quantity" < 'Infinity'::numeric AND "receipt_lines"."rejected_quantity" < 'Infinity'::numeric AND "receipt_lines"."damaged_quantity" < 'Infinity'::numeric AND "receipt_lines"."quarantine_quantity" < 'Infinity'::numeric),
	CONSTRAINT "receipt_lines_outcomes_scale" CHECK (scale("receipt_lines"."accepted_quantity") <= 6 AND scale("receipt_lines"."rejected_quantity") <= 6 AND scale("receipt_lines"."damaged_quantity") <= 6 AND scale("receipt_lines"."quarantine_quantity") <= 6)
);
--> statement-breakpoint
CREATE TABLE "supplier_return_headers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_return_headers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"receipt_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"return_effective_at" timestamp with time zone,
	"posted_by_user_id" integer,
	"posted_at" timestamp with time zone,
	"transaction_id" uuid,
	"cancelled_by_user_id" integer,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "supplier_return_headers_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "supplier_return_headers_status_valid" CHECK ("supplier_return_headers"."status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
	CONSTRAINT "supplier_return_headers_posted_fields" CHECK (("supplier_return_headers"."status" = 'POSTED') = ("supplier_return_headers"."return_effective_at" IS NOT NULL AND "supplier_return_headers"."posted_by_user_id" IS NOT NULL AND "supplier_return_headers"."posted_at" IS NOT NULL AND "supplier_return_headers"."transaction_id" IS NOT NULL)),
	CONSTRAINT "supplier_return_headers_cancelled_fields" CHECK ("supplier_return_headers"."status" <> 'CANCELLED' OR ("supplier_return_headers"."cancelled_by_user_id" IS NOT NULL AND "supplier_return_headers"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplier_return_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_return_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_return_id" integer NOT NULL,
	"receipt_line_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_return_lines_line_per_return" UNIQUE("supplier_return_id","line_no"),
	CONSTRAINT "supplier_return_lines_receipt_line_unique" UNIQUE("supplier_return_id","receipt_line_id"),
	CONSTRAINT "supplier_return_lines_quantity_positive" CHECK ("supplier_return_lines"."quantity" > 0),
	CONSTRAINT "supplier_return_lines_quantity_finite" CHECK ("supplier_return_lines"."quantity" < 'Infinity'::numeric),
	CONSTRAINT "supplier_return_lines_quantity_scale" CHECK (scale("supplier_return_lines"."quantity") <= 6),
	CONSTRAINT "supplier_return_lines_quantity_range" CHECK ("supplier_return_lines"."quantity" < 100000000000000)
);
--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_arrived_by_user_id_users_id_fk" FOREIGN KEY ("arrived_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_arrival_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("arrival_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_inspected_by_user_id_users_id_fk" FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_inspection_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("inspection_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_headers" ADD CONSTRAINT "receipt_headers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipt_headers_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_warehouse_location_id_warehouse_locations_id_fk" FOREIGN KEY ("warehouse_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_receipt_id_receipt_headers_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_headers" ADD CONSTRAINT "supplier_return_headers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_supplier_return_id_supplier_return_headers_id_fk" FOREIGN KEY ("supplier_return_id") REFERENCES "public"."supplier_return_headers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_receipt_line_id_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."receipt_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_references_entity_idx" ON "document_references" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "receipt_headers_warehouse_status_idx" ON "receipt_headers" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "receipt_lines_item_idx" ON "receipt_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "receipt_lines_receipt_idx" ON "receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "supplier_return_headers_warehouse_status_idx" ON "supplier_return_headers" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "supplier_return_headers_receipt_idx" ON "supplier_return_headers" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "supplier_return_lines_return_idx" ON "supplier_return_lines" USING btree ("supplier_return_id");