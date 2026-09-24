/**
 * Hand-maintained subset of the generated Supabase Database type, covering only what
 * M1 Slice 1 touches. Keep this in sync with
 * supabase/migrations/0001_identity_and_access_foundation.sql. When Supabase CLI access
 * is available, prefer `supabase gen types typescript` and replace this file with the
 * generated one.
 *
 * `Insert`/`Update` are `Record<string, never>` (rather than omitted) for tables the
 * client must never write directly — every field of an empty-record type is `never`,
 * so passing any real column there is a type error, while still satisfying
 * @supabase/postgrest-js's `GenericTable` shape.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: {
          display_name?: string;
        };
        Relationships: [];
      };
      capabilities: {
        Row: {
          key: string;
          description: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          key: string;
          label: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          key: string;
          label: string;
          description?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      warehouses: {
        Row: {
          id: string;
          code: string;
          name: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          code: string;
          name: string;
          active?: boolean;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: number;
          event_type: string;
          actor_user_id: string | null;
          target_table: string | null;
          target_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      foundation_protected_demo: {
        Row: {
          id: number;
          note: string;
          created_by: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_capability: {
        Args: { p_capability_key: string };
        Returns: boolean;
      };
      has_warehouse_access: {
        Args: { p_warehouse_id: string };
        Returns: boolean;
      };
      my_capabilities: {
        Args: Record<string, never>;
        Returns: { capability_key: string }[];
      };
      my_warehouse_ids: {
        Args: Record<string, never>;
        Returns: { warehouse_id: string }[];
      };
      foundation_demo_create: {
        Args: { p_note: string };
        Returns: number;
      };
    };
  };
}
