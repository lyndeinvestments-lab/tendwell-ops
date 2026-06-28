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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      _properties_client_backup_20260512: {
        Row: {
          original_client: string | null
          original_contact_id: string | null
          property_id: number
          snapshot_at: string
        }
        Insert: {
          original_client?: string | null
          original_contact_id?: string | null
          property_id: number
          snapshot_at?: string
        }
        Update: {
          original_client?: string | null
          original_contact_id?: string | null
          property_id?: number
          snapshot_at?: string
        }
        Relationships: []
      }
      access_audit_log: {
        Row: {
          action: string
          field_name: string
          id: string
          property_id: number | null
          revealed_by: string | null
          timestamp: string
        }
        Insert: {
          action: string
          field_name: string
          id?: string
          property_id?: number | null
          revealed_by?: string | null
          timestamp?: string
        }
        Update: {
          action?: string
          field_name?: string
          id?: string
          property_id?: number | null
          revealed_by?: string | null
          timestamp?: string
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          field_name: string | null
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          action?: string
          changed_by?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          field_name?: string | null
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      alert_dismissals: {
        Row: {
          alert_key: string
          dismissed_at: string | null
          dismissed_by: string | null
          id: string
          snoozed_until: string | null
        }
        Insert: {
          alert_key: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          snoozed_until?: string | null
        }
        Update: {
          alert_key?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          id?: string
          snoozed_until?: string | null
        }
        Relationships: []
      }
      amenity_costs: {
        Row: {
          cost: number
          id: number
          product: string
          updated_at: string | null
        }
        Insert: {
          cost?: number
          id?: number
          product: string
          updated_at?: string | null
        }
        Update: {
          cost?: number
          id?: number
          product?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      app_users: {
        Row: {
          allowed_views: string[] | null
          created_at: string | null
          custom_permissions: Json | null
          custom_views: Json | null
          google_email: string | null
          id: number
          label: string | null
          password_hash: string | null
          role: string
        }
        Insert: {
          allowed_views?: string[] | null
          created_at?: string | null
          custom_permissions?: Json | null
          custom_views?: Json | null
          google_email?: string | null
          id?: number
          label?: string | null
          password_hash?: string | null
          role: string
        }
        Update: {
          allowed_views?: string[] | null
          created_at?: string | null
          custom_permissions?: Json | null
          custom_views?: Json | null
          google_email?: string | null
          id?: number
          label?: string | null
          password_hash?: string | null
          role?: string
        }
        Relationships: []
      }
      breezeway_import_log: {
        Row: {
          cleans_in_batch: number
          deep_cleans_in_batch: number
          id: string
          imported_at: string
          notes: string | null
          rows_failed: number
          rows_inserted: number
          rows_updated: number
          source_label: string | null
        }
        Insert: {
          cleans_in_batch?: number
          deep_cleans_in_batch?: number
          id?: string
          imported_at?: string
          notes?: string | null
          rows_failed?: number
          rows_inserted?: number
          rows_updated?: number
          source_label?: string | null
        }
        Update: {
          cleans_in_batch?: number
          deep_cleans_in_batch?: number
          id?: string
          imported_at?: string
          notes?: string | null
          rows_failed?: number
          rows_inserted?: number
          rows_updated?: number
          source_label?: string | null
        }
        Relationships: []
      }
      breezeway_tasks: {
        Row: {
          assignees: string | null
          completed_by: string | null
          completed_date: string | null
          created_date: string | null
          department: string | null
          due_date: string | null
          external_id: string
          id: string
          import_batch: string | null
          imported_at: string
          is_clean: boolean
          is_deep_clean: boolean
          last_updated_date: string | null
          priority: string | null
          property_address: string | null
          property_id: number | null
          property_raw: string | null
          raw: Json | null
          source_label: string | null
          status: string | null
          task_title: string
        }
        Insert: {
          assignees?: string | null
          completed_by?: string | null
          completed_date?: string | null
          created_date?: string | null
          department?: string | null
          due_date?: string | null
          external_id: string
          id?: string
          import_batch?: string | null
          imported_at?: string
          is_clean?: boolean
          is_deep_clean?: boolean
          last_updated_date?: string | null
          priority?: string | null
          property_address?: string | null
          property_id?: number | null
          property_raw?: string | null
          raw?: Json | null
          source_label?: string | null
          status?: string | null
          task_title: string
        }
        Update: {
          assignees?: string | null
          completed_by?: string | null
          completed_date?: string | null
          created_date?: string | null
          department?: string | null
          due_date?: string | null
          external_id?: string
          id?: string
          import_batch?: string | null
          imported_at?: string
          is_clean?: boolean
          is_deep_clean?: boolean
          last_updated_date?: string | null
          priority?: string | null
          property_address?: string | null
          property_id?: number | null
          property_raw?: string | null
          raw?: Json | null
          source_label?: string | null
          status?: string | null
          task_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breezeway_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      clean_assignments: {
        Row: {
          cleaner_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          property_id: number | null
          scheduled_date: string
          status: string | null
        }
        Insert: {
          cleaner_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          property_id?: number | null
          scheduled_date: string
          status?: string | null
        }
        Update: {
          cleaner_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          property_id?: number | null
          scheduled_date?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clean_assignments_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clean_assignments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      cleaner_coaching_flags: {
        Row: {
          cleaner_id: string
          created_at: string
          flagged_by: string | null
          id: string
          issue_count: number | null
          issue_rate: number | null
          notes: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          total_cleans: number | null
        }
        Insert: {
          cleaner_id: string
          created_at?: string
          flagged_by?: string | null
          id?: string
          issue_count?: number | null
          issue_rate?: number | null
          notes?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          total_cleans?: number | null
        }
        Update: {
          cleaner_id?: string
          created_at?: string
          flagged_by?: string | null
          id?: string
          issue_count?: number | null
          issue_rate?: number | null
          notes?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          total_cleans?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaner_coaching_flags_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaners: {
        Row: {
          app_role: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          invite_sent_at: string | null
          is_active: boolean
          notes: string | null
          pay_rate: number | null
          phone: string | null
        }
        Insert: {
          app_role?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          invite_sent_at?: string | null
          is_active?: boolean
          notes?: string | null
          pay_rate?: number | null
          phone?: string | null
        }
        Update: {
          app_role?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          invite_sent_at?: string | null
          is_active?: boolean
          notes?: string | null
          pay_rate?: number | null
          phone?: string | null
        }
        Relationships: []
      }
      cleaning_history: {
        Row: {
          clean_cost: number | null
          clean_date: string
          cleaner_name: string | null
          id: string
          imported_at: string
          property_id: number
        }
        Insert: {
          clean_cost?: number | null
          clean_date: string
          cleaner_name?: string | null
          id?: string
          imported_at?: string
          property_id: number
        }
        Update: {
          clean_cost?: number | null
          clean_date?: string
          cleaner_name?: string | null
          id?: string
          imported_at?: string
          property_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      cleaning_issues: {
        Row: {
          assessment: string | null
          category: string
          completed_at: string | null
          coverage: string | null
          created_at: string
          created_by: string | null
          details: string | null
          id: string
          issue_type: string | null
          last_touch: string | null
          priority: string
          property_id: number | null
          property_name: string | null
          reference: string | null
          remarks: string | null
          report_date: string
          resolution: string | null
          share_token: string | null
          slack_link: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment?: string | null
          category?: string
          completed_at?: string | null
          coverage?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          issue_type?: string | null
          last_touch?: string | null
          priority?: string
          property_id?: number | null
          property_name?: string | null
          reference?: string | null
          remarks?: string | null
          report_date?: string
          resolution?: string | null
          share_token?: string | null
          slack_link?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assessment?: string | null
          category?: string
          completed_at?: string | null
          coverage?: string | null
          created_at?: string
          created_by?: string | null
          details?: string | null
          id?: string
          issue_type?: string | null
          last_touch?: string | null
          priority?: string
          property_id?: number | null
          property_name?: string | null
          reference?: string | null
          remarks?: string | null
          report_date?: string
          resolution?: string | null
          share_token?: string | null
          slack_link?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_issues_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      cleaning_issues_deleted_backup_20260610: {
        Row: {
          assessment: string | null
          category: string | null
          completed_at: string | null
          coverage: string | null
          created_at: string | null
          created_by: string | null
          details: string | null
          id: string | null
          issue_type: string | null
          last_touch: string | null
          priority: string | null
          property_id: number | null
          property_name: string | null
          reference: string | null
          remarks: string | null
          report_date: string | null
          resolution: string | null
          share_token: string | null
          slack_link: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assessment?: string | null
          category?: string | null
          completed_at?: string | null
          coverage?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: string | null
          id?: string | null
          issue_type?: string | null
          last_touch?: string | null
          priority?: string | null
          property_id?: number | null
          property_name?: string | null
          reference?: string | null
          remarks?: string | null
          report_date?: string | null
          resolution?: string | null
          share_token?: string | null
          slack_link?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assessment?: string | null
          category?: string | null
          completed_at?: string | null
          coverage?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: string | null
          id?: string | null
          issue_type?: string | null
          last_touch?: string | null
          priority?: string | null
          property_id?: number | null
          property_name?: string | null
          reference?: string | null
          remarks?: string | null
          report_date?: string | null
          resolution?: string | null
          share_token?: string | null
          slack_link?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cleaning_issues_status_backup_20260610: {
        Row: {
          id: string | null
          status: string | null
        }
        Insert: {
          id?: string | null
          status?: string | null
        }
        Update: {
          id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      cleaning_issues_type_backup_20260609: {
        Row: {
          id: string | null
          issue_type: string | null
        }
        Insert: {
          id?: string | null
          issue_type?: string | null
        }
        Update: {
          id?: string | null
          issue_type?: string | null
        }
        Relationships: []
      }
      cleaning_logs: {
        Row: {
          actual_pay: number | null
          clean_date: string
          clean_type: string | null
          cleaner_name: string | null
          created_at: string | null
          id: number
          notes: string | null
          property_id: number | null
        }
        Insert: {
          actual_pay?: number | null
          clean_date: string
          clean_type?: string | null
          cleaner_name?: string | null
          created_at?: string | null
          id?: number
          notes?: string | null
          property_id?: number | null
        }
        Update: {
          actual_pay?: number | null
          clean_date?: string
          clean_type?: string | null
          cleaner_name?: string | null
          created_at?: string | null
          id?: number
          notes?: string | null
          property_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaning_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      contact_interactions: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          id: string
          interaction_type: string
          summary: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          interaction_type: string
          summary?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          interaction_type?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          contact_id: string | null
          content: string
          created_at: string | null
          created_by: string | null
          id: string
        }
        Insert: {
          contact_id?: string | null
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
        }
        Update: {
          contact_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          additional_properties_count: number | null
          additional_properties_notes: string | null
          client_since: string | null
          company: string | null
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean | null
          mailing_address: string | null
          notes: string | null
          payment_method: string | null
          payment_notes: string | null
          phone: string | null
          secondary_phone: string | null
          source: string | null
          source_notes: string | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          additional_properties_count?: number | null
          additional_properties_notes?: string | null
          client_since?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          mailing_address?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          phone?: string | null
          secondary_phone?: string | null
          source?: string | null
          source_notes?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          additional_properties_count?: number | null
          additional_properties_notes?: string | null
          client_since?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          mailing_address?: string | null
          notes?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          phone?: string | null
          secondary_phone?: string | null
          source?: string | null
          source_notes?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      csv_import_log: {
        Row: {
          error_details: Json | null
          file_name: string
          id: string
          import_status: string
          imported_at: string
          imported_by: string | null
          properties_updated: number
          rows_attempted: number
          rows_errored: number
          rows_inserted: number
          rows_skipped: number
          source_table: string
        }
        Insert: {
          error_details?: Json | null
          file_name: string
          id?: string
          import_status?: string
          imported_at?: string
          imported_by?: string | null
          properties_updated?: number
          rows_attempted?: number
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          source_table?: string
        }
        Update: {
          error_details?: Json | null
          file_name?: string
          id?: string
          import_status?: string
          imported_at?: string
          imported_by?: string | null
          properties_updated?: number
          rows_attempted?: number
          rows_errored?: number
          rows_inserted?: number
          rows_skipped?: number
          source_table?: string
        }
        Relationships: []
      }
      incoming_shipments: {
        Row: {
          created_at: string
          delivery_responsible: string
          description: string
          estimated_delivery: string
          id: string
          property_name: string
          received_at: string | null
          received_by: string | null
          received_notes: string | null
          sender_name: string
          submitted_at: string
          tracking_number: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          delivery_responsible: string
          description: string
          estimated_delivery: string
          id?: string
          property_name: string
          received_at?: string | null
          received_by?: string | null
          received_notes?: string | null
          sender_name: string
          submitted_at?: string
          tracking_number?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          delivery_responsible?: string
          description?: string
          estimated_delivery?: string
          id?: string
          property_name?: string
          received_at?: string | null
          received_by?: string | null
          received_notes?: string | null
          sender_name?: string
          submitted_at?: string
          tracking_number?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      inspection_photos: {
        Row: {
          created_at: string | null
          id: string
          inspection_id: string | null
          photo_url: string
          section: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          inspection_id?: string | null
          photo_url: string
          section?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          inspection_id?: string | null
          photo_url?: string
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          cleaner_id: string | null
          cleaner_name: string | null
          cleanliness_score: number | null
          created_at: string | null
          exterior_score: number | null
          id: string
          inspected_at: string
          inspected_by: string | null
          inspector_id: string | null
          last_cleaned_on: string | null
          linens_score: number | null
          notes: string | null
          overall_score: number | null
          photos_url: string[] | null
          property_id: number | null
          reinspect_by: string | null
          reinspect_urgency: string
          scheduled_for: string | null
          status: string
          supplies_score: number | null
        }
        Insert: {
          cleaner_id?: string | null
          cleaner_name?: string | null
          cleanliness_score?: number | null
          created_at?: string | null
          exterior_score?: number | null
          id?: string
          inspected_at?: string
          inspected_by?: string | null
          inspector_id?: string | null
          last_cleaned_on?: string | null
          linens_score?: number | null
          notes?: string | null
          overall_score?: number | null
          photos_url?: string[] | null
          property_id?: number | null
          reinspect_by?: string | null
          reinspect_urgency?: string
          scheduled_for?: string | null
          status?: string
          supplies_score?: number | null
        }
        Update: {
          cleaner_id?: string | null
          cleaner_name?: string | null
          cleanliness_score?: number | null
          created_at?: string | null
          exterior_score?: number | null
          id?: string
          inspected_at?: string
          inspected_by?: string | null
          inspector_id?: string | null
          last_cleaned_on?: string | null
          linens_score?: number | null
          notes?: string | null
          overall_score?: number | null
          photos_url?: string[] | null
          property_id?: number | null
          reinspect_by?: string | null
          reinspect_urgency?: string
          scheduled_for?: string | null
          status?: string
          supplies_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      intel_feed_items: {
        Row: {
          context: string | null
          fetched_at: string | null
          id: string
          is_done: boolean
          meta: string | null
          priority: string | null
          snoozed_until: string | null
          source: string
          title: string
          url: string | null
        }
        Insert: {
          context?: string | null
          fetched_at?: string | null
          id: string
          is_done?: boolean
          meta?: string | null
          priority?: string | null
          snoozed_until?: string | null
          source: string
          title: string
          url?: string | null
        }
        Update: {
          context?: string | null
          fetched_at?: string | null
          id?: string
          is_done?: boolean
          meta?: string | null
          priority?: string | null
          snoozed_until?: string | null
          source?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      issue_comments: {
        Row: {
          author_name: string | null
          author_type: string
          content: string
          created_at: string
          id: string
          issue_id: string
        }
        Insert: {
          author_name?: string | null
          author_type?: string
          content: string
          created_at?: string
          id?: string
          issue_id: string
        }
        Update: {
          author_name?: string | null
          author_type?: string
          content?: string
          created_at?: string
          id?: string
          issue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_comments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "cleaning_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_photos: {
        Row: {
          author_type: string
          created_at: string
          id: string
          issue_id: string
          phase: string
          photo_path: string | null
          photo_url: string
          uploaded_by: string | null
        }
        Insert: {
          author_type?: string
          created_at?: string
          id?: string
          issue_id: string
          phase?: string
          photo_path?: string | null
          photo_url: string
          uploaded_by?: string | null
        }
        Update: {
          author_type?: string
          created_at?: string
          id?: string
          issue_id?: string
          phase?: string
          photo_path?: string | null
          photo_url?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_photos_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "cleaning_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      laundry_weigh_ins: {
        Row: {
          cleaner_name: string
          created_at: string
          has_special_linens: boolean | null
          id: string
          language: string | null
          laundry_type: string
          photo_path: string | null
          photo_url: string | null
          pounds: number
          special_linen_description: string | null
          special_linen_photo_path: string | null
          special_linen_photo_url: string | null
          special_linen_property: string | null
          special_linen_weight: number | null
          submitted_at: string
          user_agent: string | null
        }
        Insert: {
          cleaner_name: string
          created_at?: string
          has_special_linens?: boolean | null
          id?: string
          language?: string | null
          laundry_type: string
          photo_path?: string | null
          photo_url?: string | null
          pounds: number
          special_linen_description?: string | null
          special_linen_photo_path?: string | null
          special_linen_photo_url?: string | null
          special_linen_property?: string | null
          special_linen_weight?: number | null
          submitted_at?: string
          user_agent?: string | null
        }
        Update: {
          cleaner_name?: string
          created_at?: string
          has_special_linens?: boolean | null
          id?: string
          language?: string | null
          laundry_type?: string
          photo_path?: string | null
          photo_url?: string | null
          pounds?: number
          special_linen_description?: string | null
          special_linen_photo_path?: string | null
          special_linen_photo_url?: string | null
          special_linen_property?: string | null
          special_linen_weight?: number | null
          submitted_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      linen_inventory_counts: {
        Row: {
          bath_towels: number | null
          bathmats: number | null
          counted_at: string
          counted_by: string | null
          created_at: string
          full_encasements: number | null
          full_fitted_extras: number | null
          full_flat_extras: number | null
          full_pillowcase_extras: number | null
          full_rolls: number | null
          full_top_sheets: number | null
          hand_towels: number | null
          id: string
          king_encasements: number | null
          king_fitted_extras: number | null
          king_flat_extras: number | null
          king_pillowcase_extras: number | null
          king_pillows: number | null
          king_rolls: number | null
          king_top_sheets: number | null
          kitchen_towels: number | null
          notes: string | null
          pool_towels: number | null
          queen_encasements: number | null
          queen_fitted_extras: number | null
          queen_flat_extras: number | null
          queen_pillowcase_extras: number | null
          queen_rolls: number | null
          queen_top_sheets: number | null
          standard_pillows: number | null
          twin_encasements: number | null
          twin_fitted_extras: number | null
          twin_flat_extras: number | null
          twin_pillowcase_extras: number | null
          twin_rolls: number | null
          twin_top_sheets: number | null
          washcloths: number | null
        }
        Insert: {
          bath_towels?: number | null
          bathmats?: number | null
          counted_at?: string
          counted_by?: string | null
          created_at?: string
          full_encasements?: number | null
          full_fitted_extras?: number | null
          full_flat_extras?: number | null
          full_pillowcase_extras?: number | null
          full_rolls?: number | null
          full_top_sheets?: number | null
          hand_towels?: number | null
          id?: string
          king_encasements?: number | null
          king_fitted_extras?: number | null
          king_flat_extras?: number | null
          king_pillowcase_extras?: number | null
          king_pillows?: number | null
          king_rolls?: number | null
          king_top_sheets?: number | null
          kitchen_towels?: number | null
          notes?: string | null
          pool_towels?: number | null
          queen_encasements?: number | null
          queen_fitted_extras?: number | null
          queen_flat_extras?: number | null
          queen_pillowcase_extras?: number | null
          queen_rolls?: number | null
          queen_top_sheets?: number | null
          standard_pillows?: number | null
          twin_encasements?: number | null
          twin_fitted_extras?: number | null
          twin_flat_extras?: number | null
          twin_pillowcase_extras?: number | null
          twin_rolls?: number | null
          twin_top_sheets?: number | null
          washcloths?: number | null
        }
        Update: {
          bath_towels?: number | null
          bathmats?: number | null
          counted_at?: string
          counted_by?: string | null
          created_at?: string
          full_encasements?: number | null
          full_fitted_extras?: number | null
          full_flat_extras?: number | null
          full_pillowcase_extras?: number | null
          full_rolls?: number | null
          full_top_sheets?: number | null
          hand_towels?: number | null
          id?: string
          king_encasements?: number | null
          king_fitted_extras?: number | null
          king_flat_extras?: number | null
          king_pillowcase_extras?: number | null
          king_pillows?: number | null
          king_rolls?: number | null
          king_top_sheets?: number | null
          kitchen_towels?: number | null
          notes?: string | null
          pool_towels?: number | null
          queen_encasements?: number | null
          queen_fitted_extras?: number | null
          queen_flat_extras?: number | null
          queen_pillowcase_extras?: number | null
          queen_rolls?: number | null
          queen_top_sheets?: number | null
          standard_pillows?: number | null
          twin_encasements?: number | null
          twin_fitted_extras?: number | null
          twin_flat_extras?: number | null
          twin_pillowcase_extras?: number | null
          twin_rolls?: number | null
          twin_top_sheets?: number | null
          washcloths?: number | null
        }
        Relationships: []
      }
      linen_inventory_counts_backup_20260609: {
        Row: {
          bath_towels: number | null
          bathmats: number | null
          counted_at: string | null
          counted_by: string | null
          created_at: string | null
          full_encasements: number | null
          full_fitted_extras: number | null
          full_flat_extras: number | null
          full_pillowcase_extras: number | null
          full_rolls: number | null
          full_top_sheets: number | null
          hand_towels: number | null
          id: string | null
          king_encasements: number | null
          king_fitted_extras: number | null
          king_flat_extras: number | null
          king_pillowcase_extras: number | null
          king_pillows: number | null
          king_rolls: number | null
          king_top_sheets: number | null
          kitchen_towels: number | null
          notes: string | null
          pool_towels: number | null
          queen_encasements: number | null
          queen_fitted_extras: number | null
          queen_flat_extras: number | null
          queen_pillowcase_extras: number | null
          queen_rolls: number | null
          queen_top_sheets: number | null
          standard_pillows: number | null
          twin_encasements: number | null
          twin_fitted_extras: number | null
          twin_flat_extras: number | null
          twin_pillowcase_extras: number | null
          twin_rolls: number | null
          twin_top_sheets: number | null
          washcloths: number | null
        }
        Insert: {
          bath_towels?: number | null
          bathmats?: number | null
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string | null
          full_encasements?: number | null
          full_fitted_extras?: number | null
          full_flat_extras?: number | null
          full_pillowcase_extras?: number | null
          full_rolls?: number | null
          full_top_sheets?: number | null
          hand_towels?: number | null
          id?: string | null
          king_encasements?: number | null
          king_fitted_extras?: number | null
          king_flat_extras?: number | null
          king_pillowcase_extras?: number | null
          king_pillows?: number | null
          king_rolls?: number | null
          king_top_sheets?: number | null
          kitchen_towels?: number | null
          notes?: string | null
          pool_towels?: number | null
          queen_encasements?: number | null
          queen_fitted_extras?: number | null
          queen_flat_extras?: number | null
          queen_pillowcase_extras?: number | null
          queen_rolls?: number | null
          queen_top_sheets?: number | null
          standard_pillows?: number | null
          twin_encasements?: number | null
          twin_fitted_extras?: number | null
          twin_flat_extras?: number | null
          twin_pillowcase_extras?: number | null
          twin_rolls?: number | null
          twin_top_sheets?: number | null
          washcloths?: number | null
        }
        Update: {
          bath_towels?: number | null
          bathmats?: number | null
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string | null
          full_encasements?: number | null
          full_fitted_extras?: number | null
          full_flat_extras?: number | null
          full_pillowcase_extras?: number | null
          full_rolls?: number | null
          full_top_sheets?: number | null
          hand_towels?: number | null
          id?: string | null
          king_encasements?: number | null
          king_fitted_extras?: number | null
          king_flat_extras?: number | null
          king_pillowcase_extras?: number | null
          king_pillows?: number | null
          king_rolls?: number | null
          king_top_sheets?: number | null
          kitchen_towels?: number | null
          notes?: string | null
          pool_towels?: number | null
          queen_encasements?: number | null
          queen_fitted_extras?: number | null
          queen_flat_extras?: number | null
          queen_pillowcase_extras?: number | null
          queen_rolls?: number | null
          queen_top_sheets?: number | null
          standard_pillows?: number | null
          twin_encasements?: number | null
          twin_fitted_extras?: number | null
          twin_flat_extras?: number | null
          twin_pillowcase_extras?: number | null
          twin_rolls?: number | null
          twin_top_sheets?: number | null
          washcloths?: number | null
        }
        Relationships: []
      }
      lost_item_assignments: {
        Row: {
          assigned_at: string
          assigned_by_user_id: number | null
          assigned_user_id: number | null
          haven_case_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by_user_id?: number | null
          assigned_user_id?: number | null
          haven_case_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by_user_id?: number | null
          assigned_user_id?: number | null
          haven_case_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lost_item_assignments_assigned_by_user_id_fkey"
            columns: ["assigned_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lost_item_assignments_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_financial_snapshot: {
        Row: {
          actual_cogs: number | null
          actual_opex: number | null
          actual_profit: number | null
          actual_revenue: number | null
          actual_source: string | null
          estimate_active_properties: number
          estimate_cleans_count: number
          estimate_cogs: number
          estimate_deep_cleans_count: number
          estimate_opex: number
          estimate_per_property: Json
          estimate_profit: number
          estimate_revenue: number
          first_captured_at: string
          last_reconciled_at: string
          month: string
          notes: string | null
          variance_cogs: number | null
          variance_opex: number | null
          variance_profit: number | null
          variance_revenue: number | null
        }
        Insert: {
          actual_cogs?: number | null
          actual_opex?: number | null
          actual_profit?: number | null
          actual_revenue?: number | null
          actual_source?: string | null
          estimate_active_properties?: number
          estimate_cleans_count?: number
          estimate_cogs?: number
          estimate_deep_cleans_count?: number
          estimate_opex?: number
          estimate_per_property?: Json
          estimate_profit?: number
          estimate_revenue?: number
          first_captured_at?: string
          last_reconciled_at?: string
          month: string
          notes?: string | null
          variance_cogs?: number | null
          variance_opex?: number | null
          variance_profit?: number | null
          variance_revenue?: number | null
        }
        Update: {
          actual_cogs?: number | null
          actual_opex?: number | null
          actual_profit?: number | null
          actual_revenue?: number | null
          actual_source?: string | null
          estimate_active_properties?: number
          estimate_cleans_count?: number
          estimate_cogs?: number
          estimate_deep_cleans_count?: number
          estimate_opex?: number
          estimate_per_property?: Json
          estimate_profit?: number
          estimate_revenue?: number
          first_captured_at?: string
          last_reconciled_at?: string
          month?: string
          notes?: string | null
          variance_cogs?: number | null
          variance_opex?: number | null
          variance_profit?: number | null
          variance_revenue?: number | null
        }
        Relationships: []
      }
      north_star_metrics: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          id: string
          metric_type: string
          monthly_target: number | null
          name: string
          owner_name: string | null
          section: string
          section_order: number | null
          sort_order: number | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          metric_type?: string
          monthly_target?: number | null
          name: string
          owner_name?: string | null
          section: string
          section_order?: number | null
          sort_order?: number | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          metric_type?: string
          monthly_target?: number | null
          name?: string
          owner_name?: string | null
          section?: string
          section_order?: number | null
          sort_order?: number | null
          source?: string | null
        }
        Relationships: []
      }
      north_star_values: {
        Row: {
          id: string
          metric_id: string
          monthly_actual: number | null
          notes: string | null
          period: string
          status: string | null
          updated_at: string | null
          week1: number | null
          week2: number | null
          week3: number | null
          week4: number | null
          week5: number | null
        }
        Insert: {
          id?: string
          metric_id: string
          monthly_actual?: number | null
          notes?: string | null
          period: string
          status?: string | null
          updated_at?: string | null
          week1?: number | null
          week2?: number | null
          week3?: number | null
          week4?: number | null
          week5?: number | null
        }
        Update: {
          id?: string
          metric_id?: string
          monthly_actual?: number | null
          notes?: string | null
          period?: string
          status?: string | null
          updated_at?: string | null
          week1?: number | null
          week2?: number | null
          week3?: number | null
          week4?: number | null
          week5?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "north_star_values_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "north_star_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          error: string | null
          event_type: string
          id: string
          meta: Json | null
          recipient_email: string
          recipient_user_id: number | null
          sent_at: string
          status: string
          subject: string | null
        }
        Insert: {
          error?: string | null
          event_type: string
          id?: string
          meta?: Json | null
          recipient_email: string
          recipient_user_id?: number | null
          sent_at?: string
          status: string
          subject?: string | null
        }
        Update: {
          error?: string | null
          event_type?: string
          id?: string
          meta?: Json | null
          recipient_email?: string
          recipient_user_id?: number | null
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          digest_frequency: string
          email_enabled: boolean
          notify_contact_note_mention: boolean
          notify_follow_up_due: boolean
          notify_issue_logged: boolean
          notify_list_added: boolean
          notify_onboarding_submitted: boolean
          notify_property_note_mention: boolean
          notify_task_assigned: boolean
          notify_task_mention: boolean
          notify_task_overdue: boolean
          notify_verification_due: boolean
          notify_watcher_update: boolean
          updated_at: string
          updated_by: string | null
          user_id: number
        }
        Insert: {
          digest_frequency?: string
          email_enabled?: boolean
          notify_contact_note_mention?: boolean
          notify_follow_up_due?: boolean
          notify_issue_logged?: boolean
          notify_list_added?: boolean
          notify_onboarding_submitted?: boolean
          notify_property_note_mention?: boolean
          notify_task_assigned?: boolean
          notify_task_mention?: boolean
          notify_task_overdue?: boolean
          notify_verification_due?: boolean
          notify_watcher_update?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id: number
        }
        Update: {
          digest_frequency?: string
          email_enabled?: boolean
          notify_contact_note_mention?: boolean
          notify_follow_up_due?: boolean
          notify_issue_logged?: boolean
          notify_list_added?: boolean
          notify_onboarding_submitted?: boolean
          notify_property_note_mention?: boolean
          notify_task_assigned?: boolean
          notify_task_mention?: boolean
          notify_task_overdue?: boolean
          notify_verification_due?: boolean
          notify_watcher_update?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_submissions: {
        Row: {
          address: string | null
          api_client_id: string | null
          api_key: string | null
          approved_at: string | null
          approved_by: string | null
          auto_code: string | null
          bed_sizes: string | null
          bedrooms: number | null
          check_in_time: string | null
          check_out_time: string | null
          client_name: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          door_code: string | null
          filter_size: string | null
          full_baths: number | null
          guest_count: number | null
          half_baths: number | null
          hot_tub: boolean | null
          ical_url: string | null
          id: string
          invoice_email: string | null
          kitchens: number | null
          linen_program: boolean | null
          notes: string | null
          number_of_beds: number | null
          onboarding_deep_clean: boolean | null
          other_codes: string | null
          pet_friendly: string | null
          photos: string[]
          pool: boolean | null
          property_id: number | null
          property_name: string | null
          source: string
          square_footage: number | null
          status: string | null
          submitted_at: string | null
          token: string | null
          wifi_info: string | null
        }
        Insert: {
          address?: string | null
          api_client_id?: string | null
          api_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_code?: string | null
          bed_sizes?: string | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          client_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          door_code?: string | null
          filter_size?: string | null
          full_baths?: number | null
          guest_count?: number | null
          half_baths?: number | null
          hot_tub?: boolean | null
          ical_url?: string | null
          id?: string
          invoice_email?: string | null
          kitchens?: number | null
          linen_program?: boolean | null
          notes?: string | null
          number_of_beds?: number | null
          onboarding_deep_clean?: boolean | null
          other_codes?: string | null
          pet_friendly?: string | null
          photos?: string[]
          pool?: boolean | null
          property_id?: number | null
          property_name?: string | null
          source?: string
          square_footage?: number | null
          status?: string | null
          submitted_at?: string | null
          token?: string | null
          wifi_info?: string | null
        }
        Update: {
          address?: string | null
          api_client_id?: string | null
          api_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auto_code?: string | null
          bed_sizes?: string | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          client_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          door_code?: string | null
          filter_size?: string | null
          full_baths?: number | null
          guest_count?: number | null
          half_baths?: number | null
          hot_tub?: boolean | null
          ical_url?: string | null
          id?: string
          invoice_email?: string | null
          kitchens?: number | null
          linen_program?: boolean | null
          notes?: string | null
          number_of_beds?: number | null
          onboarding_deep_clean?: boolean | null
          other_codes?: string | null
          pet_friendly?: string | null
          photos?: string[]
          pool?: boolean | null
          property_id?: number | null
          property_name?: string | null
          source?: string
          square_footage?: number | null
          status?: string | null
          submitted_at?: string | null
          token?: string | null
          wifi_info?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_submissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      onboarding_task_templates: {
        Row: {
          id: string
          is_active: boolean | null
          sort_order: number | null
          task_name: string
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          task_name: string
        }
        Update: {
          id?: string
          is_active?: boolean | null
          sort_order?: number | null
          task_name?: string
        }
        Relationships: []
      }
      onboarding_tasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          is_complete: boolean | null
          property_id: number
          sort_order: number | null
          task_name: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean | null
          property_id: number
          sort_order?: number | null
          task_name: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          is_complete?: boolean | null
          property_id?: number
          sort_order?: number | null
          task_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      owner_feedback: {
        Row: {
          admin_note: string | null
          body: string
          category: string
          created_at: string
          id: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          body: string
          category?: string
          created_at?: string
          id?: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          body?: string
          category?: string
          created_at?: string
          id?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_feedback_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_properties: {
        Row: {
          created_at: string
          owner_id: string
          property_id: number
        }
        Insert: {
          created_at?: string
          owner_id: string
          property_id: number
        }
        Update: {
          created_at?: string
          owner_id?: string
          property_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "owner_properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_properties_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      owner_property_permissions: {
        Row: {
          owner_id: string
          permissions: Json
          property_id: number
          updated_at: string
        }
        Insert: {
          owner_id: string
          permissions?: Json
          property_id: number
          updated_at?: string
        }
        Update: {
          owner_id?: string
          permissions?: Json
          property_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_property_permissions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_property_permissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      owner_referrals: {
        Row: {
          created_at: string
          id: string
          note: string | null
          owner_id: string
          referred_email: string | null
          referred_name: string
          referred_phone: string | null
          reward_note: string | null
          reward_status: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id: string
          referred_email?: string | null
          referred_name: string
          referred_phone?: string | null
          reward_note?: string | null
          reward_status?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id?: string
          referred_email?: string | null
          referred_name?: string
          referred_phone?: string | null
          reward_note?: string | null
          reward_status?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_referrals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_testimonials: {
        Row: {
          admin_note: string | null
          allow_photo: boolean
          body: string
          created_at: string
          display_preference: string
          id: string
          owner_id: string
          rating: number | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          allow_photo?: boolean
          body: string
          created_at?: string
          display_preference?: string
          id?: string
          owner_id: string
          rating?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          allow_photo?: boolean
          body?: string
          created_at?: string
          display_preference?: string
          id?: string
          owner_id?: string
          rating?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_testimonials_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "property_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          description: string | null
          display_order: number
          id: number
          is_operational: boolean
          name: string
          requires_fields: string[] | null
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: number
          is_operational?: boolean
          name: string
          requires_fields?: string[] | null
          slug: string
        }
        Update: {
          color?: string
          created_at?: string | null
          description?: string | null
          display_order?: number
          id?: number
          is_operational?: boolean
          name?: string
          requires_fields?: string[] | null
          slug?: string
        }
        Relationships: []
      }
      portal_email_events: {
        Row: {
          created_at: string
          delivery: Database["public"]["Enums"]["portal_email_delivery"]
          detail: string | null
          id: string
          owner_id: string | null
          subject: string
          to_address: string
          type: Database["public"]["Enums"]["portal_email_event_type"]
        }
        Insert: {
          created_at?: string
          delivery?: Database["public"]["Enums"]["portal_email_delivery"]
          detail?: string | null
          id?: string
          owner_id?: string | null
          subject: string
          to_address: string
          type: Database["public"]["Enums"]["portal_email_event_type"]
        }
        Update: {
          created_at?: string
          delivery?: Database["public"]["Enums"]["portal_email_delivery"]
          detail?: string | null
          id?: string
          owner_id?: string | null
          subject?: string
          to_address?: string
          type?: Database["public"]["Enums"]["portal_email_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_feature_suggestions: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          owner_id: string
          owner_name: string
          status: Database["public"]["Enums"]["portal_suggestion_status"]
          title: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          owner_id: string
          owner_name: string
          status?: Database["public"]["Enums"]["portal_suggestion_status"]
          title: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          owner_id?: string
          owner_name?: string
          status?: Database["public"]["Enums"]["portal_suggestion_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_feature_suggestions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_feedback: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["portal_feedback_kind"]
          message: string
          owner_id: string
          owner_name: string
          rating: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["portal_feedback_kind"]
          message: string
          owner_id: string
          owner_name: string
          rating?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["portal_feedback_kind"]
          message?: string
          owner_id?: string
          owner_name?: string
          rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_feedback_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["portal_role"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["portal_role"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["portal_role"]
        }
        Relationships: []
      }
      portal_properties: {
        Row: {
          ac_filter_size: string | null
          address: string
          bed_sizes: string
          bedrooms: number | null
          beds: number | null
          booking_calendar_kind: Database["public"]["Enums"]["portal_booking_calendar_kind"]
          booking_calendar_value: string | null
          check_in_time: string | null
          check_out_time: string | null
          cleaner_closet_code: string | null
          created_at: string
          email: string | null
          front_door_code: string | null
          full_baths: number | null
          half_baths: number | null
          hot_tub: boolean
          id: string
          invoice_email: string | null
          invoice_same_as_primary: boolean
          linen_program: boolean
          lockbox_code: string | null
          name: string
          onboarding_deep_clean: boolean
          onboarding_status: Database["public"]["Enums"]["portal_onboarding_status"]
          other_codes: string | null
          owner_id: string
          owner_name: string
          phone: string | null
          photo_urls: string[]
          pool: boolean
          pool_code: string | null
          property_name: string | null
          quote_id: string | null
          special_instructions: string | null
          square_footage: number | null
          status: Database["public"]["Enums"]["portal_property_status"]
          updated_at: string
          wifi_network: string | null
          wifi_password: string | null
        }
        Insert: {
          ac_filter_size?: string | null
          address?: string
          bed_sizes?: string
          bedrooms?: number | null
          beds?: number | null
          booking_calendar_kind?: Database["public"]["Enums"]["portal_booking_calendar_kind"]
          booking_calendar_value?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          cleaner_closet_code?: string | null
          created_at?: string
          email?: string | null
          front_door_code?: string | null
          full_baths?: number | null
          half_baths?: number | null
          hot_tub?: boolean
          id?: string
          invoice_email?: string | null
          invoice_same_as_primary?: boolean
          linen_program?: boolean
          lockbox_code?: string | null
          name: string
          onboarding_deep_clean?: boolean
          onboarding_status?: Database["public"]["Enums"]["portal_onboarding_status"]
          other_codes?: string | null
          owner_id: string
          owner_name?: string
          phone?: string | null
          photo_urls?: string[]
          pool?: boolean
          pool_code?: string | null
          property_name?: string | null
          quote_id?: string | null
          special_instructions?: string | null
          square_footage?: number | null
          status?: Database["public"]["Enums"]["portal_property_status"]
          updated_at?: string
          wifi_network?: string | null
          wifi_password?: string | null
        }
        Update: {
          ac_filter_size?: string | null
          address?: string
          bed_sizes?: string
          bedrooms?: number | null
          beds?: number | null
          booking_calendar_kind?: Database["public"]["Enums"]["portal_booking_calendar_kind"]
          booking_calendar_value?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          cleaner_closet_code?: string | null
          created_at?: string
          email?: string | null
          front_door_code?: string | null
          full_baths?: number | null
          half_baths?: number | null
          hot_tub?: boolean
          id?: string
          invoice_email?: string | null
          invoice_same_as_primary?: boolean
          linen_program?: boolean
          lockbox_code?: string | null
          name?: string
          onboarding_deep_clean?: boolean
          onboarding_status?: Database["public"]["Enums"]["portal_onboarding_status"]
          other_codes?: string | null
          owner_id?: string
          owner_name?: string
          phone?: string | null
          photo_urls?: string[]
          pool?: boolean
          pool_code?: string | null
          property_name?: string | null
          quote_id?: string | null
          special_instructions?: string | null
          square_footage?: number | null
          status?: Database["public"]["Enums"]["portal_property_status"]
          updated_at?: string
          wifi_network?: string | null
          wifi_password?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_properties_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_properties_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "portal_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_property_notes: {
        Row: {
          author_id: string
          author_name: string
          body: string
          created_at: string
          id: string
          property_id: string
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          created_at?: string
          id?: string
          property_id: string
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_property_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "portal_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_quote_line_items: {
        Row: {
          cadence: string
          description: string
          id: string
          quantity: number
          quote_id: string
          unit_price_cents: number
        }
        Insert: {
          cadence?: string
          description: string
          id?: string
          quantity?: number
          quote_id: string
          unit_price_cents?: number
        }
        Update: {
          cadence?: string
          description?: string
          id?: string
          quantity?: number
          quote_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_quote_line_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "portal_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_quotes: {
        Row: {
          approved_at: string | null
          created_at: string
          id: string
          notes: string | null
          owner_id: string
          property_name: string | null
          status: Database["public"]["Enums"]["portal_quote_status"]
          title: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          owner_id: string
          property_name?: string | null
          status?: Database["public"]["Enums"]["portal_quote_status"]
          title: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          property_name?: string | null
          status?: Database["public"]["Enums"]["portal_quote_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_quotes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_referrals: {
        Row: {
          code: string
          created_at: string
          id: string
          notes: string | null
          owner_id: string
          referred_email: string | null
          referred_name: string
          referred_property_name: string | null
          reward_cents: number
          status: Database["public"]["Enums"]["portal_referral_status"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          notes?: string | null
          owner_id: string
          referred_email?: string | null
          referred_name: string
          referred_property_name?: string | null
          reward_cents?: number
          status?: Database["public"]["Enums"]["portal_referral_status"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          referred_email?: string | null
          referred_name?: string
          referred_property_name?: string | null
          reward_cents?: number
          status?: Database["public"]["Enums"]["portal_referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "portal_referrals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_shipments: {
        Row: {
          carrier: string | null
          category: string
          created_at: string
          delivered_at: string | null
          description: string
          eta_date: string | null
          id: string
          owner_id: string
          property_id: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["portal_shipment_status"]
          tracking_number: string | null
        }
        Insert: {
          carrier?: string | null
          category?: string
          created_at?: string
          delivered_at?: string | null
          description: string
          eta_date?: string | null
          id?: string
          owner_id: string
          property_id?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["portal_shipment_status"]
          tracking_number?: string | null
        }
        Update: {
          carrier?: string | null
          category?: string
          created_at?: string
          delivered_at?: string | null
          description?: string
          eta_date?: string | null
          id?: string
          owner_id?: string
          property_id?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["portal_shipment_status"]
          tracking_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_shipments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_shipments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "portal_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_testimonials: {
        Row: {
          admin_notes: string | null
          consent_public_use: boolean
          created_at: string
          display_name: string | null
          id: string
          owner_id: string
          owner_name: string
          photo_url: string | null
          property_id: string | null
          property_name: string | null
          quote_text: string
          share_name: boolean
          share_photo: boolean
          status: Database["public"]["Enums"]["portal_testimonial_status"]
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          consent_public_use?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          owner_id: string
          owner_name: string
          photo_url?: string | null
          property_id?: string | null
          property_name?: string | null
          quote_text: string
          share_name?: boolean
          share_photo?: boolean
          status?: Database["public"]["Enums"]["portal_testimonial_status"]
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          consent_public_use?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          owner_id?: string
          owner_name?: string
          photo_url?: string | null
          property_id?: string | null
          property_name?: string | null
          quote_text?: string
          share_name?: boolean
          share_photo?: boolean
          status?: Database["public"]["Enums"]["portal_testimonial_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_testimonials_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "portal_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_testimonials_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "portal_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      proforma_months: {
        Row: {
          cleaning_fee: number | null
          contractor_pay: number | null
          created_at: string
          inspections: number | null
          laundry: number | null
          leadership: number | null
          month: string
          notes: string | null
          onboarding_revenue: number | null
          opex: number | null
          other_cogs: number | null
          other_income: number | null
          properties: number | null
          services: number | null
          source: string | null
          supplies: number | null
          tasks: number | null
          trash: number | null
          updated_at: string
        }
        Insert: {
          cleaning_fee?: number | null
          contractor_pay?: number | null
          created_at?: string
          inspections?: number | null
          laundry?: number | null
          leadership?: number | null
          month: string
          notes?: string | null
          onboarding_revenue?: number | null
          opex?: number | null
          other_cogs?: number | null
          other_income?: number | null
          properties?: number | null
          services?: number | null
          source?: string | null
          supplies?: number | null
          tasks?: number | null
          trash?: number | null
          updated_at?: string
        }
        Update: {
          cleaning_fee?: number | null
          contractor_pay?: number | null
          created_at?: string
          inspections?: number | null
          laundry?: number | null
          leadership?: number | null
          month?: string
          notes?: string | null
          onboarding_revenue?: number | null
          opex?: number | null
          other_cogs?: number | null
          other_income?: number | null
          properties?: number | null
          services?: number | null
          source?: string | null
          supplies?: number | null
          tasks?: number | null
          trash?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          auto_code: string | null
          avg_cleans_per_month: number | null
          bath_towels: number | null
          bathmats: number | null
          bed_sizes_text: string | null
          bedrooms: number | null
          breezeway_id: string | null
          breezeway_name: string | null
          ce_charged: number | null
          ce_per_sq: number | null
          check_in_time: string
          check_out_time: string
          cleaner_pay: number | null
          cleaning_frequency: string | null
          contact_id: string | null
          created_at: string | null
          deep_clean_3x_ce: number | null
          deleted_at: string | null
          door_code: string | null
          est_consumables: number | null
          est_laundry: number | null
          estimated_deep_clean_cost: number | null
          estimated_profit: number | null
          exclude_from_financials: boolean | null
          exempt_from_inspections: boolean
          filter_size: string | null
          first_clean_date: string | null
          follow_up_date: string | null
          full_baths: number | null
          full_beds: number | null
          guest_count: number | null
          half_baths: number | null
          hand_towels: number | null
          has_auto_code: boolean
          hot_tub: boolean | null
          id: number
          inspection_cost: number | null
          king_beds: number | null
          kitchens: number | null
          last_filter_changed: string | null
          linen_notes: string | null
          linen_program: boolean
          linen_program_cost: number
          monthly_cost_estimate: number | null
          monthly_profit_estimate: number | null
          monthly_revenue_estimate: number | null
          name: string
          next_filter_due: string | null
          notes: string | null
          number_of_beds: number | null
          offboarded_at: string | null
          offboarding_date: string | null
          onboarding_date: string | null
          other_codes: string | null
          owner_contact_email: string | null
          owner_contact_name: string | null
          owner_contact_phone: string | null
          pet_friendly: string | null
          pool_towels: number | null
          preferred_payment_method: string | null
          price_per_sq_foot: number | null
          profit_deep_clean: number | null
          profit_percentage: number | null
          queen_beds: number | null
          quote_owner_response: string | null
          quote_responded_at: string | null
          quote_sent_at: string | null
          square_footage: number | null
          stage_id: number | null
          suggested_pay: number | null
          target_par_sets: number | null
          total_estimated_cost: number | null
          trash_cost: number | null
          trellis_id: string | null
          twin_beds: number | null
          updated_at: string | null
          washcloths: number | null
          wifi_info: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          auto_code?: string | null
          avg_cleans_per_month?: number | null
          bath_towels?: number | null
          bathmats?: number | null
          bed_sizes_text?: string | null
          bedrooms?: number | null
          breezeway_id?: string | null
          breezeway_name?: string | null
          ce_charged?: number | null
          ce_per_sq?: number | null
          check_in_time?: string
          check_out_time?: string
          cleaner_pay?: number | null
          cleaning_frequency?: string | null
          contact_id?: string | null
          created_at?: string | null
          deep_clean_3x_ce?: number | null
          deleted_at?: string | null
          door_code?: string | null
          est_consumables?: number | null
          est_laundry?: number | null
          estimated_deep_clean_cost?: number | null
          estimated_profit?: number | null
          exclude_from_financials?: boolean | null
          exempt_from_inspections?: boolean
          filter_size?: string | null
          first_clean_date?: string | null
          follow_up_date?: string | null
          full_baths?: number | null
          full_beds?: number | null
          guest_count?: number | null
          half_baths?: number | null
          hand_towels?: number | null
          has_auto_code?: boolean
          hot_tub?: boolean | null
          id?: number
          inspection_cost?: number | null
          king_beds?: number | null
          kitchens?: number | null
          last_filter_changed?: string | null
          linen_notes?: string | null
          linen_program?: boolean
          linen_program_cost?: number
          monthly_cost_estimate?: number | null
          monthly_profit_estimate?: number | null
          monthly_revenue_estimate?: number | null
          name: string
          next_filter_due?: string | null
          notes?: string | null
          number_of_beds?: number | null
          offboarded_at?: string | null
          offboarding_date?: string | null
          onboarding_date?: string | null
          other_codes?: string | null
          owner_contact_email?: string | null
          owner_contact_name?: string | null
          owner_contact_phone?: string | null
          pet_friendly?: string | null
          pool_towels?: number | null
          preferred_payment_method?: string | null
          price_per_sq_foot?: number | null
          profit_deep_clean?: number | null
          profit_percentage?: number | null
          queen_beds?: number | null
          quote_owner_response?: string | null
          quote_responded_at?: string | null
          quote_sent_at?: string | null
          square_footage?: number | null
          stage_id?: number | null
          suggested_pay?: number | null
          target_par_sets?: number | null
          total_estimated_cost?: number | null
          trash_cost?: number | null
          trellis_id?: string | null
          twin_beds?: number | null
          updated_at?: string | null
          washcloths?: number | null
          wifi_info?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          auto_code?: string | null
          avg_cleans_per_month?: number | null
          bath_towels?: number | null
          bathmats?: number | null
          bed_sizes_text?: string | null
          bedrooms?: number | null
          breezeway_id?: string | null
          breezeway_name?: string | null
          ce_charged?: number | null
          ce_per_sq?: number | null
          check_in_time?: string
          check_out_time?: string
          cleaner_pay?: number | null
          cleaning_frequency?: string | null
          contact_id?: string | null
          created_at?: string | null
          deep_clean_3x_ce?: number | null
          deleted_at?: string | null
          door_code?: string | null
          est_consumables?: number | null
          est_laundry?: number | null
          estimated_deep_clean_cost?: number | null
          estimated_profit?: number | null
          exclude_from_financials?: boolean | null
          exempt_from_inspections?: boolean
          filter_size?: string | null
          first_clean_date?: string | null
          follow_up_date?: string | null
          full_baths?: number | null
          full_beds?: number | null
          guest_count?: number | null
          half_baths?: number | null
          hand_towels?: number | null
          has_auto_code?: boolean
          hot_tub?: boolean | null
          id?: number
          inspection_cost?: number | null
          king_beds?: number | null
          kitchens?: number | null
          last_filter_changed?: string | null
          linen_notes?: string | null
          linen_program?: boolean
          linen_program_cost?: number
          monthly_cost_estimate?: number | null
          monthly_profit_estimate?: number | null
          monthly_revenue_estimate?: number | null
          name?: string
          next_filter_due?: string | null
          notes?: string | null
          number_of_beds?: number | null
          offboarded_at?: string | null
          offboarding_date?: string | null
          onboarding_date?: string | null
          other_codes?: string | null
          owner_contact_email?: string | null
          owner_contact_name?: string | null
          owner_contact_phone?: string | null
          pet_friendly?: string | null
          pool_towels?: number | null
          preferred_payment_method?: string | null
          price_per_sq_foot?: number | null
          profit_deep_clean?: number | null
          profit_percentage?: number | null
          queen_beds?: number | null
          quote_owner_response?: string | null
          quote_responded_at?: string | null
          quote_sent_at?: string | null
          square_footage?: number | null
          stage_id?: number | null
          suggested_pay?: number | null
          target_par_sets?: number | null
          total_estimated_cost?: number | null
          trash_cost?: number | null
          trellis_id?: string | null
          twin_beds?: number | null
          updated_at?: string | null
          washcloths?: number | null
          wifi_info?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      property_edit_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          property_id: number
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          property_id: number
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          property_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_edit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      property_notes: {
        Row: {
          content: string
          context: string | null
          created_at: string | null
          created_by: string | null
          created_by_user_id: number | null
          id: string
          property_id: number | null
        }
        Insert: {
          content: string
          context?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_user_id?: number | null
          id?: string
          property_id?: number | null
        }
        Update: {
          content?: string
          context?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_user_id?: number | null
          id?: string
          property_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      property_owners: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          name: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          name?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      property_photos: {
        Row: {
          created_at: string | null
          id: string
          photo_url: string
          property_id: number | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          photo_url: string
          property_id?: number | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          photo_url?: string
          property_id?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_photos_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      property_supplies: {
        Row: {
          current_qty: number | null
          id: string
          item_name: string
          last_restocked: string | null
          par_level: number | null
          property_id: number | null
        }
        Insert: {
          current_qty?: number | null
          id?: string
          item_name: string
          last_restocked?: string | null
          par_level?: number | null
          property_id?: number | null
        }
        Update: {
          current_qty?: number | null
          id?: string
          item_name?: string
          last_restocked?: string | null
          par_level?: number | null
          property_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_supplies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      property_verifications: {
        Row: {
          assignee_name: string | null
          due_date: string | null
          fields_updated: Json | null
          id: string
          notes: string | null
          property_id: number
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          assignee_name?: string | null
          due_date?: string | null
          fields_updated?: Json | null
          id?: string
          notes?: string | null
          property_id: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          assignee_name?: string | null
          due_date?: string | null
          fields_updated?: Json | null
          id?: string
          notes?: string | null
          property_id?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_verifications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
        ]
      }
      recurring_task_templates: {
        Row: {
          assignee_name: string | null
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          enabled: boolean | null
          id: string
          next_run: string | null
          priority: string | null
          recurrence: string
          title: string
        }
        Insert: {
          assignee_name?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          next_run?: string | null
          priority?: string | null
          recurrence?: string
          title: string
        }
        Update: {
          assignee_name?: string | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          next_run?: string | null
          priority?: string | null
          recurrence?: string
          title?: string
        }
        Relationships: []
      }
      stage_transitions: {
        Row: {
          created_at: string | null
          from_stage_id: number | null
          id: number
          missing_fields: string[] | null
          notes: string | null
          property_id: number | null
          to_stage_id: number | null
          transitioned_by: string | null
        }
        Insert: {
          created_at?: string | null
          from_stage_id?: number | null
          id?: number
          missing_fields?: string[] | null
          notes?: string | null
          property_id?: number | null
          to_stage_id?: number | null
          transitioned_by?: string | null
        }
        Update: {
          created_at?: string | null
          from_stage_id?: number | null
          id?: number
          missing_fields?: string[] | null
          notes?: string | null
          property_id?: number | null
          to_stage_id?: number | null
          transitioned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_transitions_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_transitions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
          {
            foreignKeyName: "stage_transitions_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_workflow_templates: {
        Row: {
          checklist_items: Json | null
          created_at: string | null
          default_assignee_name: string | null
          description: string | null
          due_offset_days: number | null
          enabled: boolean | null
          from_stage: string | null
          id: string
          sort_order: number | null
          title: string
          to_stage: string
          updated_at: string | null
        }
        Insert: {
          checklist_items?: Json | null
          created_at?: string | null
          default_assignee_name?: string | null
          description?: string | null
          due_offset_days?: number | null
          enabled?: boolean | null
          from_stage?: string | null
          id?: string
          sort_order?: number | null
          title: string
          to_stage: string
          updated_at?: string | null
        }
        Update: {
          checklist_items?: Json | null
          created_at?: string | null
          default_assignee_name?: string | null
          description?: string | null
          due_offset_days?: number | null
          enabled?: boolean | null
          from_stage?: string | null
          id?: string
          sort_order?: number | null
          title?: string
          to_stage?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      task_assignees: {
        Row: {
          added_at: string
          id: string
          role: string
          sort_order: number
          task_id: string
          user_id: number
        }
        Insert: {
          added_at?: string
          id?: string
          role?: string
          sort_order?: number
          task_id: string
          user_id: number
        }
        Update: {
          added_at?: string
          id?: string
          role?: string
          sort_order?: number
          task_id?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees_backup_20260609: {
        Row: {
          added_at: string | null
          id: string | null
          role: string | null
          sort_order: number | null
          task_id: string | null
          user_id: number | null
        }
        Insert: {
          added_at?: string | null
          id?: string | null
          role?: string | null
          sort_order?: number | null
          task_id?: string | null
          user_id?: number | null
        }
        Update: {
          added_at?: string | null
          id?: string | null
          role?: string | null
          sort_order?: number | null
          task_id?: string | null
          user_id?: number | null
        }
        Relationships: []
      }
      task_comments: {
        Row: {
          author: string | null
          content: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author?: string | null
          content: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author?: string | null
          content?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments_backup_20260609: {
        Row: {
          author: string | null
          content: string | null
          created_at: string | null
          id: string | null
          task_id: string | null
        }
        Insert: {
          author?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          task_id?: string | null
        }
        Update: {
          author?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      task_list_members: {
        Row: {
          added_at: string
          added_by: number | null
          color: string | null
          id: string
          list_id: string
          role: string
          user_id: number
        }
        Insert: {
          added_at?: string
          added_by?: number | null
          color?: string | null
          id?: string
          list_id: string
          role?: string
          user_id: number
        }
        Update: {
          added_at?: string
          added_by?: number | null
          color?: string | null
          id?: string
          list_id?: string
          role?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_list_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_list_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_lists: {
        Row: {
          created_at: string
          created_by: number | null
          id: string
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: number | null
          id?: string
          name: string
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: number | null
          id?: string
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          added_at: string
          id: string
          task_id: string
          user_id: number
        }
        Insert: {
          added_at?: string
          id?: string
          task_id: string
          user_id: number
        }
        Update: {
          added_at?: string
          id?: string
          task_id?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          category: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          list_id: string | null
          parent_task_id: string | null
          priority: string
          property_id: number | null
          property_name: string | null
          status: string
          title: string
          updated_at: string
          verification_property_id: number | null
          workflow_template_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          list_id?: string | null
          parent_task_id?: string | null
          priority?: string
          property_id?: number | null
          property_name?: string | null
          status?: string
          title: string
          updated_at?: string
          verification_property_id?: number | null
          workflow_template_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          list_id?: string | null
          parent_task_id?: string | null
          priority?: string
          property_id?: number | null
          property_name?: string | null
          status?: string
          title?: string
          updated_at?: string
          verification_property_id?: number | null
          workflow_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "task_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "operational_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "pipeline_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "property_breezeway_stats"
            referencedColumns: ["property_id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "property_proforma"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_verification_property_id_fkey"
            columns: ["verification_property_id"]
            isOneToOne: false
            referencedRelation: "trellis_reconciliation"
            referencedColumns: ["ops_property_id"]
          },
          {
            foreignKeyName: "tasks_workflow_template_id_fkey"
            columns: ["workflow_template_id"]
            isOneToOne: false
            referencedRelation: "stage_workflow_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_backup_20260609: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          category: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string | null
          list_id: string | null
          parent_task_id: string | null
          priority: string | null
          property_id: number | null
          property_name: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          verification_property_id: number | null
          workflow_template_id: string | null
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string | null
          list_id?: string | null
          parent_task_id?: string | null
          priority?: string | null
          property_id?: number | null
          property_name?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          verification_property_id?: number | null
          workflow_template_id?: string | null
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string | null
          list_id?: string | null
          parent_task_id?: string | null
          priority?: string | null
          property_id?: number | null
          property_name?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          verification_property_id?: number | null
          workflow_template_id?: string | null
        }
        Relationships: []
      }
      trellis_property_snapshot: {
        Row: {
          city: string | null
          name: string
          status: string | null
          synced_at: string
          trellis_id: string
          workspace: string
        }
        Insert: {
          city?: string | null
          name: string
          status?: string | null
          synced_at?: string
          trellis_id: string
          workspace: string
        }
        Update: {
          city?: string | null
          name?: string
          status?: string | null
          synced_at?: string
          trellis_id?: string
          workspace?: string
        }
        Relationships: []
      }
      trellis_reconciliation_dismissals: {
        Row: {
          created_at: string
          dismissed_by: string | null
          id: string
          kind: string
          ops_property_id: number | null
          trellis_property_id: string | null
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          id?: string
          kind: string
          ops_property_id?: number | null
          trellis_property_id?: string | null
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          id?: string
          kind?: string
          ops_property_id?: number | null
          trellis_property_id?: string | null
        }
        Relationships: []
      }
      trellis_roster: {
        Row: {
          departments: string[]
          email: string | null
          is_active: boolean
          member_id: string | null
          name: string | null
          role: string | null
          synced_at: string
          user_id: string
          workspace: string
        }
        Insert: {
          departments?: string[]
          email?: string | null
          is_active?: boolean
          member_id?: string | null
          name?: string | null
          role?: string | null
          synced_at?: string
          user_id: string
          workspace?: string
        }
        Update: {
          departments?: string[]
          email?: string | null
          is_active?: boolean
          member_id?: string | null
          name?: string | null
          role?: string | null
          synced_at?: string
          user_id?: string
          workspace?: string
        }
        Relationships: []
      }
      trellis_sync_log: {
        Row: {
          counts: Json | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          progress: Json | null
          requested_by: string | null
          started_at: string | null
          status: string
          trigger: string
        }
        Insert: {
          counts?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: Json | null
          requested_by?: string | null
          started_at?: string | null
          status: string
          trigger?: string
        }
        Update: {
          counts?: Json | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: Json | null
          requested_by?: string | null
          started_at?: string | null
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      trellis_task_snapshot: {
        Row: {
          assigned_to_id: string | null
          assigned_to_name: string | null
          completed_at: string | null
          department_name: string | null
          priority: string | null
          property_name: string | null
          scheduled_date: string | null
          status: string | null
          synced_at: string
          title: string | null
          trellis_property_id: string | null
          trellis_task_id: string
          workspace: string
        }
        Insert: {
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          department_name?: string | null
          priority?: string | null
          property_name?: string | null
          scheduled_date?: string | null
          status?: string | null
          synced_at?: string
          title?: string | null
          trellis_property_id?: string | null
          trellis_task_id: string
          workspace: string
        }
        Update: {
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          department_name?: string | null
          priority?: string | null
          property_name?: string | null
          scheduled_date?: string | null
          status?: string | null
          synced_at?: string
          title?: string | null
          trellis_property_id?: string | null
          trellis_task_id?: string
          workspace?: string
        }
        Relationships: []
      }
      van_build_questionnaire: {
        Row: {
          annual_miles: string | null
          chassis_preference: string | null
          created_at: string
          email: string | null
          height_inches: number | null
          id: string
          must_haves: Json | null
          name: string | null
          notes: string | null
          offgrid_duration: string | null
          primary_use: string | null
          priorities: Json | null
          standing_room: string | null
        }
        Insert: {
          annual_miles?: string | null
          chassis_preference?: string | null
          created_at?: string
          email?: string | null
          height_inches?: number | null
          id?: string
          must_haves?: Json | null
          name?: string | null
          notes?: string | null
          offgrid_duration?: string | null
          primary_use?: string | null
          priorities?: Json | null
          standing_room?: string | null
        }
        Update: {
          annual_miles?: string | null
          chassis_preference?: string | null
          created_at?: string
          email?: string | null
          height_inches?: number | null
          id?: string
          must_haves?: Json | null
          name?: string | null
          notes?: string | null
          offgrid_duration?: string | null
          primary_use?: string | null
          priorities?: Json | null
          standing_room?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      linen_inventory_latest: {
        Row: {
          bath_towels: number | null
          bathmats: number | null
          counted_at: string | null
          counted_by: string | null
          created_at: string | null
          full_fitted_extras: number | null
          full_flat_extras: number | null
          full_pillowcase_extras: number | null
          full_rolls: number | null
          full_top_sheets: number | null
          hand_towels: number | null
          id: string | null
          king_fitted_extras: number | null
          king_flat_extras: number | null
          king_pillowcase_extras: number | null
          king_rolls: number | null
          king_top_sheets: number | null
          notes: string | null
          pool_towels: number | null
          queen_fitted_extras: number | null
          queen_flat_extras: number | null
          queen_pillowcase_extras: number | null
          queen_rolls: number | null
          queen_top_sheets: number | null
          twin_fitted_extras: number | null
          twin_flat_extras: number | null
          twin_pillowcase_extras: number | null
          twin_rolls: number | null
          twin_top_sheets: number | null
          washcloths: number | null
        }
        Relationships: []
      }
      operational_properties: {
        Row: {
          address: string | null
          auto_code: string | null
          avg_cleans_per_month: number | null
          bath_towels: number | null
          bathmats: number | null
          bed_sizes_text: string | null
          bedrooms: number | null
          breezeway_id: string | null
          breezeway_name: string | null
          ce_charged: number | null
          ce_per_sq: number | null
          cleaner_pay: number | null
          cleaning_frequency: string | null
          created_at: string | null
          deep_clean_3x_ce: number | null
          door_code: string | null
          est_consumables: number | null
          est_laundry: number | null
          estimated_deep_clean_cost: number | null
          estimated_profit: number | null
          filter_size: string | null
          first_clean_date: string | null
          full_baths: number | null
          full_beds: number | null
          guest_count: number | null
          half_baths: number | null
          hand_towels: number | null
          has_auto_code: boolean | null
          hot_tub: boolean | null
          id: number | null
          inspection_cost: number | null
          king_beds: number | null
          kitchens: number | null
          last_filter_changed: string | null
          linen_notes: string | null
          linen_program: boolean | null
          linen_program_cost: number | null
          monthly_cost_estimate: number | null
          monthly_profit_estimate: number | null
          monthly_revenue_estimate: number | null
          name: string | null
          next_filter_due: string | null
          notes: string | null
          number_of_beds: number | null
          offboarding_date: string | null
          onboarding_date: string | null
          other_codes: string | null
          pet_friendly: string | null
          pool_towels: number | null
          price_per_sq_foot: number | null
          profit_deep_clean: number | null
          profit_percentage: number | null
          queen_beds: number | null
          square_footage: number | null
          stage_color: string | null
          stage_id: number | null
          stage_name: string | null
          stage_slug: string | null
          suggested_pay: number | null
          total_estimated_cost: number | null
          trash_cost: number | null
          twin_beds: number | null
          updated_at: string | null
          washcloths: number | null
          wifi_info: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_view: {
        Row: {
          address: string | null
          auto_code: string | null
          avg_cleans_per_month: number | null
          bath_towels: number | null
          bathmats: number | null
          bed_sizes_text: string | null
          bedrooms: number | null
          breezeway_id: string | null
          breezeway_name: string | null
          ce_charged: number | null
          ce_per_sq: number | null
          cleaner_pay: number | null
          cleaning_frequency: string | null
          created_at: string | null
          deep_clean_3x_ce: number | null
          door_code: string | null
          est_consumables: number | null
          est_laundry: number | null
          estimated_deep_clean_cost: number | null
          estimated_profit: number | null
          filter_size: string | null
          first_clean_date: string | null
          full_baths: number | null
          full_beds: number | null
          guest_count: number | null
          half_baths: number | null
          hand_towels: number | null
          hot_tub: boolean | null
          id: number | null
          inspection_cost: number | null
          king_beds: number | null
          kitchens: number | null
          last_filter_changed: string | null
          linen_notes: string | null
          monthly_cost_estimate: number | null
          monthly_profit_estimate: number | null
          monthly_revenue_estimate: number | null
          name: string | null
          next_filter_due: string | null
          notes: string | null
          number_of_beds: number | null
          offboarding_date: string | null
          onboarding_date: string | null
          other_codes: string | null
          pet_friendly: string | null
          pool_towels: number | null
          price_per_sq_foot: number | null
          profit_deep_clean: number | null
          profit_percentage: number | null
          queen_beds: number | null
          requires_fields: string[] | null
          square_footage: number | null
          stage_color: string | null
          stage_id: number | null
          stage_name: string | null
          stage_order: number | null
          stage_slug: string | null
          suggested_pay: number | null
          total_estimated_cost: number | null
          trash_cost: number | null
          twin_beds: number | null
          updated_at: string | null
          washcloths: number | null
          wifi_info: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      property_breezeway_stats: {
        Row: {
          avg_cleans_per_month: number | null
          avg_deep_cleans_per_month: number | null
          earliest_task: string | null
          latest_task: string | null
          months_with_data: number | null
          property_id: number | null
          total_cleans: number | null
          total_deep_cleans: number | null
        }
        Relationships: []
      }
      property_proforma: {
        Row: {
          avg_cleans_per_month: number | null
          ce_charged: number | null
          cleaning_frequency: string | null
          estimated_profit: number | null
          first_clean_date: string | null
          id: number | null
          last_clean_date: string | null
          monthly_cost_estimate: number | null
          monthly_profit_estimate: number | null
          monthly_revenue_estimate: number | null
          name: string | null
          profit_percentage: number | null
          stage_name: string | null
          total_cleans: number | null
          total_estimated_cost: number | null
        }
        Relationships: []
      }
      trellis_exceptions: {
        Row: {
          name: string | null
          status: string | null
          tendwell_task_count: number | null
          trellis_id: string | null
          workspace: string | null
        }
        Relationships: []
      }
      trellis_property_enriched: {
        Row: {
          city: string | null
          is_tendwell_property: boolean | null
          name: string | null
          status: string | null
          synced_at: string | null
          tendwell_task_count: number | null
          trellis_id: string | null
          workspace: string | null
        }
        Relationships: []
      }
      trellis_reconciliation: {
        Row: {
          is_tendwell_property: boolean | null
          linked_trellis_id: string | null
          linked_trellis_name: string | null
          linked_workspace: string | null
          match_status: string | null
          ops_name: string | null
          ops_property_id: number | null
          suggested_trellis_id: string | null
          suggested_trellis_name: string | null
          suggested_workspace: string | null
          tendwell_task_count: number | null
        }
        Relationships: []
      }
      trellis_task_attributed: {
        Row: {
          assigned_to_id: string | null
          assigned_to_name: string | null
          completed_at: string | null
          department_name: string | null
          is_tendwell: boolean | null
          priority: string | null
          property_name: string | null
          scheduled_date: string | null
          status: string | null
          synced_at: string | null
          title: string | null
          trellis_property_id: string | null
          trellis_task_id: string | null
          workspace: string | null
        }
        Insert: {
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          department_name?: string | null
          is_tendwell?: never
          priority?: string | null
          property_name?: string | null
          scheduled_date?: string | null
          status?: string | null
          synced_at?: string | null
          title?: string | null
          trellis_property_id?: string | null
          trellis_task_id?: string | null
          workspace?: string | null
        }
        Update: {
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          department_name?: string | null
          is_tendwell?: never
          priority?: string | null
          property_name?: string | null
          scheduled_date?: string | null
          status?: string | null
          synced_at?: string | null
          title?: string | null
          trellis_property_id?: string | null
          trellis_task_id?: string | null
          workspace?: string | null
        }
        Relationships: []
      }
      financial_monthly_cleans: {
        Row: {
          month: string | null
          cleans: number | null
        }
        Relationships: []
      }
      financial_task_load: {
        Row: {
          bucket: string | null
          tasks: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_cleaner_app_user: {
        Args: { p_email: string; p_name: string; p_role: string }
        Returns: undefined
      }
      admin_hard_delete_property: { Args: { p_id: number }; Returns: undefined }
      admin_list_deleted_properties: {
        Args: never
        Returns: {
          address: string | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          auto_code: string | null
          avg_cleans_per_month: number | null
          bath_towels: number | null
          bathmats: number | null
          bed_sizes_text: string | null
          bedrooms: number | null
          breezeway_id: string | null
          breezeway_name: string | null
          ce_charged: number | null
          ce_per_sq: number | null
          check_in_time: string
          check_out_time: string
          cleaner_pay: number | null
          cleaning_frequency: string | null
          contact_id: string | null
          created_at: string | null
          deep_clean_3x_ce: number | null
          deleted_at: string | null
          door_code: string | null
          est_consumables: number | null
          est_laundry: number | null
          estimated_deep_clean_cost: number | null
          estimated_profit: number | null
          exclude_from_financials: boolean | null
          exempt_from_inspections: boolean
          filter_size: string | null
          first_clean_date: string | null
          follow_up_date: string | null
          full_baths: number | null
          full_beds: number | null
          guest_count: number | null
          half_baths: number | null
          hand_towels: number | null
          has_auto_code: boolean
          hot_tub: boolean | null
          id: number
          inspection_cost: number | null
          king_beds: number | null
          kitchens: number | null
          last_filter_changed: string | null
          linen_notes: string | null
          linen_program: boolean
          linen_program_cost: number
          monthly_cost_estimate: number | null
          monthly_profit_estimate: number | null
          monthly_revenue_estimate: number | null
          name: string
          next_filter_due: string | null
          notes: string | null
          number_of_beds: number | null
          offboarded_at: string | null
          offboarding_date: string | null
          onboarding_date: string | null
          other_codes: string | null
          owner_contact_email: string | null
          owner_contact_name: string | null
          owner_contact_phone: string | null
          pet_friendly: string | null
          pool_towels: number | null
          preferred_payment_method: string | null
          price_per_sq_foot: number | null
          profit_deep_clean: number | null
          profit_percentage: number | null
          queen_beds: number | null
          quote_owner_response: string | null
          quote_responded_at: string | null
          quote_sent_at: string | null
          square_footage: number | null
          stage_id: number | null
          suggested_pay: number | null
          target_par_sets: number | null
          total_estimated_cost: number | null
          trash_cost: number | null
          trellis_id: string | null
          twin_beds: number | null
          updated_at: string | null
          washcloths: number | null
          wifi_info: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "properties"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_restore_property: { Args: { p_id: number }; Returns: undefined }
      archive_stale_quotes: { Args: { max_age_days?: number }; Returns: number }
      compute_monthly_estimate: {
        Args: { target_month: string }
        Returns: {
          active_properties: number
          cleans_count: number
          deep_cleans_count: number
          est_cogs: number
          est_opex: number
          est_profit: number
          est_revenue: number
          per_property: Json
        }[]
      }
      current_auth_email: { Args: never; Returns: string }
      current_owner_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      get_laundry_weigh_in_names: { Args: never; Returns: string[] }
      get_owner_properties: { Args: never; Returns: Json[] }
      get_owner_property_tasks: {
        Args: { p_property_id: number }
        Returns: {
          source: string
          status: string
          task_date: string
          title: string
        }[]
      }
      get_owner_quotes: {
        Args: never
        Returns: {
          bedrooms: number
          ce_charged: number
          deep_clean_3x_ce: number
          estimated_deep_clean_cost: number
          full_baths: number
          half_baths: number
          id: number
          linen_program: boolean
          linen_program_cost: number
          name: string
          number_of_beds: number
          quote_owner_response: string
          quote_responded_at: string
          quote_sent_at: string
        }[]
      }
      get_owner_shipments: {
        Args: never
        Returns: {
          delivery_responsible: string
          description: string
          estimated_delivery: string
          id: string
          property_name: string
          received_at: string
          sender_name: string
          submitted_at: string
          tracking_number: string
        }[]
      }
      get_property_names_for_weigh_in: { Args: never; Returns: string[] }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      owner_field_permissions_default: { Args: never; Returns: Json }
      owner_owns_property: { Args: { p_property_id: number }; Returns: boolean }
      owner_property_perms: {
        Args: { p_owner_id: string; p_property_id: number }
        Returns: Json
      }
      owner_respond_to_quote: {
        Args: { p_property_id: number; p_response: string }
        Returns: undefined
      }
      portal_is_admin: { Args: never; Returns: boolean }
      purge_deleted_properties: {
        Args: { retention_days?: number }
        Returns: {
          purged_id: number
          purged_name: string
        }[]
      }
      purge_old_laundry_photos: {
        Args: { retention_days?: number }
        Returns: {
          storage_path: string
        }[]
      }
      reconcile_monthly_snapshot: {
        Args: { target_month: string }
        Returns: {
          actual_cogs: number | null
          actual_opex: number | null
          actual_profit: number | null
          actual_revenue: number | null
          actual_source: string | null
          estimate_active_properties: number
          estimate_cleans_count: number
          estimate_cogs: number
          estimate_deep_cleans_count: number
          estimate_opex: number
          estimate_per_property: Json
          estimate_profit: number
          estimate_revenue: number
          first_captured_at: string
          last_reconciled_at: string
          month: string
          notes: string | null
          variance_cogs: number | null
          variance_opex: number | null
          variance_profit: number | null
          variance_revenue: number | null
        }
        SetofOptions: {
          from: "*"
          to: "monthly_financial_snapshot"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_recent_snapshots: {
        Args: { months_back?: number }
        Returns: {
          actual_source: string
          has_actual: boolean
          has_estimate: boolean
          month: string
        }[]
      }
      tendwell_normalize_name: { Args: { p: string }; Returns: string }
    }
    Enums: {
      portal_booking_calendar_kind: "ical" | "api" | "none"
      portal_email_delivery: "sent" | "logged" | "error"
      portal_email_event_type:
        | "quote_created"
        | "quote_approved"
        | "onboarding_submitted"
        | "feature_suggestion_received"
        | "referral_received"
        | "shipment_updated"
        | "testimonial_submitted"
      portal_feedback_kind: "praise" | "issue" | "question" | "other"
      portal_onboarding_status:
        | "not_started"
        | "in_progress"
        | "submitted"
        | "complete"
      portal_property_status: "onboarding" | "active" | "paused"
      portal_quote_status: "draft" | "sent" | "approved" | "declined"
      portal_referral_status: "pending" | "qualified" | "rewarded" | "closed"
      portal_role: "owner" | "admin"
      portal_shipment_status:
        | "preparing"
        | "shipped"
        | "in_transit"
        | "delivered"
        | "delayed"
      portal_suggestion_status: "new" | "planned" | "shipped" | "declined"
      portal_testimonial_status:
        | "submitted"
        | "reviewed"
        | "approved"
        | "published"
        | "archived"
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
      portal_booking_calendar_kind: ["ical", "api", "none"],
      portal_email_delivery: ["sent", "logged", "error"],
      portal_email_event_type: [
        "quote_created",
        "quote_approved",
        "onboarding_submitted",
        "feature_suggestion_received",
        "referral_received",
        "shipment_updated",
        "testimonial_submitted",
      ],
      portal_feedback_kind: ["praise", "issue", "question", "other"],
      portal_onboarding_status: [
        "not_started",
        "in_progress",
        "submitted",
        "complete",
      ],
      portal_property_status: ["onboarding", "active", "paused"],
      portal_quote_status: ["draft", "sent", "approved", "declined"],
      portal_referral_status: ["pending", "qualified", "rewarded", "closed"],
      portal_role: ["owner", "admin"],
      portal_shipment_status: [
        "preparing",
        "shipped",
        "in_transit",
        "delivered",
        "delayed",
      ],
      portal_suggestion_status: ["new", "planned", "shipped", "declined"],
      portal_testimonial_status: [
        "submitted",
        "reviewed",
        "approved",
        "published",
        "archived",
      ],
    },
  },
} as const
