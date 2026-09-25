CREATE TABLE "audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" integer,
	"actor_firebase_uid" text,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"warehouse_id" integer,
	"reason" text,
	"request_id" text,
	"old_data" jsonb,
	"new_data" jsonb,
	CONSTRAINT "audit_events_result_valid" CHECK ("audit_events"."result" IN ('SUCCESS', 'FAILED', 'DENIED'))
);
--> statement-breakpoint
CREATE TABLE "condition_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_issuable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custodians" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custodians_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"custodian_type" text NOT NULL,
	"user_id" integer,
	"directorate_id" integer,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custodians_type_valid" CHECK ("custodians"."custodian_type" IN ('USER', 'DIRECTORATE', 'EXTERNAL_PARTY'))
);
--> statement-breakpoint
CREATE TABLE "directorates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "directorates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directorates_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "funding_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "funding_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "funding_sources_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "idempotency_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"idempotency_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"transaction_id" uuid,
	"response_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "idempotency_records_status_valid" CHECK ("idempotency_records"."status" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
	CONSTRAINT "idempotency_records_key_length" CHECK (length("idempotency_records"."idempotency_key") BETWEEN 8 AND 200),
	CONSTRAINT "idempotency_records_hash_format" CHECK ("idempotency_records"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"business_document_line_ref" text,
	"item_id" integer NOT NULL,
	"signed_quantity" numeric NOT NULL,
	"base_uom_id" integer NOT NULL,
	"custody_scope" text NOT NULL,
	"warehouse_id" integer,
	"warehouse_location_id" integer,
	"custodian_id" integer,
	"condition_code" text NOT NULL,
	"batch_ref" text,
	"serial_ref" text,
	"funding_source_id" integer,
	"project_id" integer,
	"unit_cost_amount" numeric,
	"currency_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_entries_line_per_transaction" UNIQUE("transaction_id","line_no"),
	CONSTRAINT "inventory_entries_quantity_nonzero" CHECK ("inventory_entries"."signed_quantity" <> 0),
	CONSTRAINT "inventory_entries_custody_scope_valid" CHECK ("inventory_entries"."custody_scope" IN ('WAREHOUSE', 'IN_TRANSIT', 'INTERNAL_CUSTODY', 'EXTERNAL', 'TERMINAL_EXIT', 'OPENING_BALANCE_CONTRA')),
	CONSTRAINT "inventory_entries_warehouse_required_for_warehouse_custody" CHECK ("inventory_entries"."custody_scope" <> 'WAREHOUSE' OR "inventory_entries"."warehouse_id" IS NOT NULL),
	CONSTRAINT "inventory_entries_location_requires_warehouse" CHECK ("inventory_entries"."warehouse_location_id" IS NULL OR "inventory_entries"."warehouse_id" IS NOT NULL),
	CONSTRAINT "inventory_entries_cost_currency_pair" CHECK (("inventory_entries"."unit_cost_amount" IS NULL) = ("inventory_entries"."currency_code" IS NULL)),
	CONSTRAINT "inventory_entries_cost_nonnegative" CHECK ("inventory_entries"."unit_cost_amount" IS NULL OR "inventory_entries"."unit_cost_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_type" text NOT NULL,
	"business_document_type" text,
	"business_document_id" text,
	"effective_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by_user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"approval_reference" text,
	"reason" text,
	"reversal_of_transaction_id" uuid,
	"correction_of_transaction_id" uuid,
	"reporting_period_ref" text,
	"policy_context" jsonb,
	"source_system_ref" text,
	CONSTRAINT "inventory_transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "inventory_transactions_not_self_reversal" CHECK ("inventory_transactions"."reversal_of_transaction_id" IS DISTINCT FROM "inventory_transactions"."id"),
	CONSTRAINT "inventory_transactions_type_not_blank" CHECK (length(btrim("inventory_transactions"."transaction_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"item_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" integer NOT NULL,
	"base_uom_id" integer NOT NULL,
	"asset_control_type" text DEFAULT 'UNCLASSIFIED' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_item_code_unique" UNIQUE("item_code"),
	CONSTRAINT "items_id_base_uom" UNIQUE("id","base_uom_id"),
	CONSTRAINT "items_asset_control_type_valid" CHECK ("items"."asset_control_type" IN ('SUPPLY', 'FIXED_ASSET_CANDIDATE', 'SPECIAL_CONTROLLED_ITEM', 'UNCLASSIFIED'))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "policy_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"policy_key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"evidence_status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"value" jsonb,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"source_evidence_ref" text,
	"blocker_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_key_version" UNIQUE("policy_key","version"),
	CONSTRAINT "policy_versions_status_valid" CHECK ("policy_versions"."status" IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'DISABLED')),
	CONSTRAINT "policy_versions_evidence_status_valid" CHECK ("policy_versions"."evidence_status" IN ('VERIFIED', 'UNVERIFIED')),
	CONSTRAINT "policy_versions_active_requires_verified_evidence" CHECK ("policy_versions"."status" <> 'ACTIVE' OR ("policy_versions"."evidence_status" = 'VERIFIED' AND "policy_versions"."source_evidence_ref" IS NOT NULL AND "policy_versions"."value" IS NOT NULL AND "policy_versions"."effective_from" IS NOT NULL)),
	CONSTRAINT "policy_versions_effective_range_valid" CHECK ("policy_versions"."effective_to" IS NULL OR "policy_versions"."effective_from" IS NULL OR "policy_versions"."effective_to" > "policy_versions"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"funding_source_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "uoms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uoms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uoms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"granted_by_user_id" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id"),
	CONSTRAINT "user_roles_no_self_grant" CHECK ("user_roles"."granted_by_user_id" IS DISTINCT FROM "user_roles"."user_id")
);
--> statement-breakpoint
CREATE TABLE "user_warehouse_access" (
	"user_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"granted_by_user_id" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_warehouse_access_user_id_warehouse_id_pk" PRIMARY KEY("user_id","warehouse_id"),
	CONSTRAINT "user_warehouse_access_no_self_grant" CHECK ("user_warehouse_access"."granted_by_user_id" IS DISTINCT FROM "user_warehouse_access"."user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_firebase_uid_not_blank" CHECK (length(btrim("users"."firebase_uid")) > 0),
	CONSTRAINT "users_email_not_blank" CHECK (length(btrim("users"."email")) > 0)
);
--> statement-breakpoint
CREATE TABLE "warehouse_locations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "warehouse_locations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"warehouse_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_locations_code_per_warehouse" UNIQUE("warehouse_id","code"),
	CONSTRAINT "warehouse_locations_id_warehouse" UNIQUE("id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "warehouses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"physical_location" text,
	"operating_directorate_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodians" ADD CONSTRAINT "custodians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custodians" ADD CONSTRAINT "custodians_directorate_id_directorates_id_fk" FOREIGN KEY ("directorate_id") REFERENCES "public"."directorates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_custodian_id_custodians_id_fk" FOREIGN KEY ("custodian_id") REFERENCES "public"."custodians"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_condition_code_condition_codes_code_fk" FOREIGN KEY ("condition_code") REFERENCES "public"."condition_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_item_base_uom_fk" FOREIGN KEY ("item_id","base_uom_id") REFERENCES "public"."items"("id","base_uom_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_location_in_warehouse_fk" FOREIGN KEY ("warehouse_location_id","warehouse_id") REFERENCES "public"."warehouse_locations"("id","warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversal_of_fk" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_correction_of_fk" FOREIGN KEY ("correction_of_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_uom_id_uoms_id_fk" FOREIGN KEY ("base_uom_id") REFERENCES "public"."uoms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_operating_directorate_id_directorates_id_fk" FOREIGN KEY ("operating_directorate_id") REFERENCES "public"."directorates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_warehouse_idx" ON "audit_events" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "inventory_entries_item_warehouse_idx" ON "inventory_entries" USING btree ("item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "inventory_entries_warehouse_idx" ON "inventory_entries" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "inventory_entries_transaction_idx" ON "inventory_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transactions_single_reversal" ON "inventory_transactions" USING btree ("reversal_of_transaction_id") WHERE "inventory_transactions"."reversal_of_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "inventory_transactions_effective_at_idx" ON "inventory_transactions" USING btree ("effective_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_document_idx" ON "inventory_transactions" USING btree ("business_document_type","business_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_one_active_per_key" ON "policy_versions" USING btree ("policy_key") WHERE "policy_versions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));