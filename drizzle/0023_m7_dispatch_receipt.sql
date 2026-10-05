CREATE TABLE "transfer_receipt_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_receipt_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" integer NOT NULL,
	"transfer_line_id" bigint NOT NULL,
	"condition_code" text NOT NULL,
	"quantity" numeric NOT NULL,
	"destination_location_id" integer,
	"notes" text,
	CONSTRAINT "transfer_receipt_lines_quantity_positive" CHECK ("transfer_receipt_lines"."quantity" > 0),
	CONSTRAINT "transfer_receipt_lines_quantity_finite" CHECK ("transfer_receipt_lines"."quantity" < 'Infinity'::numeric),
	CONSTRAINT "transfer_receipt_lines_quantity_scale" CHECK (scale("transfer_receipt_lines"."quantity") <= 6),
	CONSTRAINT "transfer_receipt_lines_quantity_range" CHECK ("transfer_receipt_lines"."quantity" < 100000000000000)
);
--> statement-breakpoint
CREATE TABLE "transfer_receipts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfer_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transfer_id" integer NOT NULL,
	"receipt_no" integer NOT NULL,
	"received_by_user_id" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"transaction_id" uuid NOT NULL,
	"receiver_name" text NOT NULL,
	"receiving_document_ref" text NOT NULL,
	"remarks" text,
	CONSTRAINT "transfer_receipts_no_per_transfer" UNIQUE("transfer_id","receipt_no"),
	CONSTRAINT "transfer_receipts_transaction_unique" UNIQUE("transaction_id"),
	CONSTRAINT "transfer_receipts_receiver_not_blank" CHECK (length(btrim("transfer_receipts"."receiver_name")) > 0),
	CONSTRAINT "transfer_receipts_ref_not_blank" CHECK (length(btrim("transfer_receipts"."receiving_document_ref")) > 0)
);
--> statement-breakpoint
ALTER TABLE "document_references" DROP CONSTRAINT "document_references_entity_type_valid";--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "dispatched_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "dispatch_effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "dispatch_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "transporter_name" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "vehicle_ref" text;--> statement-breakpoint
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_receipt_id_transfer_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."transfer_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_transfer_line_id_transfer_lines_id_fk" FOREIGN KEY ("transfer_line_id") REFERENCES "public"."transfer_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_condition_code_condition_codes_code_fk" FOREIGN KEY ("condition_code") REFERENCES "public"."condition_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipt_lines" ADD CONSTRAINT "transfer_receipt_lines_destination_location_id_warehouse_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_receipt_lines_line_idx" ON "transfer_receipt_lines" USING btree ("transfer_line_id");--> statement-breakpoint
CREATE INDEX "transfer_receipt_lines_receipt_idx" ON "transfer_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatch_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("dispatch_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatch_transaction_unique" UNIQUE("dispatch_transaction_id");--> statement-breakpoint
ALTER TABLE "document_references" ADD CONSTRAINT "document_references_entity_type_valid" CHECK ("document_references"."entity_type" IN ('RECEIPT', 'SUPPLIER_RETURN', 'ISSUE', 'TRANSFER'));--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_dispatched_fields" CHECK ("transfers"."status" NOT IN ('IN_TRANSIT', 'DISCREPANCY', 'RECEIVED') OR ("transfers"."dispatched_by_user_id" IS NOT NULL AND "transfers"."dispatched_at" IS NOT NULL AND "transfers"."dispatch_effective_at" IS NOT NULL AND "transfers"."dispatch_transaction_id" IS NOT NULL));