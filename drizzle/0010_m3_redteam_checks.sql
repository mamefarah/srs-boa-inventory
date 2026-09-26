CREATE TABLE "opening_balance_contributors" (
	"batch_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"first_action" text NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balance_contributors_pk" PRIMARY KEY("batch_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_entries" DROP CONSTRAINT "inventory_entries_cost_nonnegative";--> statement-breakpoint
ALTER TABLE "opening_balance_lines" DROP CONSTRAINT "opening_balance_lines_cost_nonnegative";--> statement-breakpoint
ALTER TABLE "opening_balance_contributors" ADD CONSTRAINT "opening_balance_contributors_batch_id_opening_balance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."opening_balance_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balance_contributors" ADD CONSTRAINT "opening_balance_contributors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_entries" ADD CONSTRAINT "inventory_entries_cost_nonnegative" CHECK ("inventory_entries"."unit_cost_amount" IS NULL OR ("inventory_entries"."unit_cost_amount" >= 0 AND "inventory_entries"."unit_cost_amount" < 'Infinity'::numeric));--> statement-breakpoint
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_cost_nonnegative" CHECK ("opening_balance_lines"."unit_cost_amount" IS NULL OR ("opening_balance_lines"."unit_cost_amount" >= 0 AND "opening_balance_lines"."unit_cost_amount" < 'Infinity'::numeric));