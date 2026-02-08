export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          parent_id: string | null
          unit_id: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["account_type"]
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          parent_id?: string | null
          unit_id: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          parent_id?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      adult_trainings: {
        Row: {
          completed_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          is_current: boolean | null
          profile_id: string
          training_code: string
          training_name: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_current?: boolean | null
          profile_id: string
          training_code: string
          training_name: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_current?: boolean | null
          profile_id?: string
          training_code?: string
          training_name?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adult_trainings_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adult_trainings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          id: string
          new_values: Json | null
          old_values: Json | null
          performed_at: string | null
          performed_by: string | null
          record_id: string
          table_name: string
          unit_id: string | null
        }
        Insert: {
          action: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          record_id: string
          table_name: string
          unit_id?: string | null
        }
        Update: {
          action?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          performed_at?: string | null
          performed_by?: string | null
          record_id?: string
          table_name?: string
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      balance_import_batches: {
        Row: {
          created_at: string | null
          id: string
          imported_by: string
          mode: string
          row_count: number
          status: string
          undone_at: string | null
          undone_by: string | null
          unit_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          imported_by: string
          mode: string
          row_count?: number
          status?: string
          undone_at?: string | null
          undone_by?: string | null
          unit_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          imported_by?: string
          mode?: string
          row_count?: number
          status?: string
          undone_at?: string | null
          undone_by?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_import_batches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_import_batches_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_import_batches_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_charges: {
        Row: {
          amount: number
          billing_record_id: string
          id: string
          is_paid: boolean | null
          is_void: boolean | null
          scout_account_id: string
          void_journal_entry_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          billing_record_id: string
          id?: string
          is_paid?: boolean | null
          is_void?: boolean | null
          scout_account_id: string
          void_journal_entry_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          billing_record_id?: string
          id?: string
          is_paid?: boolean | null
          is_void?: boolean | null
          scout_account_id?: string
          void_journal_entry_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_charges_billing_record_id_fkey"
            columns: ["billing_record_id"]
            isOneToOne: false
            referencedRelation: "billing_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charges_scout_account_id_fkey"
            columns: ["scout_account_id"]
            isOneToOne: false
            referencedRelation: "scout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charges_void_journal_entry_id_fkey"
            columns: ["void_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charges_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_records: {
        Row: {
          billing_date: string
          created_at: string | null
          created_by: string | null
          description: string
          event_id: string | null
          id: string
          is_void: boolean | null
          journal_entry_id: string | null
          total_amount: number
          unit_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          billing_date: string
          created_at?: string | null
          created_by?: string | null
          description: string
          event_id?: string | null
          id?: string
          is_void?: boolean | null
          journal_entry_id?: string | null
          total_amount: number
          unit_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          billing_date?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          event_id?: string | null
          id?: string
          is_void?: boolean | null
          journal_entry_id?: string | null
          total_amount?: number
          unit_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bsa_leadership_positions: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_patrol_level: boolean | null
          is_troop_level: boolean | null
          min_tenure_months: number | null
          name: string
          qualifies_for_eagle: boolean | null
          qualifies_for_life: boolean | null
          qualifies_for_star: boolean | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_patrol_level?: boolean | null
          is_troop_level?: boolean | null
          min_tenure_months?: number | null
          name: string
          qualifies_for_eagle?: boolean | null
          qualifies_for_life?: boolean | null
          qualifies_for_star?: boolean | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_patrol_level?: boolean | null
          is_troop_level?: boolean | null
          min_tenure_months?: number | null
          name?: string
          qualifies_for_eagle?: boolean | null
          qualifies_for_life?: boolean | null
          qualifies_for_star?: boolean | null
        }
        Relationships: []
      }
      bsa_merit_badge_requirements: {
        Row: {
          alternatives_group: string | null
          created_at: string | null
          description: string
          display_order: number
          id: string
          is_alternative: boolean | null
          is_header: boolean | null
          merit_badge_id: string
          nesting_depth: number | null
          original_scoutbook_id: string | null
          parent_requirement_id: string | null
          required_count: number | null
          requirement_number: string
          scoutbook_requirement_number: string | null
          sub_requirement_letter: string | null
          version_year: number | null
        }
        Insert: {
          alternatives_group?: string | null
          created_at?: string | null
          description: string
          display_order: number
          id?: string
          is_alternative?: boolean | null
          is_header?: boolean | null
          merit_badge_id: string
          nesting_depth?: number | null
          original_scoutbook_id?: string | null
          parent_requirement_id?: string | null
          required_count?: number | null
          requirement_number: string
          scoutbook_requirement_number?: string | null
          sub_requirement_letter?: string | null
          version_year?: number | null
        }
        Update: {
          alternatives_group?: string | null
          created_at?: string | null
          description?: string
          display_order?: number
          id?: string
          is_alternative?: boolean | null
          is_header?: boolean | null
          merit_badge_id?: string
          nesting_depth?: number | null
          original_scoutbook_id?: string | null
          parent_requirement_id?: string | null
          required_count?: number | null
          requirement_number?: string
          scoutbook_requirement_number?: string | null
          sub_requirement_letter?: string | null
          version_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bsa_merit_badge_requirements_merit_badge_id_fkey"
            columns: ["merit_badge_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bsa_merit_badge_requirements_parent_requirement_id_fkey"
            columns: ["parent_requirement_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badge_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      bsa_merit_badge_versions: {
        Row: {
          created_at: string | null
          effective_date: string | null
          id: string
          is_current: boolean | null
          merit_badge_id: string
          notes: string | null
          scraped_at: string | null
          source: string | null
          updated_at: string | null
          version_year: number
        }
        Insert: {
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_current?: boolean | null
          merit_badge_id: string
          notes?: string | null
          scraped_at?: string | null
          source?: string | null
          updated_at?: string | null
          version_year: number
        }
        Update: {
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_current?: boolean | null
          merit_badge_id?: string
          notes?: string | null
          scraped_at?: string | null
          source?: string | null
          updated_at?: string | null
          version_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "bsa_merit_badge_versions_merit_badge_id_fkey"
            columns: ["merit_badge_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badges"
            referencedColumns: ["id"]
          },
        ]
      }
      bsa_merit_badges: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_eagle_required: boolean | null
          name: string
          pamphlet_url: string | null
          requirement_version_year: number | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_eagle_required?: boolean | null
          name: string
          pamphlet_url?: string | null
          requirement_version_year?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_eagle_required?: boolean | null
          name?: string
          pamphlet_url?: string | null
          requirement_version_year?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bsa_rank_requirements: {
        Row: {
          alternatives_group: string | null
          created_at: string | null
          description: string
          display_order: number
          id: string
          is_alternative: boolean | null
          parent_requirement_id: string | null
          rank_id: string
          requirement_number: string
          sub_requirement_letter: string | null
          version_year: number | null
        }
        Insert: {
          alternatives_group?: string | null
          created_at?: string | null
          description: string
          display_order: number
          id?: string
          is_alternative?: boolean | null
          parent_requirement_id?: string | null
          rank_id: string
          requirement_number: string
          sub_requirement_letter?: string | null
          version_year?: number | null
        }
        Update: {
          alternatives_group?: string | null
          created_at?: string | null
          description?: string
          display_order?: number
          id?: string
          is_alternative?: boolean | null
          parent_requirement_id?: string | null
          rank_id?: string
          requirement_number?: string
          sub_requirement_letter?: string | null
          version_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bsa_rank_requirements_parent_requirement_id_fkey"
            columns: ["parent_requirement_id"]
            isOneToOne: false
            referencedRelation: "bsa_rank_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bsa_rank_requirements_rank_id_fkey"
            columns: ["rank_id"]
            isOneToOne: false
            referencedRelation: "bsa_ranks"
            referencedColumns: ["id"]
          },
        ]
      }
      bsa_ranks: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          display_order: number
          id: string
          image_url: string | null
          is_eagle_required: boolean | null
          name: string
          requirement_version_year: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          display_order: number
          id?: string
          image_url?: string | null
          is_eagle_required?: boolean | null
          name: string
          requirement_version_year?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          is_eagle_required?: boolean | null
          name?: string
          requirement_version_year?: number | null
        }
        Relationships: []
      }
      event_rsvps: {
        Row: {
          event_id: string
          id: string
          is_driver: boolean | null
          notes: string | null
          profile_id: string | null
          responded_at: string | null
          scout_id: string | null
          status: Database["public"]["Enums"]["rsvp_status"]
          vehicle_seats: number | null
        }
        Insert: {
          event_id: string
          id?: string
          is_driver?: boolean | null
          notes?: string | null
          profile_id?: string | null
          responded_at?: string | null
          scout_id?: string | null
          status: Database["public"]["Enums"]["rsvp_status"]
          vehicle_seats?: number | null
        }
        Update: {
          event_id?: string
          id?: string
          is_driver?: boolean | null
          notes?: string | null
          profile_id?: string | null
          responded_at?: string | null
          scout_id?: string | null
          status?: Database["public"]["Enums"]["rsvp_status"]
          vehicle_seats?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cost_per_adult: number | null
          cost_per_scout: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          end_date: string | null
          event_type: string | null
          id: string
          location: string | null
          max_participants: number | null
          rsvp_deadline: string | null
          start_date: string
          title: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          cost_per_adult?: number | null
          cost_per_scout?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: string | null
          id?: string
          location?: string | null
          max_participants?: number | null
          rsvp_deadline?: string | null
          start_date: string
          title: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          cost_per_adult?: number | null
          cost_per_scout?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          event_type?: string | null
          id?: string
          location?: string | null
          max_participants?: number | null
          rsvp_deadline?: string | null
          start_date?: string
          title?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_auth_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          is_revoked: boolean | null
          last_used_at: string | null
          profile_id: string
          token_hash: string
          unit_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          is_revoked?: boolean | null
          last_used_at?: string | null
          profile_id: string
          token_hash: string
          unit_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          is_revoked?: boolean | null
          last_used_at?: string | null
          profile_id?: string
          token_hash?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_auth_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_auth_tokens_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      fundraiser_types: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fundraiser_types_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string
          current_phase: string | null
          error_message: string | null
          id: string
          processed_items: number | null
          processed_scouts: number | null
          result: Json | null
          selected_scout_ids: Json
          staged_data: Json
          started_at: string | null
          status: string
          total_items: number | null
          total_scouts: number | null
          type: string
          unit_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          current_phase?: string | null
          error_message?: string | null
          id?: string
          processed_items?: number | null
          processed_scouts?: number | null
          result?: Json | null
          selected_scout_ids?: Json
          staged_data: Json
          started_at?: string | null
          status?: string
          total_items?: number | null
          total_scouts?: number | null
          type: string
          unit_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          current_phase?: string | null
          error_message?: string | null
          id?: string
          processed_items?: number | null
          processed_scouts?: number | null
          result?: Json | null
          selected_scout_ids?: Json
          staged_data?: Json
          started_at?: string | null
          status?: string
          total_items?: number | null
          total_scouts?: number | null
          type?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      import_requirement_mismatches: {
        Row: {
          advancement_type: string
          badge_or_rank_name: string
          bsa_member_id: string | null
          created_at: string
          csv_row_data: Json | null
          error_reason: string | null
          id: string
          import_file_name: string | null
          import_type: string
          imported_by: string | null
          requirement_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          scout_id: string | null
          scout_name: string | null
          unit_id: string
          version_year: number | null
        }
        Insert: {
          advancement_type: string
          badge_or_rank_name: string
          bsa_member_id?: string | null
          created_at?: string
          csv_row_data?: Json | null
          error_reason?: string | null
          id?: string
          import_file_name?: string | null
          import_type: string
          imported_by?: string | null
          requirement_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scout_id?: string | null
          scout_name?: string | null
          unit_id: string
          version_year?: number | null
        }
        Update: {
          advancement_type?: string
          badge_or_rank_name?: string
          bsa_member_id?: string | null
          created_at?: string
          csv_row_data?: Json | null
          error_reason?: string | null
          id?: string
          import_file_name?: string | null
          import_type?: string
          imported_by?: string | null
          requirement_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scout_id?: string | null
          scout_name?: string | null
          unit_id?: string
          version_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_requirement_mismatches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_requirement_mismatches_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_requirement_mismatches_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_requirement_mismatches_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_checkouts: {
        Row: {
          checked_out_at: string | null
          id: string
          inventory_item_id: string
          notes: string | null
          quantity_out: number
          quantity_returned: number | null
          quantity_sold: number | null
          returned_at: string | null
          scout_id: string
          settled_at: string | null
        }
        Insert: {
          checked_out_at?: string | null
          id?: string
          inventory_item_id: string
          notes?: string | null
          quantity_out: number
          quantity_returned?: number | null
          quantity_sold?: number | null
          returned_at?: string | null
          scout_id: string
          settled_at?: string | null
        }
        Update: {
          checked_out_at?: string | null
          id?: string
          inventory_item_id?: string
          notes?: string | null
          quantity_out?: number
          quantity_returned?: number | null
          quantity_sold?: number | null
          returned_at?: string | null
          scout_id?: string
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_checkouts_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_checkouts_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string | null
          created_at: string | null
          id: string
          name: string
          quantity_on_hand: number | null
          sale_price: number | null
          sku: string | null
          unit_cost: number | null
          unit_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          quantity_on_hand?: number | null
          sale_price?: number | null
          sku?: string | null
          unit_cost?: number | null
          unit_id: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          quantity_on_hand?: number | null
          sale_price?: number | null
          sku?: string | null
          unit_cost?: number | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          balance_import_batch_id: string | null
          created_at: string | null
          created_by: string | null
          description: string
          entry_date: string
          entry_type: Database["public"]["Enums"]["journal_entry_type"] | null
          fundraiser_type_id: string | null
          id: string
          is_posted: boolean | null
          is_void: boolean | null
          posted_at: string | null
          reference: string | null
          unit_id: string
          void_reason: string | null
        }
        Insert: {
          balance_import_batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description: string
          entry_date: string
          entry_type?: Database["public"]["Enums"]["journal_entry_type"] | null
          fundraiser_type_id?: string | null
          id?: string
          is_posted?: boolean | null
          is_void?: boolean | null
          posted_at?: string | null
          reference?: string | null
          unit_id: string
          void_reason?: string | null
        }
        Update: {
          balance_import_batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["journal_entry_type"] | null
          fundraiser_type_id?: string | null
          id?: string
          is_posted?: boolean | null
          is_void?: boolean | null
          posted_at?: string | null
          reference?: string | null
          unit_id?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_balance_import_batch_id_fkey"
            columns: ["balance_import_batch_id"]
            isOneToOne: false
            referencedRelation: "balance_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_fundraiser_type_id_fkey"
            columns: ["fundraiser_type_id"]
            isOneToOne: false
            referencedRelation: "fundraiser_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          credit: number | null
          debit: number | null
          id: string
          journal_entry_id: string
          memo: string | null
          scout_account_id: string | null
          target_balance: string | null
        }
        Insert: {
          account_id: string
          credit?: number | null
          debit?: number | null
          id?: string
          journal_entry_id: string
          memo?: string | null
          scout_account_id?: string | null
          target_balance?: string | null
        }
        Update: {
          account_id?: string
          credit?: number | null
          debit?: number | null
          id?: string
          journal_entry_id?: string
          memo?: string | null
          scout_account_id?: string | null
          target_balance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_scout_account_id_fkey"
            columns: ["scout_account_id"]
            isOneToOne: false
            referencedRelation: "scout_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      merit_badge_counselors: {
        Row: {
          approved_at: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          merit_badge_id: string
          notes: string | null
          profile_id: string
          unit_id: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          merit_badge_id: string
          notes?: string | null
          profile_id: string
          unit_id: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          merit_badge_id?: string
          notes?: string | null
          profile_id?: string
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merit_badge_counselors_merit_badge_id_fkey"
            columns: ["merit_badge_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merit_badge_counselors_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merit_badge_counselors_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      merit_badge_requirements: {
        Row: {
          badge_version_id: string
          created_at: string | null
          depth: number | null
          description: string | null
          display_label: string | null
          id: string
          is_header: boolean | null
          item: string | null
          main_req: string | null
          option_letter: string | null
          option_name: string | null
          parent_id: string | null
          scoutbook_id: string
          section: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          badge_version_id: string
          created_at?: string | null
          depth?: number | null
          description?: string | null
          display_label?: string | null
          id?: string
          is_header?: boolean | null
          item?: string | null
          main_req?: string | null
          option_letter?: string | null
          option_name?: string | null
          parent_id?: string | null
          scoutbook_id: string
          section?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          badge_version_id?: string
          created_at?: string | null
          depth?: number | null
          description?: string | null
          display_label?: string | null
          id?: string
          is_header?: boolean | null
          item?: string | null
          main_req?: string | null
          option_letter?: string | null
          option_name?: string | null
          parent_id?: string | null
          scoutbook_id?: string
          section?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merit_badge_requirements_badge_version_id_fkey"
            columns: ["badge_version_id"]
            isOneToOne: false
            referencedRelation: "merit_badge_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merit_badge_requirements_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "merit_badge_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      merit_badge_versions: {
        Row: {
          badge_name: string
          badge_slug: string
          canonical_source: string | null
          created_at: string | null
          has_canonical_data: boolean | null
          id: string
          id_format: string | null
          is_eagle_required: boolean | null
          requirement_count: number | null
          updated_at: string | null
          version_year: number
        }
        Insert: {
          badge_name: string
          badge_slug: string
          canonical_source?: string | null
          created_at?: string | null
          has_canonical_data?: boolean | null
          id?: string
          id_format?: string | null
          is_eagle_required?: boolean | null
          requirement_count?: number | null
          updated_at?: string | null
          version_year: number
        }
        Update: {
          badge_name?: string
          badge_slug?: string
          canonical_source?: string | null
          created_at?: string | null
          has_canonical_data?: boolean | null
          id?: string
          id_format?: string | null
          is_eagle_required?: boolean | null
          requirement_count?: number | null
          updated_at?: string | null
          version_year?: number
        }
        Relationships: []
      }
      patrols: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patrols_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          amount: number
          base_amount: number | null
          billing_charge_id: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          expires_at: string
          fee_amount: number | null
          fees_passed_to_payer: boolean | null
          id: string
          payment_id: string | null
          scout_account_id: string | null
          status: Database["public"]["Enums"]["payment_link_status"] | null
          token: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          base_amount?: number | null
          billing_charge_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          expires_at: string
          fee_amount?: number | null
          fees_passed_to_payer?: boolean | null
          id?: string
          payment_id?: string | null
          scout_account_id?: string | null
          status?: Database["public"]["Enums"]["payment_link_status"] | null
          token: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          base_amount?: number | null
          billing_charge_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string
          fee_amount?: number | null
          fees_passed_to_payer?: boolean | null
          id?: string
          payment_id?: string | null
          scout_account_id?: string | null
          status?: Database["public"]["Enums"]["payment_link_status"] | null
          token?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_billing_charge_id_fkey"
            columns: ["billing_charge_id"]
            isOneToOne: false
            referencedRelation: "billing_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_scout_account_id_fkey"
            columns: ["scout_account_id"]
            isOneToOne: false
            referencedRelation: "scout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          fee_amount: number | null
          id: string
          journal_entry_id: string | null
          net_amount: number
          notes: string | null
          payment_method: string | null
          scout_account_id: string | null
          square_payment_id: string | null
          square_receipt_url: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          unit_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          fee_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          net_amount: number
          notes?: string | null
          payment_method?: string | null
          scout_account_id?: string | null
          square_payment_id?: string | null
          square_receipt_url?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          unit_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          fee_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          net_amount?: number
          notes?: string | null
          payment_method?: string | null
          scout_account_id?: string | null
          square_payment_id?: string | null
          square_receipt_url?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          unit_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_scout_account_id_fkey"
            columns: ["scout_account_id"]
            isOneToOne: false
            referencedRelation: "scout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_connections: {
        Row: {
          access_token: string
          accounts: Json | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          institution_id: string | null
          institution_name: string | null
          item_id: string
          last_synced_at: string | null
          status: string
          unit_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          accounts?: Json | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id: string
          last_synced_at?: string | null
          status?: string
          unit_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          accounts?: Json | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string
          last_synced_at?: string | null
          status?: string
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_connections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          bsa_member_id: string | null
          created_at: string | null
          date_joined: string | null
          email: string | null
          email_secondary: string | null
          expiration_date: string | null
          first_name: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          health_form_expires: string | null
          health_form_status: string | null
          id: string
          is_active: boolean | null
          last_name: string | null
          last_synced_at: string | null
          member_type: string | null
          phone_primary: string | null
          phone_secondary: string | null
          position: string | null
          position_2: string | null
          renewal_status: string | null
          swim_class_date: string | null
          swim_classification:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          sync_session_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          bsa_member_id?: string | null
          created_at?: string | null
          date_joined?: string | null
          email?: string | null
          email_secondary?: string | null
          expiration_date?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          health_form_expires?: string | null
          health_form_status?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string | null
          last_synced_at?: string | null
          member_type?: string | null
          phone_primary?: string | null
          phone_secondary?: string | null
          position?: string | null
          position_2?: string | null
          renewal_status?: string | null
          swim_class_date?: string | null
          swim_classification?:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          sync_session_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          bsa_member_id?: string | null
          created_at?: string | null
          date_joined?: string | null
          email?: string | null
          email_secondary?: string | null
          expiration_date?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          health_form_expires?: string | null
          health_form_status?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string | null
          last_synced_at?: string | null
          member_type?: string | null
          phone_primary?: string | null
          phone_secondary?: string | null
          position?: string | null
          position_2?: string | null
          renewal_status?: string | null
          swim_class_date?: string | null
          swim_classification?:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          sync_session_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      scout_accounts: {
        Row: {
          billing_balance: number | null
          created_at: string | null
          funds_balance: number
          id: string
          scout_id: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          billing_balance?: number | null
          created_at?: string | null
          funds_balance?: number
          id?: string
          scout_id: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          billing_balance?: number | null
          created_at?: string | null
          funds_balance?: number
          id?: string
          scout_id?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_accounts_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: true
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_accounts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_activity_entries: {
        Row: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at: string | null
          description: string | null
          event_id: string | null
          id: string
          location: string | null
          scout_id: string
          sync_session_id: string | null
          synced_at: string | null
          value: number
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          activity_date: string
          activity_type: Database["public"]["Enums"]["activity_type"]
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          id?: string
          location?: string | null
          scout_id: string
          sync_session_id?: string | null
          synced_at?: string | null
          value: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          activity_date?: string
          activity_type?: Database["public"]["Enums"]["activity_type"]
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          id?: string
          location?: string | null
          scout_id?: string
          sync_session_id?: string | null
          synced_at?: string | null
          value?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_activity_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_activity_entries_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_activity_entries_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_activity_entries_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_activity_logs: {
        Row: {
          camping_nights: number | null
          hiking_miles: number | null
          id: string
          scout_id: string
          service_hours: number | null
          sync_session_id: string | null
          synced_at: string | null
        }
        Insert: {
          camping_nights?: number | null
          hiking_miles?: number | null
          id?: string
          scout_id: string
          service_hours?: number | null
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Update: {
          camping_nights?: number | null
          hiking_miles?: number | null
          id?: string
          scout_id?: string
          service_hours?: number | null
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_activity_logs_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: true
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_activity_logs_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_advancements: {
        Row: {
          advancement_data: Json | null
          bsa_member_id: string | null
          current_rank: string | null
          date_joined: string | null
          id: string
          last_rank_cub_scout: string | null
          last_rank_scouts_bsa: string | null
          membership_status: string | null
          scout_id: string
          sync_session_id: string | null
          synced_at: string | null
        }
        Insert: {
          advancement_data?: Json | null
          bsa_member_id?: string | null
          current_rank?: string | null
          date_joined?: string | null
          id?: string
          last_rank_cub_scout?: string | null
          last_rank_scouts_bsa?: string | null
          membership_status?: string | null
          scout_id: string
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Update: {
          advancement_data?: Json | null
          bsa_member_id?: string | null
          current_rank?: string | null
          date_joined?: string | null
          id?: string
          last_rank_cub_scout?: string | null
          last_rank_scouts_bsa?: string | null
          membership_status?: string | null
          scout_id?: string
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_advancements_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: true
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_advancements_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_guardians: {
        Row: {
          id: string
          is_primary: boolean | null
          profile_id: string
          relationship: string | null
          scout_id: string
        }
        Insert: {
          id?: string
          is_primary?: boolean | null
          profile_id: string
          relationship?: string | null
          scout_id: string
        }
        Update: {
          id?: string
          is_primary?: boolean | null
          profile_id?: string
          relationship?: string | null
          scout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scout_guardians_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_guardians_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_leadership_history: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          notes: string | null
          position_id: string
          scout_id: string
          start_date: string
          sync_session_id: string | null
          synced_at: string | null
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          position_id: string
          scout_id: string
          start_date: string
          sync_session_id?: string | null
          synced_at?: string | null
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          position_id?: string
          scout_id?: string
          start_date?: string
          sync_session_id?: string | null
          synced_at?: string | null
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_leadership_history_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "bsa_leadership_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_leadership_history_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_leadership_history_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_leadership_history_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_leadership_positions: {
        Row: {
          date_range: string | null
          days: number | null
          id: string
          is_current: boolean | null
          position: string
          scout_id: string
          sync_session_id: string | null
          synced_at: string | null
          unit_name: string | null
        }
        Insert: {
          date_range?: string | null
          days?: number | null
          id?: string
          is_current?: boolean | null
          position: string
          scout_id: string
          sync_session_id?: string | null
          synced_at?: string | null
          unit_name?: string | null
        }
        Update: {
          date_range?: string | null
          days?: number | null
          id?: string
          is_current?: boolean | null
          position?: string
          scout_id?: string
          sync_session_id?: string | null
          synced_at?: string | null
          unit_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_leadership_positions_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_leadership_positions_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_merit_badge_progress: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          awarded_at: string | null
          completed_at: string | null
          counselor_bsa_id: string | null
          counselor_name: string | null
          counselor_profile_id: string | null
          counselor_signed_at: string | null
          created_at: string | null
          id: string
          merit_badge_id: string
          requirement_version_year: number | null
          scout_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["advancement_status"]
          sync_session_id: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          awarded_at?: string | null
          completed_at?: string | null
          counselor_bsa_id?: string | null
          counselor_name?: string | null
          counselor_profile_id?: string | null
          counselor_signed_at?: string | null
          created_at?: string | null
          id?: string
          merit_badge_id: string
          requirement_version_year?: number | null
          scout_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["advancement_status"]
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          awarded_at?: string | null
          completed_at?: string | null
          counselor_bsa_id?: string | null
          counselor_name?: string | null
          counselor_profile_id?: string | null
          counselor_signed_at?: string | null
          created_at?: string | null
          id?: string
          merit_badge_id?: string
          requirement_version_year?: number | null
          scout_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["advancement_status"]
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_merit_badge_progress_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_progress_counselor_profile_id_fkey"
            columns: ["counselor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_progress_merit_badge_id_fkey"
            columns: ["merit_badge_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_progress_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_progress_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_merit_badge_requirement_progress: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          notes: string | null
          requirement_id: string
          scout_merit_badge_progress_id: string
          status: Database["public"]["Enums"]["advancement_status"]
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          requirement_id: string
          scout_merit_badge_progress_id: string
          status?: Database["public"]["Enums"]["advancement_status"]
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          requirement_id?: string
          scout_merit_badge_progress_id?: string
          status?: Database["public"]["Enums"]["advancement_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_merit_badge_requirement_progress_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_requirement_progress_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "bsa_merit_badge_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_merit_badge_requirement_scout_merit_badge_progress_i_fkey"
            columns: ["scout_merit_badge_progress_id"]
            isOneToOne: false
            referencedRelation: "scout_merit_badge_progress"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_rank_progress: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          awarded_at: string | null
          awarded_by: string | null
          completed_at: string | null
          created_at: string | null
          external_status: string | null
          id: string
          rank_id: string
          scout_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["advancement_status"]
          sync_session_id: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          awarded_at?: string | null
          awarded_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          external_status?: string | null
          id?: string
          rank_id: string
          scout_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["advancement_status"]
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          awarded_at?: string | null
          awarded_by?: string | null
          completed_at?: string | null
          created_at?: string | null
          external_status?: string | null
          id?: string
          rank_id?: string
          scout_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["advancement_status"]
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_rank_progress_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_progress_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_progress_rank_id_fkey"
            columns: ["rank_id"]
            isOneToOne: false
            referencedRelation: "bsa_ranks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_progress_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_progress_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_rank_requirement_progress: {
        Row: {
          approval_status: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          denial_reason: string | null
          id: string
          notes: string | null
          requirement_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          scout_rank_progress_id: string
          status: Database["public"]["Enums"]["advancement_status"]
          submission_notes: string | null
          submitted_at: string | null
          submitted_by: string | null
          sync_session_id: string | null
          synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          approval_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          denial_reason?: string | null
          id?: string
          notes?: string | null
          requirement_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scout_rank_progress_id: string
          status?: Database["public"]["Enums"]["advancement_status"]
          submission_notes?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          denial_reason?: string | null
          id?: string
          notes?: string | null
          requirement_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scout_rank_progress_id?: string
          status?: Database["public"]["Enums"]["advancement_status"]
          submission_notes?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          sync_session_id?: string | null
          synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_rank_requirement_progress_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirement_progress_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "bsa_rank_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirement_progress_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirement_progress_scout_rank_progress_id_fkey"
            columns: ["scout_rank_progress_id"]
            isOneToOne: false
            referencedRelation: "scout_rank_progress"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirement_progress_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirement_progress_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_rank_requirements: {
        Row: {
          completed_date: string | null
          id: string
          percent_complete: number | null
          rank_name: string
          requirements: Json | null
          requirements_version: string | null
          scout_id: string
          status: string
          sync_session_id: string | null
          synced_at: string | null
        }
        Insert: {
          completed_date?: string | null
          id?: string
          percent_complete?: number | null
          rank_name: string
          requirements?: Json | null
          requirements_version?: string | null
          scout_id: string
          status?: string
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Update: {
          completed_date?: string | null
          id?: string
          percent_complete?: number | null
          rank_name?: string
          requirements?: Json | null
          requirements_version?: string | null
          scout_id?: string
          status?: string
          sync_session_id?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_rank_requirements_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_rank_requirements_sync_session_id_fkey"
            columns: ["sync_session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scouts: {
        Row: {
          bsa_member_id: string | null
          created_at: string | null
          current_position: string | null
          current_position_2: string | null
          date_joined: string | null
          date_of_birth: string | null
          expiration_date: string | null
          first_name: string
          gender: Database["public"]["Enums"]["gender"] | null
          health_form_expires: string | null
          health_form_status: string | null
          id: string
          is_active: boolean | null
          last_name: string
          middle_name: string | null
          patrol_id: string | null
          profile_id: string | null
          rank: string | null
          renewal_status: string | null
          swim_class_date: string | null
          swim_classification:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          bsa_member_id?: string | null
          created_at?: string | null
          current_position?: string | null
          current_position_2?: string | null
          date_joined?: string | null
          date_of_birth?: string | null
          expiration_date?: string | null
          first_name: string
          gender?: Database["public"]["Enums"]["gender"] | null
          health_form_expires?: string | null
          health_form_status?: string | null
          id?: string
          is_active?: boolean | null
          last_name: string
          middle_name?: string | null
          patrol_id?: string | null
          profile_id?: string | null
          rank?: string | null
          renewal_status?: string | null
          swim_class_date?: string | null
          swim_classification?:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          bsa_member_id?: string | null
          created_at?: string | null
          current_position?: string | null
          current_position_2?: string | null
          date_joined?: string | null
          date_of_birth?: string | null
          expiration_date?: string | null
          first_name?: string
          gender?: Database["public"]["Enums"]["gender"] | null
          health_form_expires?: string | null
          health_form_status?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string
          middle_name?: string | null
          patrol_id?: string | null
          profile_id?: string | null
          rank?: string | null
          renewal_status?: string | null
          swim_class_date?: string | null
          swim_classification?:
            | Database["public"]["Enums"]["swim_classification"]
            | null
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scouts_patrol_id_fkey"
            columns: ["patrol_id"]
            isOneToOne: false
            referencedRelation: "patrols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scouts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scouts_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_rate_limits: {
        Row: {
          attempts: number | null
          blocked_until: string | null
          email: string | null
          first_attempt_at: string | null
          id: string
          ip_address: string
          last_attempt_at: string | null
        }
        Insert: {
          attempts?: number | null
          blocked_until?: string | null
          email?: string | null
          first_attempt_at?: string | null
          id?: string
          ip_address: string
          last_attempt_at?: string | null
        }
        Update: {
          attempts?: number | null
          blocked_until?: string | null
          email?: string | null
          first_attempt_at?: string | null
          id?: string
          ip_address?: string
          last_attempt_at?: string | null
        }
        Relationships: []
      }
      square_transactions: {
        Row: {
          amount_money: number
          buyer_email_address: string | null
          card_brand: string | null
          cardholder_name: string | null
          created_at: string | null
          currency: string | null
          fee_money: number | null
          id: string
          is_reconciled: boolean | null
          last_4: string | null
          net_money: number
          note: string | null
          order_line_items: Json | null
          payment_id: string | null
          receipt_number: string | null
          receipt_url: string | null
          scout_account_id: string | null
          source_type: string | null
          square_created_at: string
          square_order_id: string | null
          square_payment_id: string
          status: string
          synced_at: string | null
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          amount_money: number
          buyer_email_address?: string | null
          card_brand?: string | null
          cardholder_name?: string | null
          created_at?: string | null
          currency?: string | null
          fee_money?: number | null
          id?: string
          is_reconciled?: boolean | null
          last_4?: string | null
          net_money: number
          note?: string | null
          order_line_items?: Json | null
          payment_id?: string | null
          receipt_number?: string | null
          receipt_url?: string | null
          scout_account_id?: string | null
          source_type?: string | null
          square_created_at: string
          square_order_id?: string | null
          square_payment_id: string
          status: string
          synced_at?: string | null
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          amount_money?: number
          buyer_email_address?: string | null
          card_brand?: string | null
          cardholder_name?: string | null
          created_at?: string | null
          currency?: string | null
          fee_money?: number | null
          id?: string
          is_reconciled?: boolean | null
          last_4?: string | null
          net_money?: number
          note?: string | null
          order_line_items?: Json | null
          payment_id?: string | null
          receipt_number?: string | null
          receipt_url?: string | null
          scout_account_id?: string | null
          source_type?: string | null
          square_created_at?: string
          square_order_id?: string | null
          square_payment_id?: string
          status?: string
          synced_at?: string | null
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "square_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_transactions_scout_account_id_fkey"
            columns: ["scout_account_id"]
            isOneToOne: false
            referencedRelation: "scout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_transactions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      staged_roster_imports: {
        Row: {
          created_at: string | null
          id: string
          parsed_adults: Json
          parsed_scouts: Json
          provisioning_token_id: string
          unit_metadata: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          parsed_adults: Json
          parsed_scouts: Json
          provisioning_token_id: string
          unit_metadata?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          parsed_adults?: Json
          parsed_scouts?: Json
          provisioning_token_id?: string
          unit_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "staged_roster_imports_provisioning_token_id_fkey"
            columns: ["provisioning_token_id"]
            isOneToOne: false
            referencedRelation: "unit_provisioning_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          error_log: Json | null
          id: string
          pages_visited: number | null
          records_extracted: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["sync_status"]
          sync_source: string | null
          unit_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_log?: Json | null
          id?: string
          pages_visited?: number | null
          records_extracted?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_status"]
          sync_source?: string | null
          unit_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          error_log?: Json | null
          id?: string
          pages_visited?: number | null
          records_extracted?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_status"]
          sync_source?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_sessions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_staged_advancement: {
        Row: {
          change_type: string
          changes: Json | null
          conflict_details: string | null
          conflict_detected: boolean | null
          created_at: string | null
          data_type: string
          existing_record_id: string | null
          id: string
          is_selected: boolean | null
          scout_id: string
          session_id: string
          staged_data: Json
        }
        Insert: {
          change_type: string
          changes?: Json | null
          conflict_details?: string | null
          conflict_detected?: boolean | null
          created_at?: string | null
          data_type: string
          existing_record_id?: string | null
          id?: string
          is_selected?: boolean | null
          scout_id: string
          session_id: string
          staged_data: Json
        }
        Update: {
          change_type?: string
          changes?: Json | null
          conflict_details?: string | null
          conflict_detected?: boolean | null
          created_at?: string | null
          data_type?: string
          existing_record_id?: string | null
          id?: string
          is_selected?: boolean | null
          scout_id?: string
          session_id?: string
          staged_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "sync_staged_advancement_scout_id_fkey"
            columns: ["scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_staged_advancement_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_staged_members: {
        Row: {
          age: string | null
          bsa_member_id: string
          change_type: string
          changes: Json | null
          created_at: string | null
          existing_profile_id: string | null
          existing_scout_id: string | null
          expiration_date: string | null
          first_name: string
          full_name: string
          id: string
          is_selected: boolean | null
          last_name: string
          match_type: string | null
          matched_profile_id: string | null
          member_type: string
          patrol: string | null
          position: string | null
          position_2: string | null
          rank: string | null
          renewal_status: string | null
          session_id: string
          skip_reason: string | null
          status: string | null
          unit_id: string
        }
        Insert: {
          age?: string | null
          bsa_member_id: string
          change_type: string
          changes?: Json | null
          created_at?: string | null
          existing_profile_id?: string | null
          existing_scout_id?: string | null
          expiration_date?: string | null
          first_name: string
          full_name: string
          id?: string
          is_selected?: boolean | null
          last_name: string
          match_type?: string | null
          matched_profile_id?: string | null
          member_type: string
          patrol?: string | null
          position?: string | null
          position_2?: string | null
          rank?: string | null
          renewal_status?: string | null
          session_id: string
          skip_reason?: string | null
          status?: string | null
          unit_id: string
        }
        Update: {
          age?: string | null
          bsa_member_id?: string
          change_type?: string
          changes?: Json | null
          created_at?: string | null
          existing_profile_id?: string | null
          existing_scout_id?: string | null
          expiration_date?: string | null
          first_name?: string
          full_name?: string
          id?: string
          is_selected?: boolean | null
          last_name?: string
          match_type?: string | null
          matched_profile_id?: string | null
          member_type?: string
          patrol?: string | null
          position?: string | null
          position_2?: string | null
          rank?: string | null
          renewal_status?: string | null
          session_id?: string
          skip_reason?: string | null
          status?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_staged_members_existing_profile_id_fkey"
            columns: ["existing_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_staged_members_existing_scout_id_fkey"
            columns: ["existing_scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_staged_members_matched_profile_id_fkey"
            columns: ["matched_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_staged_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sync_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_staged_members_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_memberships: {
        Row: {
          accepted_at: string | null
          created_by: string | null
          current_position: string | null
          email: string | null
          id: string
          invite_expires_at: string | null
          invited_at: string | null
          invited_by: string | null
          is_merit_badge_counselor: boolean | null
          joined_at: string | null
          linked_scout_id: string | null
          profile_id: string | null
          role: Database["public"]["Enums"]["membership_role"]
          section_unit_id: string | null
          status: Database["public"]["Enums"]["membership_status"] | null
          unit_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_by?: string | null
          current_position?: string | null
          email?: string | null
          id?: string
          invite_expires_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_merit_badge_counselor?: boolean | null
          joined_at?: string | null
          linked_scout_id?: string | null
          profile_id?: string | null
          role: Database["public"]["Enums"]["membership_role"]
          section_unit_id?: string | null
          status?: Database["public"]["Enums"]["membership_status"] | null
          unit_id: string
        }
        Update: {
          accepted_at?: string | null
          created_by?: string | null
          current_position?: string | null
          email?: string | null
          id?: string
          invite_expires_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_merit_badge_counselor?: boolean | null
          joined_at?: string | null
          linked_scout_id?: string | null
          profile_id?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          section_unit_id?: string | null
          status?: Database["public"]["Enums"]["membership_status"] | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_memberships_linked_scout_id_fkey"
            columns: ["linked_scout_id"]
            isOneToOne: false
            referencedRelation: "scouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_memberships_section_unit_id_fkey"
            columns: ["section_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_memberships_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_provisioning_tokens: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          id: string
          profile_id: string
          token_hash: string
          unit_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          profile_id: string
          token_hash: string
          unit_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          profile_id?: string
          token_hash?: string
          unit_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_provisioning_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_provisioning_tokens_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_square_credentials: {
        Row: {
          access_token_encrypted: string
          connected_at: string | null
          created_at: string | null
          environment: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          location_id: string | null
          merchant_id: string
          refresh_token_encrypted: string
          token_expires_at: string
          unit_id: string
          updated_at: string | null
        }
        Insert: {
          access_token_encrypted: string
          connected_at?: string | null
          created_at?: string | null
          environment?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          location_id?: string | null
          merchant_id: string
          refresh_token_encrypted: string
          token_expires_at: string
          unit_id: string
          updated_at?: string | null
        }
        Update: {
          access_token_encrypted?: string
          connected_at?: string | null
          created_at?: string | null
          environment?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          location_id?: string | null
          merchant_id?: string
          refresh_token_encrypted?: string
          token_expires_at?: string
          unit_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_square_credentials_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          chartered_org: string | null
          collection_settings: Json | null
          council: string | null
          created_at: string | null
          district: string | null
          id: string
          is_section: boolean | null
          logo_url: string | null
          name: string
          parent_unit_id: string | null
          pass_fees_to_payer: boolean | null
          processing_fee_fixed: number | null
          processing_fee_percent: number | null
          provisioning_status: string | null
          setup_completed_at: string | null
          unit_gender: Database["public"]["Enums"]["unit_gender"] | null
          unit_number: string
          unit_type: Database["public"]["Enums"]["unit_type"]
          updated_at: string | null
        }
        Insert: {
          chartered_org?: string | null
          collection_settings?: Json | null
          council?: string | null
          created_at?: string | null
          district?: string | null
          id?: string
          is_section?: boolean | null
          logo_url?: string | null
          name: string
          parent_unit_id?: string | null
          pass_fees_to_payer?: boolean | null
          processing_fee_fixed?: number | null
          processing_fee_percent?: number | null
          provisioning_status?: string | null
          setup_completed_at?: string | null
          unit_gender?: Database["public"]["Enums"]["unit_gender"] | null
          unit_number: string
          unit_type: Database["public"]["Enums"]["unit_type"]
          updated_at?: string | null
        }
        Update: {
          chartered_org?: string | null
          collection_settings?: Json | null
          council?: string | null
          created_at?: string | null
          district?: string | null
          id?: string
          is_section?: boolean | null
          logo_url?: string | null
          name?: string
          parent_unit_id?: string | null
          pass_fees_to_payer?: boolean | null
          processing_fee_fixed?: number | null
          processing_fee_percent?: number | null
          provisioning_status?: string | null
          setup_completed_at?: string | null
          unit_gender?: Database["public"]["Enums"]["unit_gender"] | null
          unit_number?: string
          unit_type?: Database["public"]["Enums"]["unit_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_parent_unit_id_fkey"
            columns: ["parent_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          additional_info: string | null
          biggest_pain_point: string | null
          created_at: string
          current_payment_platform: string | null
          current_software: string | null
          email: string
          id: string
          ip_address: string | null
          name: string | null
          referral_source: string | null
          unit_size: string | null
          unit_type: string | null
          user_agent: string | null
        }
        Insert: {
          additional_info?: string | null
          biggest_pain_point?: string | null
          created_at?: string
          current_payment_platform?: string | null
          current_software?: string | null
          email: string
          id?: string
          ip_address?: string | null
          name?: string | null
          referral_source?: string | null
          unit_size?: string | null
          unit_type?: string | null
          user_agent?: string | null
        }
        Update: {
          additional_info?: string | null
          biggest_pain_point?: string | null
          created_at?: string
          current_payment_platform?: string | null
          current_software?: string | null
          email?: string
          id?: string
          ip_address?: string | null
          name?: string | null
          referral_source?: string | null
          unit_size?: string | null
          unit_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_transfer_overpayment: {
        Args: { p_amount: number; p_scout_account_id: string }
        Returns: undefined
      }
      calculate_days_served: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: number
      }
      calculate_rank_progress_percentage: {
        Args: { p_scout_rank_progress_id: string }
        Returns: number
      }
      cleanup_expired_provisioning_tokens: { Args: never; Returns: undefined }
      create_billing_with_journal: {
        Args: {
          p_billing_date: string
          p_billing_type: string
          p_description: string
          p_per_scout_amount: number
          p_scout_accounts: Json
          p_total_amount: number
          p_unit_id: string
        }
        Returns: Json
      }
      create_default_accounts: {
        Args: { p_unit_id: string }
        Returns: undefined
      }
      create_refund_journal_entry: {
        Args: {
          p_original_square_payment_id: string
          p_refund_amount_cents: number
          p_refund_reason?: string
          p_scout_account_id: string
          p_square_refund_id: string
          p_unit_id: string
        }
        Returns: Json
      }
      create_unit_sections: {
        Args: {
          p_boys_number?: string
          p_girls_number?: string
          p_parent_unit_id: string
        }
        Returns: {
          boys_section_id: string
          girls_section_id: string
        }[]
      }
      credit_fundraising_to_scout: {
        Args: {
          p_amount: number
          p_description: string
          p_fundraiser_type?: string
          p_scout_account_id: string
        }
        Returns: Json
      }
      get_auth_user_email: { Args: never; Returns: string }
      get_current_profile_id: { Args: never; Returns: string }
      get_parent_unit: { Args: { p_unit_id: string }; Returns: string }
      get_unit_sections: { Args: { p_unit_id: string }; Returns: string[] }
      get_user_active_unit_ids: { Args: never; Returns: string[] }
      initialize_scout_rank_progress: {
        Args: { p_rank_id: string; p_scout_id: string; p_version_id?: string }
        Returns: string
      }
      insert_merit_badge_requirement: {
        Args: {
          p_alternatives_group: string
          p_description: string
          p_display_order: number
          p_is_alternative: boolean
          p_merit_badge_id: string
          p_nesting_depth: number
          p_original_scoutbook_id: string
          p_required_count: number
          p_requirement_number: string
          p_sub_requirement_letter: string
          p_version_id: string
        }
        Returns: string
      }
      is_leadership_position_current: {
        Args: { p_end_date: string }
        Returns: boolean
      }
      process_payment_link_payment: {
        Args: {
          p_base_amount_cents: number
          p_buyer_email?: string
          p_card_details: Json
          p_fee_amount_cents: number
          p_fees_passed_to_payer: boolean
          p_net_amount_cents: number
          p_payment_link_id: string
          p_payment_note?: string
          p_scout_account_id: string
          p_scout_name: string
          p_square_order_id: string
          p_square_payment_id: string
          p_square_receipt_url: string
          p_total_amount_cents: number
        }
        Returns: Json
      }
      transfer_funds_to_billing: {
        Args: {
          p_amount: number
          p_description?: string
          p_scout_account_id: string
        }
        Returns: Json
      }
      update_billing_description: {
        Args: { p_billing_record_id: string; p_new_description: string }
        Returns: Json
      }
      update_requirement_parent: {
        Args: { p_id: string; p_parent_id: string }
        Returns: undefined
      }
      user_has_role: {
        Args: {
          required_roles: Database["public"]["Enums"]["membership_role"][]
          unit: string
        }
        Returns: boolean
      }
      user_is_unit_admin: { Args: { check_unit_id: string }; Returns: boolean }
      validate_journal_entry_balance: {
        Args: { entry_id: string }
        Returns: boolean
      }
      void_billing_charge: {
        Args: { p_billing_charge_id: string; p_void_reason: string }
        Returns: Json
      }
      void_billing_record: {
        Args: { p_billing_record_id: string; p_void_reason: string }
        Returns: Json
      }
      void_payment: {
        Args: { p_payment_id: string; p_reason: string; p_voided_by: string }
        Returns: Json
      }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "income" | "expense"
      activity_type: "camping" | "hiking" | "service" | "conservation"
      advancement_status:
        | "not_started"
        | "in_progress"
        | "completed"
        | "pending_approval"
        | "approved"
        | "awarded"
      gender: "male" | "female" | "other" | "prefer_not_to_say"
      journal_entry_type:
        | "billing"
        | "payment"
        | "refund"
        | "reversal"
        | "adjustment"
        | "funds_transfer"
        | "fundraising_credit"
        | "beginning_balance"
        | "balance_import_reversal"
      membership_role: "admin" | "treasurer" | "leader" | "parent" | "scout"
      membership_status: "roster" | "invited" | "active" | "inactive"
      payment_link_status: "pending" | "completed" | "expired" | "cancelled"
      payment_status: "pending" | "completed" | "voided" | "refunded"
      rsvp_status: "going" | "not_going" | "maybe"
      swim_classification: "swimmer" | "beginner" | "non-swimmer"
      sync_status: "running" | "staged" | "completed" | "failed" | "cancelled"
      unit_gender: "boys" | "girls" | "coed"
      unit_type: "troop" | "pack" | "crew" | "ship"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["asset", "liability", "equity", "income", "expense"],
      activity_type: ["camping", "hiking", "service", "conservation"],
      advancement_status: [
        "not_started",
        "in_progress",
        "completed",
        "pending_approval",
        "approved",
        "awarded",
      ],
      gender: ["male", "female", "other", "prefer_not_to_say"],
      journal_entry_type: [
        "billing",
        "payment",
        "refund",
        "reversal",
        "adjustment",
        "funds_transfer",
        "fundraising_credit",
        "beginning_balance",
        "balance_import_reversal",
      ],
      membership_role: ["admin", "treasurer", "leader", "parent", "scout"],
      membership_status: ["roster", "invited", "active", "inactive"],
      payment_link_status: ["pending", "completed", "expired", "cancelled"],
      payment_status: ["pending", "completed", "voided", "refunded"],
      rsvp_status: ["going", "not_going", "maybe"],
      swim_classification: ["swimmer", "beginner", "non-swimmer"],
      sync_status: ["running", "staged", "completed", "failed", "cancelled"],
      unit_gender: ["boys", "girls", "coed"],
      unit_type: ["troop", "pack", "crew", "ship"],
    },
  },
} as const
