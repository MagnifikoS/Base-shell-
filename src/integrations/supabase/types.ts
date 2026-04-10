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
      app_invoice_lines: {
        Row: {
          app_invoice_id: string
          billed_quantity: number | null
          billed_unit_id: string | null
          billed_unit_label: string | null
          billed_unit_price: number | null
          canonical_unit_id: string
          commande_line_id: string
          created_at: string
          id: string
          line_total: number
          product_id: string
          product_name_snapshot: string
          quantity: number
          unit_label_snapshot: string | null
          unit_price: number
        }
        Insert: {
          app_invoice_id: string
          billed_quantity?: number | null
          billed_unit_id?: string | null
          billed_unit_label?: string | null
          billed_unit_price?: number | null
          canonical_unit_id: string
          commande_line_id: string
          created_at?: string
          id?: string
          line_total: number
          product_id: string
          product_name_snapshot: string
          quantity: number
          unit_label_snapshot?: string | null
          unit_price: number
        }
        Update: {
          app_invoice_id?: string
          billed_quantity?: number | null
          billed_unit_id?: string | null
          billed_unit_label?: string | null
          billed_unit_price?: number | null
          canonical_unit_id?: string
          commande_line_id?: string
          created_at?: string
          id?: string
          line_total?: number
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          unit_label_snapshot?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_invoice_lines_app_invoice_id_fkey"
            columns: ["app_invoice_id"]
            isOneToOne: false
            referencedRelation: "app_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_invoice_lines_billed_unit_id_fkey"
            columns: ["billed_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_invoice_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_invoice_lines_commande_line_id_fkey"
            columns: ["commande_line_id"]
            isOneToOne: false
            referencedRelation: "commande_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      app_invoices: {
        Row: {
          client_address_snapshot: string | null
          client_establishment_id: string
          client_name_snapshot: string
          client_siret_snapshot: string | null
          commande_date_snapshot: string | null
          commande_id: string
          created_at: string
          created_by: string
          id: string
          invoice_date: string
          invoice_number: string
          order_number_snapshot: string
          status: string
          supplier_address_snapshot: string | null
          supplier_establishment_id: string
          supplier_logo_url_snapshot: string | null
          supplier_name_snapshot: string
          supplier_siret_snapshot: string | null
          total_ht: number
          total_ttc: number | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          client_address_snapshot?: string | null
          client_establishment_id: string
          client_name_snapshot: string
          client_siret_snapshot?: string | null
          commande_date_snapshot?: string | null
          commande_id: string
          created_at?: string
          created_by: string
          id?: string
          invoice_date?: string
          invoice_number: string
          order_number_snapshot: string
          status?: string
          supplier_address_snapshot?: string | null
          supplier_establishment_id: string
          supplier_logo_url_snapshot?: string | null
          supplier_name_snapshot: string
          supplier_siret_snapshot?: string | null
          total_ht?: number
          total_ttc?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          client_address_snapshot?: string | null
          client_establishment_id?: string
          client_name_snapshot?: string
          client_siret_snapshot?: string | null
          commande_date_snapshot?: string | null
          commande_id?: string
          created_at?: string
          created_by?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          order_number_snapshot?: string
          status?: string
          supplier_address_snapshot?: string | null
          supplier_establishment_id?: string
          supplier_logo_url_snapshot?: string | null
          supplier_name_snapshot?: string
          supplier_siret_snapshot?: string | null
          total_ht?: number
          total_ttc?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_invoices_client_establishment_id_fkey"
            columns: ["client_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_invoices_commande_id_fkey"
            columns: ["commande_id"]
            isOneToOne: true
            referencedRelation: "commandes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_invoices_supplier_establishment_id_fkey"
            columns: ["supplier_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          organization_id: string
          target_id: string | null
          target_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          organization_id: string
          target_id?: string | null
          target_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          target_id?: string | null
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_followed_recipes: {
        Row: {
          establishment_id: string
          followed_at: string
          followed_by: string | null
          id: string
          listing_id: string
          partnership_id: string
        }
        Insert: {
          establishment_id: string
          followed_at?: string
          followed_by?: string | null
          id?: string
          listing_id: string
          partnership_id: string
        }
        Update: {
          establishment_id?: string
          followed_at?: string
          followed_by?: string | null
          id?: string
          listing_id?: string
          partnership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_followed_recipes_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_followed_recipes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "b2b_recipe_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_followed_recipes_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "b2b_partnerships"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_imported_products: {
        Row: {
          establishment_id: string
          id: string
          imported_at: string
          imported_by: string
          local_product_id: string
          source_establishment_id: string
          source_product_id: string
          unit_mapping: Json | null
        }
        Insert: {
          establishment_id: string
          id?: string
          imported_at?: string
          imported_by: string
          local_product_id: string
          source_establishment_id: string
          source_product_id: string
          unit_mapping?: Json | null
        }
        Update: {
          establishment_id?: string
          id?: string
          imported_at?: string
          imported_by?: string
          local_product_id?: string
          source_establishment_id?: string
          source_product_id?: string
          unit_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_imported_products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_imported_products_local_product_id_fkey"
            columns: ["local_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_imported_products_source_establishment_id_fkey"
            columns: ["source_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_invitation_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          partnership_id: string | null
          supplier_establishment_id: string
          used_at: string | null
          used_by_establishment_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          partnership_id?: string | null
          supplier_establishment_id: string
          used_at?: string | null
          used_by_establishment_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          partnership_id?: string | null
          supplier_establishment_id?: string
          used_at?: string | null
          used_by_establishment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_invitation_codes_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "b2b_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_invitation_codes_supplier_establishment_id_fkey"
            columns: ["supplier_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_invitation_codes_used_by_establishment_id_fkey"
            columns: ["used_by_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_partnerships: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          client_establishment_id: string
          created_at: string
          id: string
          share_stock: boolean
          status: string
          supplier_establishment_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          client_establishment_id: string
          created_at?: string
          id?: string
          share_stock?: boolean
          status?: string
          supplier_establishment_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          client_establishment_id?: string
          created_at?: string
          id?: string
          share_stock?: boolean
          status?: string
          supplier_establishment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_partnerships_client_establishment_id_fkey"
            columns: ["client_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_partnerships_supplier_establishment_id_fkey"
            columns: ["supplier_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_recipe_listings: {
        Row: {
          b2b_price: number
          commercial_name: string
          created_at: string
          establishment_id: string
          id: string
          is_published: boolean
          portions: number | null
          recipe_id: string
          recipe_type_id: string | null
          updated_at: string
        }
        Insert: {
          b2b_price?: number
          commercial_name?: string
          created_at?: string
          establishment_id: string
          id?: string
          is_published?: boolean
          portions?: number | null
          recipe_id: string
          recipe_type_id?: string | null
          updated_at?: string
        }
        Update: {
          b2b_price?: number
          commercial_name?: string
          created_at?: string
          establishment_id?: string
          id?: string
          is_published?: boolean
          portions?: number | null
          recipe_id?: string
          recipe_type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "b2b_recipe_listings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_recipe_listings_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b2b_recipe_listings_recipe_type_id_fkey"
            columns: ["recipe_type_id"]
            isOneToOne: false
            referencedRelation: "recipe_types"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_events: {
        Row: {
          created_at: string
          day_date: string
          device_id: string | null
          early_departure_minutes: number | null
          effective_at: string
          establishment_id: string
          event_type: string
          id: string
          late_minutes: number | null
          occurred_at: string
          organization_id: string
          sequence_index: number
          shift_id: string | null
          shift_match_status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          day_date: string
          device_id?: string | null
          early_departure_minutes?: number | null
          effective_at: string
          establishment_id: string
          event_type: string
          id?: string
          late_minutes?: number | null
          occurred_at?: string
          organization_id: string
          sequence_index?: number
          shift_id?: string | null
          shift_match_status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          day_date?: string
          device_id?: string | null
          early_departure_minutes?: number | null
          effective_at?: string
          establishment_id?: string
          event_type?: string
          id?: string
          late_minutes?: number | null
          occurred_at?: string
          organization_id?: string
          sequence_index?: number
          shift_id?: string | null
          shift_match_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "badge_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badge_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "planning_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      badge_events_duplicates_archive: {
        Row: {
          archived_at: string
          created_at: string
          day_date: string
          device_id: string | null
          effective_at: string
          establishment_id: string
          event_type: string
          id: string
          late_minutes: number | null
          occurred_at: string
          organization_id: string
          reason: string
          sequence_index: number
          user_id: string
        }
        Insert: {
          archived_at?: string
          created_at: string
          day_date: string
          device_id?: string | null
          effective_at: string
          establishment_id: string
          event_type: string
          id: string
          late_minutes?: number | null
          occurred_at: string
          organization_id: string
          reason: string
          sequence_index: number
          user_id: string
        }
        Update: {
          archived_at?: string
          created_at?: string
          day_date?: string
          device_id?: string | null
          effective_at?: string
          establishment_id?: string
          event_type?: string
          id?: string
          late_minutes?: number | null
          occurred_at?: string
          organization_id?: string
          reason?: string
          sequence_index?: number
          user_id?: string
        }
        Relationships: []
      }
      badgeuse_settings: {
        Row: {
          arrival_tolerance_min: number
          created_at: string
          departure_tolerance_min: number
          device_binding_enabled: boolean
          early_arrival_limit_min: number
          establishment_id: string
          extra_threshold_min: number
          id: string
          max_devices_per_user: number
          organization_id: string
          require_pin: boolean
          require_selfie: boolean
          updated_at: string
        }
        Insert: {
          arrival_tolerance_min?: number
          created_at?: string
          departure_tolerance_min?: number
          device_binding_enabled?: boolean
          early_arrival_limit_min?: number
          establishment_id: string
          extra_threshold_min?: number
          id?: string
          max_devices_per_user?: number
          organization_id: string
          require_pin?: boolean
          require_selfie?: boolean
          updated_at?: string
        }
        Update: {
          arrival_tolerance_min?: number
          created_at?: string
          departure_tolerance_min?: number
          device_binding_enabled?: boolean
          early_arrival_limit_min?: number
          establishment_id?: string
          extra_threshold_min?: number
          id?: string
          max_devices_per_user?: number
          organization_id?: string
          require_pin?: boolean
          require_selfie?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "badgeuse_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "badgeuse_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_app_documents: {
        Row: {
          bl_date: string
          bl_number: string | null
          completed_at: string | null
          corrections_count: number
          created_at: string
          created_by: string | null
          establishment_id: string
          id: string
          status: string
          stock_document_id: string
          supplier_id: string | null
          supplier_name_snapshot: string | null
          updated_at: string
        }
        Insert: {
          bl_date?: string
          bl_number?: string | null
          completed_at?: string | null
          corrections_count?: number
          created_at?: string
          created_by?: string | null
          establishment_id: string
          id?: string
          status?: string
          stock_document_id: string
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          bl_date?: string
          bl_number?: string | null
          completed_at?: string | null
          corrections_count?: number
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          id?: string
          status?: string
          stock_document_id?: string
          supplier_id?: string | null
          supplier_name_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bl_app_documents_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_documents_stock_document_id_fkey"
            columns: ["stock_document_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_app_files: {
        Row: {
          bl_app_document_id: string
          created_at: string
          establishment_id: string
          id: string
          mime_type: string | null
          original_name: string | null
          storage_path: string
        }
        Insert: {
          bl_app_document_id: string
          created_at?: string
          establishment_id: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          storage_path: string
        }
        Update: {
          bl_app_document_id?: string
          created_at?: string
          establishment_id?: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "bl_app_files_bl_app_document_id_fkey"
            columns: ["bl_app_document_id"]
            isOneToOne: false
            referencedRelation: "bl_app_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_files_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_app_lines: {
        Row: {
          bl_app_document_id: string
          canonical_unit_id: string
          context_hash: string | null
          created_at: string
          establishment_id: string
          id: string
          line_total: number | null
          product_id: string
          product_name_snapshot: string | null
          quantity_canonical: number
          unit_price: number | null
        }
        Insert: {
          bl_app_document_id: string
          canonical_unit_id: string
          context_hash?: string | null
          created_at?: string
          establishment_id: string
          id?: string
          line_total?: number | null
          product_id: string
          product_name_snapshot?: string | null
          quantity_canonical: number
          unit_price?: number | null
        }
        Update: {
          bl_app_document_id?: string
          canonical_unit_id?: string
          context_hash?: string | null
          created_at?: string
          establishment_id?: string
          id?: string
          line_total?: number | null
          product_id?: string
          product_name_snapshot?: string | null
          quantity_canonical?: number
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_app_lines_bl_app_document_id_fkey"
            columns: ["bl_app_document_id"]
            isOneToOne: false
            referencedRelation: "bl_app_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_lines_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_app_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_withdrawal_documents: {
        Row: {
          bl_date: string
          bl_number: string
          created_at: string
          created_by: string | null
          destination_establishment_id: string | null
          destination_name: string | null
          establishment_id: string
          id: string
          organization_id: string
          stock_document_id: string
          total_eur: number
        }
        Insert: {
          bl_date?: string
          bl_number: string
          created_at?: string
          created_by?: string | null
          destination_establishment_id?: string | null
          destination_name?: string | null
          establishment_id: string
          id?: string
          organization_id: string
          stock_document_id: string
          total_eur?: number
        }
        Update: {
          bl_date?: string
          bl_number?: string
          created_at?: string
          created_by?: string | null
          destination_establishment_id?: string | null
          destination_name?: string | null
          establishment_id?: string
          id?: string
          organization_id?: string
          stock_document_id?: string
          total_eur?: number
        }
        Relationships: [
          {
            foreignKeyName: "bl_withdrawal_documents_destination_establishment_id_fkey"
            columns: ["destination_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_withdrawal_documents_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_withdrawal_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_withdrawal_documents_stock_document_id_fkey"
            columns: ["stock_document_id"]
            isOneToOne: true
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_withdrawal_lines: {
        Row: {
          bl_withdrawal_document_id: string
          canonical_unit_id: string
          created_at: string
          id: string
          line_total_snapshot: number | null
          product_id: string
          product_name_snapshot: string
          quantity_canonical: number
          unit_price_snapshot: number | null
        }
        Insert: {
          bl_withdrawal_document_id: string
          canonical_unit_id: string
          created_at?: string
          id?: string
          line_total_snapshot?: number | null
          product_id: string
          product_name_snapshot: string
          quantity_canonical: number
          unit_price_snapshot?: number | null
        }
        Update: {
          bl_withdrawal_document_id?: string
          canonical_unit_id?: string
          created_at?: string
          id?: string
          line_total_snapshot?: number | null
          product_id?: string
          product_name_snapshot?: string
          quantity_canonical?: number
          unit_price_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_withdrawal_lines_bl_withdrawal_document_id_fkey"
            columns: ["bl_withdrawal_document_id"]
            isOneToOne: false
            referencedRelation: "bl_withdrawal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_withdrawal_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_withdrawal_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_events: {
        Row: {
          action: string
          actor_user_id: string | null
          context: Json | null
          created_at: string
          establishment_id: string
          id: string
          subject: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          context?: Json | null
          created_at?: string
          establishment_id: string
          id?: string
          subject: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          context?: Json | null
          created_at?: string
          establishment_id?: string
          id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_rules: {
        Row: {
          confirmations_count: number
          context_key: string
          corrections_count: number
          created_at: string
          enabled: boolean
          establishment_id: string
          id: string
          last_used_at: string | null
          subject: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          confirmations_count?: number
          context_key: string
          corrections_count?: number
          created_at?: string
          enabled?: boolean
          establishment_id: string
          id?: string
          last_used_at?: string | null
          subject: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          confirmations_count?: number
          context_key?: string
          corrections_count?: number
          created_at?: string
          enabled?: boolean
          establishment_id?: string
          id?: string
          last_used_at?: string | null
          subject?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "brain_rules_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_day_reports: {
        Row: {
          advance_employee_id: string | null
          advance_eur: number
          cash_eur: number
          cb_eur: number
          courses_eur: number
          created_at: string
          created_by: string | null
          day_date: string
          delivery_eur: number
          establishment_id: string
          id: string
          maintenance_eur: number
          note: string | null
          shortage_eur: number
          total_eur: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          advance_employee_id?: string | null
          advance_eur?: number
          cash_eur?: number
          cb_eur?: number
          courses_eur?: number
          created_at?: string
          created_by?: string | null
          day_date: string
          delivery_eur?: number
          establishment_id: string
          id?: string
          maintenance_eur?: number
          note?: string | null
          shortage_eur?: number
          total_eur?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          advance_employee_id?: string | null
          advance_eur?: number
          cash_eur?: number
          cb_eur?: number
          courses_eur?: number
          created_at?: string
          created_by?: string | null
          day_date?: string
          delivery_eur?: number
          establishment_id?: string
          id?: string
          maintenance_eur?: number
          note?: string | null
          shortage_eur?: number
          total_eur?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_day_reports_advance_employee_id_fkey"
            columns: ["advance_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cash_day_reports_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      commande_lines: {
        Row: {
          canonical_quantity: number
          canonical_unit_id: string
          commande_id: string
          created_at: string
          id: string
          input_entries: Json | null
          line_status: string | null
          line_total_snapshot: number | null
          product_id: string
          product_name_snapshot: string
          received_quantity: number | null
          shipped_quantity: number | null
          unit_label_snapshot: string | null
          unit_price_snapshot: number | null
        }
        Insert: {
          canonical_quantity: number
          canonical_unit_id: string
          commande_id: string
          created_at?: string
          id?: string
          input_entries?: Json | null
          line_status?: string | null
          line_total_snapshot?: number | null
          product_id: string
          product_name_snapshot: string
          received_quantity?: number | null
          shipped_quantity?: number | null
          unit_label_snapshot?: string | null
          unit_price_snapshot?: number | null
        }
        Update: {
          canonical_quantity?: number
          canonical_unit_id?: string
          commande_id?: string
          created_at?: string
          id?: string
          input_entries?: Json | null
          line_status?: string | null
          line_total_snapshot?: number | null
          product_id?: string
          product_name_snapshot?: string
          received_quantity?: number | null
          shipped_quantity?: number | null
          unit_label_snapshot?: string | null
          unit_price_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commande_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commande_lines_commande_id_fkey"
            columns: ["commande_id"]
            isOneToOne: false
            referencedRelation: "commandes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commande_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      commandes: {
        Row: {
          client_establishment_id: string
          created_at: string
          created_by: string
          created_by_name_snapshot: string | null
          id: string
          note: string | null
          opened_at: string | null
          opened_by: string | null
          order_number: string | null
          partnership_id: string
          received_at: string | null
          received_by: string | null
          reception_type: string | null
          sent_at: string | null
          shipped_at: string | null
          shipped_by: string | null
          source_commande_id: string | null
          status: Database["public"]["Enums"]["commande_status"]
          supplier_establishment_id: string
          updated_at: string
        }
        Insert: {
          client_establishment_id: string
          created_at?: string
          created_by: string
          created_by_name_snapshot?: string | null
          id?: string
          note?: string | null
          opened_at?: string | null
          opened_by?: string | null
          order_number?: string | null
          partnership_id: string
          received_at?: string | null
          received_by?: string | null
          reception_type?: string | null
          sent_at?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          source_commande_id?: string | null
          status?: Database["public"]["Enums"]["commande_status"]
          supplier_establishment_id: string
          updated_at?: string
        }
        Update: {
          client_establishment_id?: string
          created_at?: string
          created_by?: string
          created_by_name_snapshot?: string | null
          id?: string
          note?: string | null
          opened_at?: string | null
          opened_by?: string | null
          order_number?: string | null
          partnership_id?: string
          received_at?: string | null
          received_by?: string | null
          reception_type?: string | null
          sent_at?: string | null
          shipped_at?: string | null
          shipped_by?: string | null
          source_commande_id?: string | null
          status?: Database["public"]["Enums"]["commande_status"]
          supplier_establishment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commandes_client_establishment_id_fkey"
            columns: ["client_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commandes_partnership_id_fkey"
            columns: ["partnership_id"]
            isOneToOne: false
            referencedRelation: "b2b_partnerships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commandes_source_commande_id_fkey"
            columns: ["source_commande_id"]
            isOneToOne: false
            referencedRelation: "commandes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commandes_supplier_establishment_id_fkey"
            columns: ["supplier_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      dlc_alert_settings: {
        Row: {
          category_thresholds: Json
          default_warning_days: number
          establishment_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_thresholds?: Json
          default_warning_days?: number
          establishment_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_thresholds?: Json
          default_warning_days?: number
          establishment_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dlc_alert_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_details: {
        Row: {
          address: string | null
          contract_end_date: string | null
          contract_hours: number | null
          contract_start_date: string | null
          contract_type: string | null
          cp_n: number | null
          cp_n1: number | null
          created_at: string
          encryption_version: number | null
          gross_salary: number | null
          has_navigo_pass: boolean
          iban: string | null
          iban_encrypted: string | null
          iban_last4: string | null
          id: string
          id_expiry_date: string | null
          id_issue_date: string | null
          id_type: string | null
          navigo_pass_number: string | null
          net_salary: number | null
          organization_id: string
          phone: string | null
          position: string | null
          social_security_number: string | null
          ssn_encrypted: string | null
          ssn_last2: string | null
          total_salary: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          contract_end_date?: string | null
          contract_hours?: number | null
          contract_start_date?: string | null
          contract_type?: string | null
          cp_n?: number | null
          cp_n1?: number | null
          created_at?: string
          encryption_version?: number | null
          gross_salary?: number | null
          has_navigo_pass?: boolean
          iban?: string | null
          iban_encrypted?: string | null
          iban_last4?: string | null
          id?: string
          id_expiry_date?: string | null
          id_issue_date?: string | null
          id_type?: string | null
          navigo_pass_number?: string | null
          net_salary?: number | null
          organization_id: string
          phone?: string | null
          position?: string | null
          social_security_number?: string | null
          ssn_encrypted?: string | null
          ssn_last2?: string | null
          total_salary?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          contract_end_date?: string | null
          contract_hours?: number | null
          contract_start_date?: string | null
          contract_type?: string | null
          cp_n?: number | null
          cp_n1?: number | null
          created_at?: string
          encryption_version?: number | null
          gross_salary?: number | null
          has_navigo_pass?: boolean
          iban?: string | null
          iban_encrypted?: string | null
          iban_last4?: string | null
          id?: string
          id_expiry_date?: string | null
          id_issue_date?: string | null
          id_type?: string | null
          navigo_pass_number?: string | null
          net_salary?: number | null
          organization_id?: string
          phone?: string | null
          position?: string | null
          social_security_number?: string | null
          ssn_encrypted?: string | null
          ssn_last2?: string | null
          total_salary?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_documents: {
        Row: {
          created_at: string
          created_by: string
          document_type: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          organization_id: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          document_type: string
          file_name: string
          file_size: number
          file_type: string
          id?: string
          organization_id: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_type?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          organization_id?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      establishment_break_policies: {
        Row: {
          created_at: string
          created_by: string
          establishment_id: string
          id: string
          input_text: string
          is_active: boolean
          policy_json: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          establishment_id: string
          id?: string
          input_text: string
          is_active?: boolean
          policy_json: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          establishment_id?: string
          id?: string
          input_text?: string
          is_active?: boolean
          policy_json?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "establishment_break_policies_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_day_parts: {
        Row: {
          color: string
          created_at: string
          end_time: string
          establishment_id: string
          id: string
          part: string
          start_time: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          end_time: string
          establishment_id: string
          id?: string
          part: string
          start_time: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          end_time?: string
          establishment_id?: string
          id?: string
          part?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_day_parts_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_nav_config: {
        Row: {
          establishment_id: string
          hidden_ids: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          establishment_id: string
          hidden_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          establishment_id?: string
          hidden_ids?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "establishment_nav_config_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_opening_exceptions: {
        Row: {
          close_time: string | null
          closed: boolean
          created_at: string
          date: string
          establishment_id: string
          id: string
          open_time: string | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          date: string
          establishment_id: string
          id?: string
          open_time?: string | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          date?: string
          establishment_id?: string
          id?: string
          open_time?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_opening_exceptions_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_opening_hours: {
        Row: {
          close_time: string | null
          closed: boolean
          created_at: string
          day_of_week: number
          establishment_id: string
          id: string
          open_time: string | null
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          day_of_week: number
          establishment_id: string
          id?: string
          open_time?: string | null
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          day_of_week?: number
          establishment_id?: string
          id?: string
          open_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_opening_hours_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string
          created_at: string
          establishment_id: string
          establishment_type: string
          legal_name: string | null
          logo_url: string | null
          postal_code: string | null
          siret: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          establishment_id: string
          establishment_type?: string
          legal_name?: string | null
          logo_url?: string | null
          postal_code?: string | null
          siret?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string
          created_at?: string
          establishment_id?: string
          establishment_type?: string
          legal_name?: string | null
          logo_url?: string | null
          postal_code?: string | null
          siret?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_profiles_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_role_nav_config: {
        Row: {
          establishment_id: string
          hidden_ids: string[]
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          establishment_id: string
          hidden_ids?: string[]
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          establishment_id?: string
          hidden_ids?: string[]
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "establishment_role_nav_config_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_role_nav_config_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_stock_settings: {
        Row: {
          default_receipt_zone_id: string | null
          establishment_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_receipt_zone_id?: string | null
          establishment_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_receipt_zone_id?: string | null
          establishment_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "establishment_stock_settings_default_receipt_zone_id_fkey"
            columns: ["default_receipt_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_stock_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishments: {
        Row: {
          address: string | null
          contact_email: string | null
          created_at: string
          establishment_type: string
          id: string
          name: string
          notif_engine_v2: boolean
          organization_id: string
          planning_auto_publish_enabled: boolean
          planning_auto_publish_time: string
          service_day_cutoff: string
          status: Database["public"]["Enums"]["establishment_status"]
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          created_at?: string
          establishment_type?: string
          id?: string
          name: string
          notif_engine_v2?: boolean
          organization_id: string
          planning_auto_publish_enabled?: boolean
          planning_auto_publish_time?: string
          service_day_cutoff?: string
          status?: Database["public"]["Enums"]["establishment_status"]
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          created_at?: string
          establishment_type?: string
          id?: string
          name?: string
          notif_engine_v2?: boolean
          organization_id?: string
          planning_auto_publish_enabled?: boolean
          planning_auto_publish_time?: string
          service_day_cutoff?: string
          status?: Database["public"]["Enums"]["establishment_status"]
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_events: {
        Row: {
          badge_event_id: string
          created_at: string
          day_date: string
          establishment_id: string
          extra_end_at: string | null
          extra_minutes: number
          extra_start_at: string | null
          id: string
          organization_id: string
          status: string
          user_id: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          badge_event_id: string
          created_at?: string
          day_date: string
          establishment_id: string
          extra_end_at?: string | null
          extra_minutes: number
          extra_start_at?: string | null
          id?: string
          organization_id: string
          status?: string
          user_id: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          badge_event_id?: string
          created_at?: string
          day_date?: string
          establishment_id?: string
          extra_end_at?: string | null
          extra_minutes?: number
          extra_start_at?: string | null
          id?: string
          organization_id?: string
          status?: string
          user_id?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extra_events_badge_event_id_fkey"
            columns: ["badge_event_id"]
            isOneToOne: true
            referencedRelation: "badge_events"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_settings: {
        Row: {
          abnormal_quantity_blocking: boolean
          abnormal_quantity_enabled: boolean
          abnormal_quantity_tolerance_pct: number
          atypical_invoice_enabled: boolean
          created_at: string
          establishment_id: string
          filter_existing_products: boolean
          id: string
          missing_price_blocking: boolean
          missing_price_enabled: boolean
          organization_id: string
          price_variation_blocking: boolean
          price_variation_enabled: boolean
          price_variation_tolerance_pct: number
          rarely_bought_enabled: boolean
          rarely_bought_period_months: number
          rarely_bought_threshold_count: number
          show_existing_products_debug: boolean
          updated_at: string
        }
        Insert: {
          abnormal_quantity_blocking?: boolean
          abnormal_quantity_enabled?: boolean
          abnormal_quantity_tolerance_pct?: number
          atypical_invoice_enabled?: boolean
          created_at?: string
          establishment_id: string
          filter_existing_products?: boolean
          id?: string
          missing_price_blocking?: boolean
          missing_price_enabled?: boolean
          organization_id: string
          price_variation_blocking?: boolean
          price_variation_enabled?: boolean
          price_variation_tolerance_pct?: number
          rarely_bought_enabled?: boolean
          rarely_bought_period_months?: number
          rarely_bought_threshold_count?: number
          show_existing_products_debug?: boolean
          updated_at?: string
        }
        Update: {
          abnormal_quantity_blocking?: boolean
          abnormal_quantity_enabled?: boolean
          abnormal_quantity_tolerance_pct?: number
          atypical_invoice_enabled?: boolean
          created_at?: string
          establishment_id?: string
          filter_existing_products?: boolean
          id?: string
          missing_price_blocking?: boolean
          missing_price_enabled?: boolean
          organization_id?: string
          price_variation_blocking?: boolean
          price_variation_enabled?: boolean
          price_variation_tolerance_pct?: number
          rarely_bought_enabled?: boolean
          rarely_bought_period_months?: number
          rarely_bought_threshold_count?: number
          show_existing_products_debug?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_discrepancies: {
        Row: {
          canonical_unit_id: string | null
          created_at: string
          establishment_id: string
          estimated_stock_before: number
          gap_quantity: number
          id: string
          organization_id: string
          product_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_document_id: string | null
          source_type: string
          status: Database["public"]["Enums"]["discrepancy_status"]
          storage_zone_id: string | null
          updated_at: string
          withdrawal_quantity: number
          withdrawal_reason: string | null
          withdrawn_at: string
          withdrawn_by: string | null
        }
        Insert: {
          canonical_unit_id?: string | null
          created_at?: string
          establishment_id: string
          estimated_stock_before: number
          gap_quantity: number
          id?: string
          organization_id: string
          product_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["discrepancy_status"]
          storage_zone_id?: string | null
          updated_at?: string
          withdrawal_quantity: number
          withdrawal_reason?: string | null
          withdrawn_at?: string
          withdrawn_by?: string | null
        }
        Update: {
          canonical_unit_id?: string | null
          created_at?: string
          establishment_id?: string
          estimated_stock_before?: number
          gap_quantity?: number
          id?: string
          organization_id?: string
          product_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_document_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["discrepancy_status"]
          storage_zone_id?: string | null
          updated_at?: string
          withdrawal_quantity?: number
          withdrawal_reason?: string | null
          withdrawn_at?: string
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_discrepancies_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_discrepancies_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_discrepancies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_discrepancies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_discrepancies_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_lines: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          created_at: string
          created_via: string | null
          display_order: number
          id: string
          product_id: string
          quantity: number | null
          session_id: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          created_via?: string | null
          display_order?: number
          id?: string
          product_id: string
          quantity?: number | null
          session_id: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          created_via?: string | null
          display_order?: number
          id?: string
          product_id?: string
          quantity?: number | null
          session_id?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_lines_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_mutualisation_dismissed: {
        Row: {
          created_at: string
          dismissed_by: string | null
          establishment_id: string
          id: string
          product_ids_hash: string
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          establishment_id: string
          id?: string
          product_ids_hash: string
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          establishment_id?: string
          id?: string
          product_ids_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_mutualisation_dismissed_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_mutualisation_groups: {
        Row: {
          b2b_billing_unit_id: string | null
          b2b_price_strategy: string | null
          b2b_unit_price: number | null
          carrier_product_id: string
          created_at: string
          created_by: string | null
          display_name: string
          establishment_id: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          b2b_billing_unit_id?: string | null
          b2b_price_strategy?: string | null
          b2b_unit_price?: number | null
          carrier_product_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          establishment_id: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          b2b_billing_unit_id?: string | null
          b2b_price_strategy?: string | null
          b2b_unit_price?: number | null
          carrier_product_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          establishment_id?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_mutualisation_groups_b2b_billing_unit_id_fkey"
            columns: ["b2b_billing_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_mutualisation_groups_carrier_product_id_fkey"
            columns: ["carrier_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_mutualisation_groups_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_mutualisation_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          product_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_mutualisation_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "inventory_mutualisation_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_mutualisation_members_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_mutualisation_settings: {
        Row: {
          enabled: boolean
          establishment_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          establishment_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          establishment_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_mutualisation_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          counted_products: number
          created_at: string
          establishment_id: string
          id: string
          organization_id: string
          paused_at: string | null
          started_at: string
          started_by: string
          status: Database["public"]["Enums"]["inventory_status"]
          storage_zone_id: string
          total_products: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          counted_products?: number
          created_at?: string
          establishment_id: string
          id?: string
          organization_id: string
          paused_at?: string | null
          started_at?: string
          started_by: string
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_zone_id: string
          total_products?: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          counted_products?: number
          created_at?: string
          establishment_id?: string
          id?: string
          organization_id?: string
          paused_at?: string | null
          started_at?: string
          started_by?: string
          status?: Database["public"]["Enums"]["inventory_status"]
          storage_zone_id?: string
          total_products?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_zone_products: {
        Row: {
          created_at: string
          display_order: number
          establishment_id: string
          id: string
          preferred_unit_id: string | null
          product_id: string
          storage_zone_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          establishment_id: string
          id?: string
          preferred_unit_id?: string | null
          product_id: string
          storage_zone_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          establishment_id?: string
          id?: string
          preferred_unit_id?: string | null
          product_id?: string
          storage_zone_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_zone_products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_zone_products_preferred_unit_id_fkey"
            columns: ["preferred_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_zone_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_zone_products_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          created_by: string
          email: string
          establishment_id: string
          expires_at: string
          id: string
          is_test: boolean
          organization_id: string
          role_id: string
          status: Database["public"]["Enums"]["invitation_status"]
          team_id: string
          token_hash: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          establishment_id: string
          expires_at: string
          id?: string
          is_test?: boolean
          organization_id: string
          role_id: string
          status?: Database["public"]["Enums"]["invitation_status"]
          team_id: string
          token_hash: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          establishment_id?: string
          expires_at?: string
          id?: string
          is_test?: boolean
          organization_id?: string
          role_id?: string
          status?: Database["public"]["Enums"]["invitation_status"]
          team_id?: string
          token_hash?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_extractions: {
        Row: {
          attempt_count: number
          created_at: string
          created_by: string | null
          error_message: string | null
          establishment_id: string
          extraction_json: Json | null
          id: string
          invoice_id: string
          last_attempt_at: string | null
          organization_id: string
          schema_version: number
          status: string
          supplier_id: string | null
          updated_at: string
          year_month: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          establishment_id: string
          extraction_json?: Json | null
          id?: string
          invoice_id: string
          last_attempt_at?: string | null
          organization_id: string
          schema_version?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          year_month: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          establishment_id?: string
          extraction_json?: Json | null
          id?: string
          invoice_id?: string
          last_attempt_at?: string | null
          organization_id?: string
          schema_version?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_extractions_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_extractions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_extractions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          category_snapshot: string | null
          created_at: string
          currency: string | null
          establishment_id: string
          global_product_id: string | null
          id: string
          invoice_id: string
          line_index: number
          line_total: number | null
          packaging: string | null
          packaging_snapshot: string | null
          product_code_snapshot: string | null
          product_id: string | null
          product_name_snapshot: string | null
          quantity: number | null
          raw_label: string | null
          supplier_id: string
          supplier_product_id_legacy: string | null
          unit_of_sale: string | null
          unit_of_sale_snapshot: string | null
          unit_price: number | null
          unit_price_snapshot: number | null
          updated_at: string
          year_month: string
        }
        Insert: {
          category_snapshot?: string | null
          created_at?: string
          currency?: string | null
          establishment_id: string
          global_product_id?: string | null
          id?: string
          invoice_id: string
          line_index: number
          line_total?: number | null
          packaging?: string | null
          packaging_snapshot?: string | null
          product_code_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          quantity?: number | null
          raw_label?: string | null
          supplier_id: string
          supplier_product_id_legacy?: string | null
          unit_of_sale?: string | null
          unit_of_sale_snapshot?: string | null
          unit_price?: number | null
          unit_price_snapshot?: number | null
          updated_at?: string
          year_month: string
        }
        Update: {
          category_snapshot?: string | null
          created_at?: string
          currency?: string | null
          establishment_id?: string
          global_product_id?: string | null
          id?: string
          invoice_id?: string
          line_index?: number
          line_total?: number | null
          packaging?: string | null
          packaging_snapshot?: string | null
          product_code_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          quantity?: number | null
          raw_label?: string | null
          supplier_id?: string
          supplier_product_id_legacy?: string | null
          unit_of_sale?: string | null
          unit_of_sale_snapshot?: string | null
          unit_price?: number | null
          unit_price_snapshot?: number | null
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_extracted_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_monthly_statements: {
        Row: {
          created_at: string
          created_by: string
          establishment_id: string
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          gap_eur: number | null
          id: string
          organization_id: string
          payment_date: string | null
          statement_amount_eur: number
          status: string
          supplier_id: string
          updated_at: string
          year_month: string
        }
        Insert: {
          created_at?: string
          created_by: string
          establishment_id: string
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          gap_eur?: number | null
          id?: string
          organization_id: string
          payment_date?: string | null
          statement_amount_eur: number
          status?: string
          supplier_id: string
          updated_at?: string
          year_month: string
        }
        Update: {
          created_at?: string
          created_by?: string
          establishment_id?: string
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          gap_eur?: number | null
          id?: string
          organization_id?: string
          payment_date?: string | null
          statement_amount_eur?: number
          status?: string
          supplier_id?: string
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_monthly_statements_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_monthly_statements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_monthly_statements_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_suppliers: {
        Row: {
          address_line2: string | null
          archived_at: string | null
          billing_address: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          currency: string | null
          establishment_id: string
          iban_masked: string | null
          id: string
          internal_code: string | null
          logo_url: string | null
          name: string
          name_normalized: string | null
          notes: string | null
          organization_id: string
          payment_delay_days: number | null
          payment_method: string | null
          payment_terms: string | null
          postal_code: string | null
          siret: string | null
          status: string
          supplier_type: string | null
          tags: string[] | null
          trade_name: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address_line2?: string | null
          archived_at?: string | null
          billing_address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          establishment_id: string
          iban_masked?: string | null
          id?: string
          internal_code?: string | null
          logo_url?: string | null
          name: string
          name_normalized?: string | null
          notes?: string | null
          organization_id: string
          payment_delay_days?: number | null
          payment_method?: string | null
          payment_terms?: string | null
          postal_code?: string | null
          siret?: string | null
          status?: string
          supplier_type?: string | null
          tags?: string[] | null
          trade_name?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address_line2?: string | null
          archived_at?: string | null
          billing_address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          establishment_id?: string
          iban_masked?: string | null
          id?: string
          internal_code?: string | null
          logo_url?: string | null
          name?: string
          name_normalized?: string | null
          notes?: string | null
          organization_id?: string
          payment_delay_days?: number | null
          payment_method?: string | null
          payment_terms?: string | null
          postal_code?: string | null
          siret?: string | null
          status?: string
          supplier_type?: string | null
          tags?: string[] | null
          trade_name?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_suppliers_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_eur: number
          amount_ht: number | null
          created_at: string
          created_by: string
          establishment_id: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          invoice_date: string
          invoice_number: string | null
          is_paid: boolean
          organization_id: string
          supplier_id: string
          supplier_name: string | null
          supplier_name_normalized: string | null
          updated_at: string
          vat_amount: number | null
          vat_enriched_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_eur: number
          amount_ht?: number | null
          created_at?: string
          created_by: string
          establishment_id: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          invoice_date: string
          invoice_number?: string | null
          is_paid?: boolean
          organization_id: string
          supplier_id: string
          supplier_name?: string | null
          supplier_name_normalized?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_enriched_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_eur?: number
          amount_ht?: number | null
          created_at?: string
          created_by?: string
          establishment_id?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          is_paid?: boolean
          organization_id?: string
          supplier_id?: string
          supplier_name?: string | null
          supplier_name_normalized?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_enriched_at?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      litige_lines: {
        Row: {
          commande_line_id: string
          created_at: string
          id: string
          litige_id: string
          reason: string | null
          received_quantity: number
          shipped_quantity: number
        }
        Insert: {
          commande_line_id: string
          created_at?: string
          id?: string
          litige_id: string
          reason?: string | null
          received_quantity: number
          shipped_quantity: number
        }
        Update: {
          commande_line_id?: string
          created_at?: string
          id?: string
          litige_id?: string
          reason?: string | null
          received_quantity?: number
          shipped_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "litige_lines_commande_line_id_fkey"
            columns: ["commande_line_id"]
            isOneToOne: false
            referencedRelation: "commande_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "litige_lines_litige_id_fkey"
            columns: ["litige_id"]
            isOneToOne: false
            referencedRelation: "litiges"
            referencedColumns: ["id"]
          },
        ]
      }
      litiges: {
        Row: {
          commande_id: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          commande_id: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          commande_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "litiges_commande_id_fkey"
            columns: ["commande_id"]
            isOneToOne: true
            referencedRelation: "commandes"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_units: {
        Row: {
          abbreviation: string
          aliases: string[] | null
          category: string
          created_at: string
          display_order: number
          establishment_id: string
          family: string | null
          id: string
          is_active: boolean
          is_reference: boolean
          is_system: boolean
          name: string
          notes: string | null
          organization_id: string
          updated_at: string
          usage_category: string
        }
        Insert: {
          abbreviation: string
          aliases?: string[] | null
          category?: string
          created_at?: string
          display_order?: number
          establishment_id: string
          family?: string | null
          id?: string
          is_active?: boolean
          is_reference?: boolean
          is_system?: boolean
          name: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          usage_category?: string
        }
        Update: {
          abbreviation?: string
          aliases?: string[] | null
          category?: string
          created_at?: string
          display_order?: number
          establishment_id?: string
          family?: string | null
          id?: string
          is_active?: boolean
          is_reference?: boolean
          is_system?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          usage_category?: string
        }
        Relationships: [
          {
            foreignKeyName: "measurement_units_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "measurement_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mep_conditioning_types: {
        Row: {
          created_at: string
          display_order: number
          establishment_id: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          establishment_id: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          display_order?: number
          establishment_id?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mep_conditioning_types_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      mep_order_lines: {
        Row: {
          conditioning_name_snapshot: string | null
          id: string
          order_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          status: string
          updated_at: string
        }
        Insert: {
          conditioning_name_snapshot?: string | null
          id?: string
          order_id: string
          product_id: string
          product_name_snapshot: string
          quantity?: number
          status?: string
          updated_at?: string
        }
        Update: {
          conditioning_name_snapshot?: string | null
          id?: string
          order_id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mep_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "mep_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mep_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "mep_products"
            referencedColumns: ["id"]
          },
        ]
      }
      mep_orders: {
        Row: {
          created_at: string
          created_by: string
          destination_establishment_id: string | null
          establishment_id: string
          id: string
          note: string | null
          source_establishment_id: string
          status: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          destination_establishment_id?: string | null
          establishment_id: string
          id?: string
          note?: string | null
          source_establishment_id: string
          status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          destination_establishment_id?: string | null
          establishment_id?: string
          id?: string
          note?: string | null
          source_establishment_id?: string
          status?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mep_orders_destination_establishment_id_fkey"
            columns: ["destination_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mep_orders_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mep_orders_source_establishment_id_fkey"
            columns: ["source_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      mep_products: {
        Row: {
          conditioning_type_id: string | null
          created_at: string
          establishment_id: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          conditioning_type_id?: string | null
          created_at?: string
          establishment_id: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          conditioning_type_id?: string | null
          created_at?: string
          establishment_id?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mep_products_conditioning_type_id_fkey"
            columns: ["conditioning_type_id"]
            isOneToOne: false
            referencedRelation: "mep_conditioning_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mep_products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          is_active: boolean
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          is_active?: boolean
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          is_active?: boolean
          key?: string
          name?: string
        }
        Relationships: []
      }
      notification_delivery_logs: {
        Row: {
          alert_key: string
          created_at: string
          endpoint_domain: string | null
          error_message: string | null
          establishment_id: string
          http_status: number | null
          id: string
          notification_event_id: string | null
          push_subscription_id: string | null
          recipient_user_id: string
          status: string
        }
        Insert: {
          alert_key: string
          created_at?: string
          endpoint_domain?: string | null
          error_message?: string | null
          establishment_id: string
          http_status?: number | null
          id?: string
          notification_event_id?: string | null
          push_subscription_id?: string | null
          recipient_user_id: string
          status: string
        }
        Update: {
          alert_key?: string
          created_at?: string
          endpoint_domain?: string | null
          error_message?: string | null
          establishment_id?: string
          http_status?: number | null
          id?: string
          notification_event_id?: string | null
          push_subscription_id?: string | null
          recipient_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_logs_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_logs_notification_event_id_fkey"
            columns: ["notification_event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          alert_key: string
          alert_type: string
          establishment_id: string
          id: string
          incident_id: string | null
          payload: Json | null
          read_at: string | null
          recipient_user_id: string
          rule_id: string
          sent_at: string
        }
        Insert: {
          alert_key: string
          alert_type: string
          establishment_id: string
          id?: string
          incident_id?: string | null
          payload?: Json | null
          read_at?: string | null
          recipient_user_id: string
          rule_id: string
          sent_at?: string
        }
        Update: {
          alert_key?: string
          alert_type?: string
          establishment_id?: string
          id?: string
          incident_id?: string | null
          payload?: Json | null
          read_at?: string | null
          recipient_user_id?: string
          rule_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "notification_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_incidents: {
        Row: {
          alert_type: string
          establishment_id: string
          id: string
          last_notified_at: string | null
          metadata: Json | null
          notify_count: number
          opened_at: string
          resolved_at: string | null
          rule_id: string | null
          shift_id: string
          status: Database["public"]["Enums"]["incident_status"]
          user_id: string
        }
        Insert: {
          alert_type: string
          establishment_id: string
          id?: string
          last_notified_at?: string | null
          metadata?: Json | null
          notify_count?: number
          opened_at?: string
          resolved_at?: string | null
          rule_id?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["incident_status"]
          user_id: string
        }
        Update: {
          alert_type?: string
          establishment_id?: string
          id?: string
          last_notified_at?: string | null
          metadata?: Json | null
          notify_count?: number
          opened_at?: string
          resolved_at?: string | null
          rule_id?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["incident_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_incidents_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_incidents_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          active_end_time: string
          active_start_time: string
          alert_type: string
          body_template: string
          category: string
          config: Json
          cooldown_minutes: number
          created_at: string
          enabled: boolean
          establishment_id: string | null
          id: string
          min_severity: number
          organization_id: string
          priority: number
          recipient_role_ids: string[]
          scope: string
          title_template: string
          updated_at: string
        }
        Insert: {
          active_end_time?: string
          active_start_time?: string
          alert_type: string
          body_template: string
          category?: string
          config?: Json
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          establishment_id?: string | null
          id?: string
          min_severity?: number
          organization_id: string
          priority?: number
          recipient_role_ids?: string[]
          scope?: string
          title_template: string
          updated_at?: string
        }
        Update: {
          active_end_time?: string
          active_start_time?: string
          alert_type?: string
          body_template?: string
          category?: string
          config?: Json
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          establishment_id?: string | null
          id?: string
          min_severity?: number
          organization_id?: string
          priority?: number
          recipient_role_ids?: string[]
          scope?: string
          title_template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          org_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      packaging_formats: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          quantity: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          quantity?: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          quantity?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_formats_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_formats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_formats_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_allocations: {
        Row: {
          amount_eur: number
          created_at: string
          created_by: string
          establishment_id: string
          id: string
          organization_id: string
          pay_invoice_id: string
          payment_id: string
        }
        Insert: {
          amount_eur: number
          created_at?: string
          created_by: string
          establishment_id: string
          id?: string
          organization_id: string
          pay_invoice_id: string
          payment_id: string
        }
        Update: {
          amount_eur?: number
          created_at?: string
          created_by?: string
          establishment_id?: string
          id?: string
          organization_id?: string
          pay_invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_allocations_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_allocations_pay_invoice_id_fkey"
            columns: ["pay_invoice_id"]
            isOneToOne: false
            referencedRelation: "pay_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "pay_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_establishment_settings: {
        Row: {
          auto_record_direct_debit: boolean
          created_at: string
          created_by: string | null
          establishment_id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_record_direct_debit?: boolean
          created_at?: string
          created_by?: string | null
          establishment_id: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_record_direct_debit?: boolean
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_establishment_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_establishment_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_invoices: {
        Row: {
          amount_eur: number
          created_at: string
          created_by: string
          establishment_id: string
          id: string
          invoice_date: string
          label: string | null
          organization_id: string
          source_invoice_id: string | null
          supplier_id: string
        }
        Insert: {
          amount_eur: number
          created_at?: string
          created_by: string
          establishment_id: string
          id?: string
          invoice_date: string
          label?: string | null
          organization_id: string
          source_invoice_id?: string | null
          supplier_id: string
        }
        Update: {
          amount_eur?: number
          created_at?: string
          created_by?: string
          establishment_id?: string
          id?: string
          invoice_date?: string
          label?: string | null
          organization_id?: string
          source_invoice_id?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_invoices_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_invoices_source_invoice_id_fkey"
            columns: ["source_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_payments: {
        Row: {
          amount_eur: number
          created_at: string
          created_by: string
          establishment_id: string
          external_ref: string | null
          id: string
          idempotency_key: string | null
          method: string
          note: string | null
          organization_id: string
          payment_date: string
          payment_source: string
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount_eur: number
          created_at?: string
          created_by: string
          establishment_id: string
          external_ref?: string | null
          id?: string
          idempotency_key?: string | null
          method: string
          note?: string | null
          organization_id: string
          payment_date: string
          payment_source?: string
          supplier_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_eur?: number
          created_at?: string
          created_by?: string
          establishment_id?: string
          external_ref?: string | null
          id?: string
          idempotency_key?: string | null
          method?: string
          note?: string | null
          organization_id?: string
          payment_date?: string
          payment_source?: string
          supplier_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_payments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_schedule_items: {
        Row: {
          created_at: string
          created_by: string
          due_date: string
          establishment_id: string
          expected_amount_eur: number | null
          id: string
          organization_id: string
          pay_invoice_id: string | null
          source: string
          supplier_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          due_date: string
          establishment_id: string
          expected_amount_eur?: number | null
          id?: string
          organization_id: string
          pay_invoice_id?: string | null
          source?: string
          supplier_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          due_date?: string
          establishment_id?: string
          expected_amount_eur?: number | null
          id?: string
          organization_id?: string
          pay_invoice_id?: string | null
          source?: string
          supplier_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_schedule_items_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_schedule_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_schedule_items_pay_invoice_id_fkey"
            columns: ["pay_invoice_id"]
            isOneToOne: false
            referencedRelation: "pay_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_schedule_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_supplier_rules: {
        Row: {
          allocation_strategy: string
          allow_partial: boolean
          created_at: string
          created_by: string
          delay_days: number | null
          establishment_id: string
          fixed_day_of_month: number | null
          id: string
          installment_count: number | null
          installment_days: number[] | null
          is_monthly_aggregate: boolean
          mode: string
          organization_id: string
          supplier_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allocation_strategy?: string
          allow_partial?: boolean
          created_at?: string
          created_by: string
          delay_days?: number | null
          establishment_id: string
          fixed_day_of_month?: number | null
          id?: string
          installment_count?: number | null
          installment_days?: number[] | null
          is_monthly_aggregate?: boolean
          mode?: string
          organization_id: string
          supplier_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allocation_strategy?: string
          allow_partial?: boolean
          created_at?: string
          created_by?: string
          delay_days?: number | null
          establishment_id?: string
          fixed_day_of_month?: number | null
          id?: string
          installment_count?: number | null
          installment_days?: number[] | null
          is_monthly_aggregate?: boolean
          mode?: string
          organization_id?: string
          supplier_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_supplier_rules_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_supplier_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_supplier_rules_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employee_month_validation: {
        Row: {
          cash_amount_paid: number | null
          cash_paid: boolean
          establishment_id: string
          extras_paid_eur: number | null
          id: string
          include_absences: boolean
          include_deductions: boolean
          include_extras: boolean
          net_amount_paid: number | null
          net_paid: boolean
          updated_at: string
          updated_by: string
          user_id: string
          year_month: string
        }
        Insert: {
          cash_amount_paid?: number | null
          cash_paid?: boolean
          establishment_id: string
          extras_paid_eur?: number | null
          id?: string
          include_absences?: boolean
          include_deductions?: boolean
          include_extras?: boolean
          net_amount_paid?: number | null
          net_paid?: boolean
          updated_at?: string
          updated_by: string
          user_id: string
          year_month: string
        }
        Update: {
          cash_amount_paid?: number | null
          cash_paid?: boolean
          establishment_id?: string
          extras_paid_eur?: number | null
          id?: string
          include_absences?: boolean
          include_deductions?: boolean
          include_extras?: boolean
          net_amount_paid?: number | null
          net_paid?: boolean
          updated_at?: string
          updated_by?: string
          user_id?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employee_month_validation_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      personnel_leave_requests: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          leave_date: string
          leave_type: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          leave_date: string
          leave_type: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          leave_date?: string
          leave_type?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      personnel_leaves: {
        Row: {
          created_at: string
          created_by: string | null
          establishment_id: string
          id: string
          justificatif_document_id: string | null
          leave_date: string
          leave_type: string
          reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          establishment_id: string
          id?: string
          justificatif_document_id?: string | null
          leave_date: string
          leave_type: string
          reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          id?: string
          justificatif_document_id?: string | null
          leave_date?: string
          leave_type?: string
          reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      planning_rextra_events: {
        Row: {
          created_at: string
          created_by: string
          establishment_id: string
          event_date: string
          id: string
          minutes: number
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          establishment_id: string
          event_date: string
          id?: string
          minutes: number
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          establishment_id?: string
          event_date?: string
          id?: string
          minutes?: number
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_rextra_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_rextra_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_shifts: {
        Row: {
          break_minutes: number
          created_at: string
          end_time: string
          establishment_id: string
          id: string
          net_minutes: number
          organization_id: string
          shift_date: string
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          break_minutes?: number
          created_at?: string
          end_time: string
          establishment_id: string
          id?: string
          net_minutes?: number
          organization_id: string
          shift_date: string
          start_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          break_minutes?: number
          created_at?: string
          end_time?: string
          establishment_id?: string
          id?: string
          net_minutes?: number
          organization_id?: string
          shift_date?: string
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_shifts_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_weeks: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          organization_id: string
          updated_at: string
          validated_days: Json
          week_invalidated_at: string | null
          week_start: string
          week_validated: boolean
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          organization_id: string
          updated_at?: string
          validated_days?: Json
          week_invalidated_at?: string | null
          week_start: string
          week_validated?: boolean
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
          validated_days?: Json
          week_invalidated_at?: string | null
          week_start?: string
          week_validated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "planning_weeks_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_weeks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_category_templates: {
        Row: {
          created_at: string
          display_order: number
          id: string
          name: string
          name_normalized: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          name: string
          name_normalized: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          name_normalized?: string
        }
        Relationships: []
      }
      platform_establishment_module_selections: {
        Row: {
          created_at: string
          enabled: boolean
          establishment_id: string
          id: string
          module_key: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          establishment_id: string
          id?: string
          module_key: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          establishment_id?: string
          id?: string
          module_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_establishment_module_selections_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_impersonations: {
        Row: {
          active: boolean
          ended_at: string | null
          id: string
          platform_admin_id: string
          started_at: string
          target_establishment_id: string
          target_role_name: string
          target_user_id: string
        }
        Insert: {
          active?: boolean
          ended_at?: string | null
          id?: string
          platform_admin_id: string
          started_at?: string
          target_establishment_id: string
          target_role_name?: string
          target_user_id: string
        }
        Update: {
          active?: boolean
          ended_at?: string | null
          id?: string
          platform_admin_id?: string
          started_at?: string
          target_establishment_id?: string
          target_role_name?: string
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_impersonations_target_establishment_id_fkey"
            columns: ["target_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_unit_templates: {
        Row: {
          abbreviation: string
          aliases: string[] | null
          category: string
          created_at: string
          display_order: number
          family: string | null
          id: string
          is_reference: boolean
          is_system: boolean
          name: string
          notes: string | null
          usage_category: string
        }
        Insert: {
          abbreviation: string
          aliases?: string[] | null
          category?: string
          created_at?: string
          display_order?: number
          family?: string | null
          id?: string
          is_reference?: boolean
          is_system?: boolean
          name: string
          notes?: string | null
          usage_category?: string
        }
        Update: {
          abbreviation?: string
          aliases?: string[] | null
          category?: string
          created_at?: string
          display_order?: number
          family?: string | null
          id?: string
          is_reference?: boolean
          is_system?: boolean
          name?: string
          notes?: string | null
          usage_category?: string
        }
        Relationships: []
      }
      price_alert_settings: {
        Row: {
          category_thresholds: Json
          created_at: string
          enabled: boolean
          establishment_id: string
          global_threshold_pct: number
          updated_at: string
        }
        Insert: {
          category_thresholds?: Json
          created_at?: string
          enabled?: boolean
          establishment_id: string
          global_threshold_pct?: number
          updated_at?: string
        }
        Update: {
          category_thresholds?: Json
          created_at?: string
          enabled?: boolean
          establishment_id?: string
          global_threshold_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_alert_settings_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      price_alerts: {
        Row: {
          acked_at: string | null
          category: string | null
          created_at: string
          day_date: string
          establishment_id: string
          id: string
          new_price: number
          old_price: number
          product_id: string
          product_name: string
          seen_at: string | null
          source_product_id: string
          supplier_name: string
          updated_at: string
          variation_pct: number
        }
        Insert: {
          acked_at?: string | null
          category?: string | null
          created_at?: string
          day_date?: string
          establishment_id: string
          id?: string
          new_price?: number
          old_price?: number
          product_id: string
          product_name?: string
          seen_at?: string | null
          source_product_id: string
          supplier_name?: string
          updated_at?: string
          variation_pct?: number
        }
        Update: {
          acked_at?: string | null
          category?: string | null
          created_at?: string
          day_date?: string
          establishment_id?: string
          id?: string
          new_price?: number
          old_price?: number
          product_id?: string
          product_name?: string
          seen_at?: string | null
          source_product_id?: string
          supplier_name?: string
          updated_at?: string
          variation_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_alerts_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          is_archived: boolean
          name: string
          name_normalized: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          is_archived?: boolean
          name: string
          name_normalized: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          is_archived?: boolean
          name?: string
          name_normalized?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_input_config: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          internal_mode: string
          internal_preferred_unit_id: string | null
          internal_unit_chain: Json | null
          product_id: string
          purchase_mode: string
          purchase_preferred_unit_id: string | null
          purchase_unit_chain: Json | null
          reception_mode: string
          reception_preferred_unit_id: string | null
          reception_unit_chain: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          internal_mode?: string
          internal_preferred_unit_id?: string | null
          internal_unit_chain?: Json | null
          product_id: string
          purchase_mode?: string
          purchase_preferred_unit_id?: string | null
          purchase_unit_chain?: Json | null
          reception_mode?: string
          reception_preferred_unit_id?: string | null
          reception_unit_chain?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          internal_mode?: string
          internal_preferred_unit_id?: string | null
          internal_unit_chain?: Json | null
          product_id?: string
          purchase_mode?: string
          purchase_preferred_unit_id?: string | null
          purchase_unit_chain?: Json | null
          reception_mode?: string
          reception_preferred_unit_id?: string | null
          reception_unit_chain?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_input_config_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_input_config_internal_default_unit_id_fkey"
            columns: ["internal_preferred_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_input_config_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_input_config_purchase_preferred_unit_id_fkey"
            columns: ["purchase_preferred_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_input_config_reception_default_unit_id_fkey"
            columns: ["reception_preferred_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      product_return_photos: {
        Row: {
          created_at: string
          id: string
          original_name: string | null
          return_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          original_name?: string | null
          return_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          original_name?: string | null
          return_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_return_photos_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "product_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      product_returns: {
        Row: {
          canonical_unit_id: string | null
          client_establishment_id: string
          commande_id: string
          commande_line_id: string | null
          created_at: string
          created_by: string
          id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          reason_comment: string | null
          resolution: Database["public"]["Enums"]["return_resolution"] | null
          resolved_at: string | null
          resolved_by: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status: Database["public"]["Enums"]["return_status"]
          supplier_comment: string | null
          supplier_establishment_id: string
          unit_label_snapshot: string | null
          updated_at: string
        }
        Insert: {
          canonical_unit_id?: string | null
          client_establishment_id: string
          commande_id: string
          commande_line_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          product_id: string
          product_name_snapshot: string
          quantity?: number
          reason_comment?: string | null
          resolution?: Database["public"]["Enums"]["return_resolution"] | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_type: Database["public"]["Enums"]["return_type"]
          status?: Database["public"]["Enums"]["return_status"]
          supplier_comment?: string | null
          supplier_establishment_id: string
          unit_label_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          canonical_unit_id?: string | null
          client_establishment_id?: string
          commande_id?: string
          commande_line_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          reason_comment?: string | null
          resolution?: Database["public"]["Enums"]["return_resolution"] | null
          resolved_at?: string | null
          resolved_by?: string | null
          return_type?: Database["public"]["Enums"]["return_type"]
          status?: Database["public"]["Enums"]["return_status"]
          supplier_comment?: string | null
          supplier_establishment_id?: string
          unit_label_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_returns_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_returns_client_establishment_id_fkey"
            columns: ["client_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_returns_commande_id_fkey"
            columns: ["commande_id"]
            isOneToOne: false
            referencedRelation: "commandes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_returns_commande_line_id_fkey"
            columns: ["commande_line_id"]
            isOneToOne: false
            referencedRelation: "commande_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_returns_supplier_establishment_id_fkey"
            columns: ["supplier_establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          code_barres: string | null
          code_produit: string | null
          conditionnement: string | null
          created_at: string
          establishment_id: string
          fournisseurs: string | null
          id: string
          info_produit: string | null
          name_normalized: string
          nom_produit: string
          nom_produit_fr: string | null
          prix_unitaire: number | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          code_barres?: string | null
          code_produit?: string | null
          conditionnement?: string | null
          created_at?: string
          establishment_id: string
          fournisseurs?: string | null
          id?: string
          info_produit?: string | null
          name_normalized: string
          nom_produit: string
          nom_produit_fr?: string | null
          prix_unitaire?: number | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          code_barres?: string | null
          code_produit?: string | null
          conditionnement?: string | null
          created_at?: string
          establishment_id?: string
          fournisseurs?: string | null
          id?: string
          info_produit?: string | null
          name_normalized?: string
          nom_produit?: string
          nom_produit_fr?: string | null
          prix_unitaire?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      products_v2: {
        Row: {
          allow_unit_sale: boolean
          archived_at: string | null
          category: string | null
          category_id: string | null
          code_barres: string | null
          code_produit: string | null
          conditionnement_config: Json | null
          conditionnement_resume: string | null
          created_at: string
          created_by: string | null
          delivery_unit_id: string | null
          dlc_required_at_reception: boolean
          dlc_warning_days: number | null
          establishment_id: string
          final_unit_id: string | null
          final_unit_price: number | null
          id: string
          info_produit: string | null
          inventory_display_unit_id: string | null
          kitchen_unit_id: string | null
          min_stock_quantity_canonical: number | null
          min_stock_unit_id: string | null
          min_stock_updated_at: string | null
          min_stock_updated_by: string | null
          name_normalized: string
          nom_produit: string
          nom_produit_fr: string | null
          price_display_unit_id: string | null
          reception_tolerance_max: number | null
          reception_tolerance_min: number | null
          reception_tolerance_unit_id: string | null
          stock_handling_unit_id: string | null
          storage_zone_id: string | null
          supplier_billing_line_total: number | null
          supplier_billing_quantity: number | null
          supplier_billing_unit_id: string | null
          supplier_id: string
          updated_at: string
          variant_format: string | null
        }
        Insert: {
          allow_unit_sale?: boolean
          archived_at?: string | null
          category?: string | null
          category_id?: string | null
          code_barres?: string | null
          code_produit?: string | null
          conditionnement_config?: Json | null
          conditionnement_resume?: string | null
          created_at?: string
          created_by?: string | null
          delivery_unit_id?: string | null
          dlc_required_at_reception?: boolean
          dlc_warning_days?: number | null
          establishment_id: string
          final_unit_id?: string | null
          final_unit_price?: number | null
          id?: string
          info_produit?: string | null
          inventory_display_unit_id?: string | null
          kitchen_unit_id?: string | null
          min_stock_quantity_canonical?: number | null
          min_stock_unit_id?: string | null
          min_stock_updated_at?: string | null
          min_stock_updated_by?: string | null
          name_normalized: string
          nom_produit: string
          nom_produit_fr?: string | null
          price_display_unit_id?: string | null
          reception_tolerance_max?: number | null
          reception_tolerance_min?: number | null
          reception_tolerance_unit_id?: string | null
          stock_handling_unit_id?: string | null
          storage_zone_id?: string | null
          supplier_billing_line_total?: number | null
          supplier_billing_quantity?: number | null
          supplier_billing_unit_id?: string | null
          supplier_id: string
          updated_at?: string
          variant_format?: string | null
        }
        Update: {
          allow_unit_sale?: boolean
          archived_at?: string | null
          category?: string | null
          category_id?: string | null
          code_barres?: string | null
          code_produit?: string | null
          conditionnement_config?: Json | null
          conditionnement_resume?: string | null
          created_at?: string
          created_by?: string | null
          delivery_unit_id?: string | null
          dlc_required_at_reception?: boolean
          dlc_warning_days?: number | null
          establishment_id?: string
          final_unit_id?: string | null
          final_unit_price?: number | null
          id?: string
          info_produit?: string | null
          inventory_display_unit_id?: string | null
          kitchen_unit_id?: string | null
          min_stock_quantity_canonical?: number | null
          min_stock_unit_id?: string | null
          min_stock_updated_at?: string | null
          min_stock_updated_by?: string | null
          name_normalized?: string
          nom_produit?: string
          nom_produit_fr?: string | null
          price_display_unit_id?: string | null
          reception_tolerance_max?: number | null
          reception_tolerance_min?: number | null
          reception_tolerance_unit_id?: string | null
          stock_handling_unit_id?: string | null
          storage_zone_id?: string | null
          supplier_billing_line_total?: number | null
          supplier_billing_quantity?: number | null
          supplier_billing_unit_id?: string | null
          supplier_id?: string
          updated_at?: string
          variant_format?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_v2_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_delivery_unit_id_fkey"
            columns: ["delivery_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_final_unit_id_fkey"
            columns: ["final_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_inventory_display_unit_id_fkey"
            columns: ["inventory_display_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_kitchen_unit_id_fkey"
            columns: ["kitchen_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_min_stock_unit_id_fkey"
            columns: ["min_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_price_display_unit_id_fkey"
            columns: ["price_display_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_stock_handling_unit_id_fkey"
            columns: ["stock_handling_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_supplier_billing_unit_id_fkey"
            columns: ["supplier_billing_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_v2_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          organization_id: string
          second_first_name: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          organization_id: string
          second_first_name?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          organization_id?: string
          second_first_name?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_line_items: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          invoice_id: string
          line_total: number | null
          product_code_snapshot: string | null
          product_id: string | null
          product_name_snapshot: string | null
          quantite_commandee: number | null
          source_line_id: string
          supplier_id: string
          unit_snapshot: string | null
          year_month: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          invoice_id: string
          line_total?: number | null
          product_code_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          quantite_commandee?: number | null
          source_line_id: string
          supplier_id: string
          unit_snapshot?: string | null
          year_month: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          invoice_id?: string
          line_total?: number | null
          product_code_snapshot?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          quantite_commandee?: number | null
          source_line_id?: string
          supplier_id?: string
          unit_snapshot?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          establishment_id: string | null
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          establishment_id?: string | null
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          establishment_id?: string | null
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reception_lot_dlc: {
        Row: {
          canonical_unit_id: string
          commande_line_id: string
          created_at: string | null
          created_by: string | null
          dismissed_at: string | null
          dismissed_reason: string | null
          dlc_date: string
          establishment_id: string
          id: string
          product_id: string
          quantity_received: number
          updated_at: string | null
        }
        Insert: {
          canonical_unit_id: string
          commande_line_id: string
          created_at?: string | null
          created_by?: string | null
          dismissed_at?: string | null
          dismissed_reason?: string | null
          dlc_date: string
          establishment_id: string
          id?: string
          product_id: string
          quantity_received: number
          updated_at?: string | null
        }
        Update: {
          canonical_unit_id?: string
          commande_line_id?: string
          created_at?: string | null
          created_by?: string | null
          dismissed_at?: string | null
          dismissed_reason?: string | null
          dlc_date?: string
          establishment_id?: string
          id?: string
          product_id?: string
          quantity_received?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reception_lot_dlc_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_lot_dlc_commande_line_id_fkey"
            columns: ["commande_line_id"]
            isOneToOne: true
            referencedRelation: "commande_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_lot_dlc_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_lot_dlc_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_lines: {
        Row: {
          created_at: string
          display_order: number
          id: string
          product_id: string | null
          quantity: number
          recipe_id: string
          sub_recipe_id: string | null
          unit_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          product_id?: string | null
          quantity: number
          recipe_id: string
          sub_recipe_id?: string | null
          unit_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          product_id?: string | null
          quantity?: number
          recipe_id?: string
          sub_recipe_id?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_sub_recipe_id_fkey"
            columns: ["sub_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_types: {
        Row: {
          created_at: string
          display_order: number
          establishment_id: string
          icon: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          establishment_id: string
          icon?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          establishment_id?: string
          icon?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_types_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string | null
          establishment_id: string
          id: string
          is_preparation: boolean
          name: string
          portions: number | null
          recipe_type_id: string
          selling_price: number | null
          selling_price_mode: string
          updated_at: string
          yield_quantity: number | null
          yield_unit_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          establishment_id: string
          id?: string
          is_preparation?: boolean
          name: string
          portions?: number | null
          recipe_type_id: string
          selling_price?: number | null
          selling_price_mode?: string
          updated_at?: string
          yield_quantity?: number | null
          yield_unit_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          id?: string
          is_preparation?: boolean
          name?: string
          portions?: number | null
          recipe_type_id?: string
          selling_price?: number | null
          selling_price_mode?: string
          updated_at?: string
          yield_quantity?: number | null
          yield_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_recipe_type_id_fkey"
            columns: ["recipe_type_id"]
            isOneToOne: false
            referencedRelation: "recipe_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_yield_unit_id_fkey"
            columns: ["yield_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          access_level: Database["public"]["Enums"]["access_level"]
          created_at: string
          id: string
          module_key: string
          role_id: string
          scope: Database["public"]["Enums"]["permission_scope"]
          updated_at: string
        }
        Insert: {
          access_level?: Database["public"]["Enums"]["access_level"]
          created_at?: string
          id?: string
          module_key: string
          role_id: string
          scope?: Database["public"]["Enums"]["permission_scope"]
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["access_level"]
          created_at?: string
          id?: string
          module_key?: string
          role_id?: string
          scope?: Database["public"]["Enums"]["permission_scope"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_document_lines: {
        Row: {
          canonical_family: string
          canonical_label: string | null
          canonical_unit_id: string
          client_unit_id: string | null
          context_hash: string
          conversion_factor: number | null
          created_at: string
          delta_quantity_canonical: number
          document_id: string
          id: string
          input_payload: Json | null
          product_id: string
          source_line_id: string | null
          supplier_unit_id: string | null
          updated_at: string
        }
        Insert: {
          canonical_family: string
          canonical_label?: string | null
          canonical_unit_id: string
          client_unit_id?: string | null
          context_hash: string
          conversion_factor?: number | null
          created_at?: string
          delta_quantity_canonical: number
          document_id: string
          id?: string
          input_payload?: Json | null
          product_id: string
          source_line_id?: string | null
          supplier_unit_id?: string | null
          updated_at?: string
        }
        Update: {
          canonical_family?: string
          canonical_label?: string | null
          canonical_unit_id?: string
          client_unit_id?: string | null
          context_hash?: string
          conversion_factor?: number | null
          created_at?: string
          delta_quantity_canonical?: number
          document_id?: string
          id?: string
          input_payload?: Json | null
          product_id?: string
          source_line_id?: string | null
          supplier_unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_document_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_client_unit_id_fkey"
            columns: ["client_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_source_line_id_fkey"
            columns: ["source_line_id"]
            isOneToOne: false
            referencedRelation: "commande_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_supplier_unit_id_fkey"
            columns: ["supplier_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_documents: {
        Row: {
          corrects_document_id: string | null
          created_at: string
          created_by: string | null
          establishment_id: string
          id: string
          idempotency_key: string | null
          lock_version: number
          organization_id: string
          posted_at: string | null
          posted_by: string | null
          source_order_id: string | null
          status: Database["public"]["Enums"]["stock_document_status"]
          storage_zone_id: string
          supplier_id: string | null
          type: Database["public"]["Enums"]["stock_document_type"]
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          corrects_document_id?: string | null
          created_at?: string
          created_by?: string | null
          establishment_id: string
          id?: string
          idempotency_key?: string | null
          lock_version?: number
          organization_id: string
          posted_at?: string | null
          posted_by?: string | null
          source_order_id?: string | null
          status?: Database["public"]["Enums"]["stock_document_status"]
          storage_zone_id: string
          supplier_id?: string | null
          type: Database["public"]["Enums"]["stock_document_type"]
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          corrects_document_id?: string | null
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          id?: string
          idempotency_key?: string | null
          lock_version?: number
          organization_id?: string
          posted_at?: string | null
          posted_by?: string | null
          source_order_id?: string | null
          status?: Database["public"]["Enums"]["stock_document_status"]
          storage_zone_id?: string
          supplier_id?: string | null
          type?: Database["public"]["Enums"]["stock_document_type"]
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_corrects_document_id_fkey"
            columns: ["corrects_document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_events: {
        Row: {
          canonical_family: string
          canonical_label: string | null
          canonical_unit_id: string
          context_hash: string
          created_at: string
          delta_quantity_canonical: number
          document_id: string
          establishment_id: string
          event_reason: string
          event_type: Database["public"]["Enums"]["stock_event_type"]
          id: string
          organization_id: string
          override_flag: boolean
          override_reason: string | null
          posted_at: string
          posted_by: string | null
          product_id: string
          snapshot_version_id: string
          storage_zone_id: string
          voids_document_id: string | null
          voids_event_id: string | null
        }
        Insert: {
          canonical_family: string
          canonical_label?: string | null
          canonical_unit_id: string
          context_hash: string
          created_at?: string
          delta_quantity_canonical: number
          document_id: string
          establishment_id: string
          event_reason: string
          event_type: Database["public"]["Enums"]["stock_event_type"]
          id?: string
          organization_id: string
          override_flag?: boolean
          override_reason?: string | null
          posted_at?: string
          posted_by?: string | null
          product_id: string
          snapshot_version_id: string
          storage_zone_id: string
          voids_document_id?: string | null
          voids_event_id?: string | null
        }
        Update: {
          canonical_family?: string
          canonical_label?: string | null
          canonical_unit_id?: string
          context_hash?: string
          created_at?: string
          delta_quantity_canonical?: number
          document_id?: string
          establishment_id?: string
          event_reason?: string
          event_type?: Database["public"]["Enums"]["stock_event_type"]
          id?: string
          organization_id?: string
          override_flag?: boolean
          override_reason?: string | null
          posted_at?: string
          posted_by?: string | null
          product_id?: string
          snapshot_version_id?: string
          storage_zone_id?: string
          voids_document_id?: string | null
          voids_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_events_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_snapshot_version_id_fkey"
            columns: ["snapshot_version_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_voids_document_id_fkey"
            columns: ["voids_document_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_events_voids_event_id_fkey"
            columns: ["voids_event_id"]
            isOneToOne: false
            referencedRelation: "stock_events"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_monthly_snapshot_lines: {
        Row: {
          canonical_unit_id: string | null
          created_at: string
          id: string
          product_id: string
          quantity_canonical: number
          snapshot_id: string
          total_value_eur: number
          unit_price_eur: number
        }
        Insert: {
          canonical_unit_id?: string | null
          created_at?: string
          id?: string
          product_id: string
          quantity_canonical?: number
          snapshot_id: string
          total_value_eur?: number
          unit_price_eur?: number
        }
        Update: {
          canonical_unit_id?: string | null
          created_at?: string
          id?: string
          product_id?: string
          quantity_canonical?: number
          snapshot_id?: string
          total_value_eur?: number
          unit_price_eur?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_monthly_snapshot_lines_canonical_unit_id_fkey"
            columns: ["canonical_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_monthly_snapshot_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_monthly_snapshot_lines_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "stock_monthly_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_monthly_snapshots: {
        Row: {
          created_at: string
          created_by: string
          establishment_id: string
          id: string
          organization_id: string
          snapshot_date: string
          snapshot_version_id: string
          total_stock_value_eur: number
        }
        Insert: {
          created_at?: string
          created_by: string
          establishment_id: string
          id?: string
          organization_id: string
          snapshot_date: string
          snapshot_version_id: string
          total_stock_value_eur?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          establishment_id?: string
          id?: string
          organization_id?: string
          snapshot_date?: string
          snapshot_version_id?: string
          total_stock_value_eur?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_monthly_snapshots_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_monthly_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_zones: {
        Row: {
          code: string | null
          created_at: string
          display_order: number
          establishment_id: string
          id: string
          is_active: boolean
          name: string
          name_normalized: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          display_order?: number
          establishment_id: string
          id?: string
          is_active?: boolean
          name: string
          name_normalized: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          display_order?: number
          establishment_id?: string
          id?: string
          is_active?: boolean
          name?: string
          name_normalized?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_zones_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_zones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_extracted_products: {
        Row: {
          archived_at: string | null
          category: string | null
          conditioning: string
          created_at: string
          created_by: string | null
          establishment_id: string
          global_product_id: string | null
          id: string
          organization_id: string
          product_code: string | null
          product_name: string
          source: string
          status: string
          supplier_id: string
          supplier_product_code: string | null
          unit_of_sale: string | null
          unit_price: number
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          year_month: string
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          conditioning: string
          created_at?: string
          created_by?: string | null
          establishment_id: string
          global_product_id?: string | null
          id?: string
          organization_id: string
          product_code?: string | null
          product_name: string
          source?: string
          status?: string
          supplier_id: string
          supplier_product_code?: string | null
          unit_of_sale?: string | null
          unit_price: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          year_month: string
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          conditioning?: string
          created_at?: string
          created_by?: string | null
          establishment_id?: string
          global_product_id?: string | null
          id?: string
          organization_id?: string
          product_code?: string | null
          product_name?: string
          source?: string
          status?: string
          supplier_id?: string
          supplier_product_code?: string | null
          unit_of_sale?: string | null
          unit_price?: number
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_extracted_products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_extracted_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_extracted_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_extraction_profiles: {
        Row: {
          alias_hit_rate: number | null
          code_coverage_ratio: number | null
          created_at: string
          created_from_invoice_id: string | null
          establishment_id: string
          fields_corrected_count: number | null
          header_is_image_likely: boolean | null
          id: string
          last_ai_calls_count: number | null
          last_document_source: string | null
          last_import_at: string | null
          last_vision_triggered: boolean | null
          layout_hint: string | null
          match_by_code_rate: number | null
          organization_id: string
          preferred_language: string | null
          profile_json: Json
          schema_version: number
          status: string
          supplier_id: string
          total_invoice_count: number | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          vision_rescue_count: number | null
        }
        Insert: {
          alias_hit_rate?: number | null
          code_coverage_ratio?: number | null
          created_at?: string
          created_from_invoice_id?: string | null
          establishment_id: string
          fields_corrected_count?: number | null
          header_is_image_likely?: boolean | null
          id?: string
          last_ai_calls_count?: number | null
          last_document_source?: string | null
          last_import_at?: string | null
          last_vision_triggered?: boolean | null
          layout_hint?: string | null
          match_by_code_rate?: number | null
          organization_id: string
          preferred_language?: string | null
          profile_json?: Json
          schema_version?: number
          status?: string
          supplier_id: string
          total_invoice_count?: number | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          vision_rescue_count?: number | null
        }
        Update: {
          alias_hit_rate?: number | null
          code_coverage_ratio?: number | null
          created_at?: string
          created_from_invoice_id?: string | null
          establishment_id?: string
          fields_corrected_count?: number | null
          header_is_image_likely?: boolean | null
          id?: string
          last_ai_calls_count?: number | null
          last_document_source?: string | null
          last_import_at?: string | null
          last_vision_triggered?: boolean | null
          layout_hint?: string | null
          match_by_code_rate?: number | null
          organization_id?: string
          preferred_language?: string | null
          profile_json?: Json
          schema_version?: number
          status?: string
          supplier_id?: string
          total_invoice_count?: number | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          vision_rescue_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_extraction_profiles_created_from_invoice_id_fkey"
            columns: ["created_from_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_extraction_profiles_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_extraction_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_extraction_profiles_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_monthly_reconciliations: {
        Row: {
          created_at: string
          delta_total: number
          establishment_id: string
          id: string
          matched_count: number
          matched_total: number
          missing_count: number
          missing_total: number
          organization_id: string
          source_extraction_json: Json | null
          source_file_path: string | null
          statement_entry_count: number
          statement_total: number
          status: string
          supplier_id: string
          updated_at: string
          validated_at: string | null
          validated_by: string | null
          year_month: string
        }
        Insert: {
          created_at?: string
          delta_total?: number
          establishment_id: string
          id?: string
          matched_count?: number
          matched_total?: number
          missing_count?: number
          missing_total?: number
          organization_id: string
          source_extraction_json?: Json | null
          source_file_path?: string | null
          statement_entry_count?: number
          statement_total?: number
          status?: string
          supplier_id: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          year_month: string
        }
        Update: {
          created_at?: string
          delta_total?: number
          establishment_id?: string
          id?: string
          matched_count?: number
          matched_total?: number
          missing_count?: number
          missing_total?: number
          organization_id?: string
          source_extraction_json?: Json | null
          source_file_path?: string | null
          statement_entry_count?: number
          statement_total?: number
          status?: string
          supplier_id?: string
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_monthly_reconciliations_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_monthly_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_monthly_reconciliations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_name_aliases: {
        Row: {
          alias_norm: string
          alias_raw: string
          confidence: number
          created_at: string
          establishment_id: string
          first_seen_at: string
          hit_count: number
          id: string
          last_seen_at: string
          source: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          alias_norm: string
          alias_raw: string
          confidence?: number
          created_at?: string
          establishment_id: string
          first_seen_at?: string
          hit_count?: number
          id?: string
          last_seen_at?: string
          source?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          alias_norm?: string
          alias_raw?: string
          confidence?: number
          created_at?: string
          establishment_id?: string
          first_seen_at?: string
          hit_count?: number
          id?: string
          last_seen_at?: string
          source?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_name_aliases_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_name_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_aliases: {
        Row: {
          archived_at: string | null
          confidence_source: string
          created_at: string
          establishment_id: string
          global_product_id: string | null
          id: string
          last_seen_at: string | null
          normalized_key: string
          product_id: string
          raw_label_sample: string | null
          supplier_id: string
          supplier_product_code: string | null
          supplier_product_name: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          confidence_source?: string
          created_at?: string
          establishment_id: string
          global_product_id?: string | null
          id?: string
          last_seen_at?: string | null
          normalized_key: string
          product_id: string
          raw_label_sample?: string | null
          supplier_id: string
          supplier_product_code?: string | null
          supplier_product_name?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          confidence_source?: string
          created_at?: string
          establishment_id?: string
          global_product_id?: string | null
          id?: string
          last_seen_at?: string | null
          normalized_key?: string
          product_id?: string
          raw_label_sample?: string | null
          supplier_id?: string
          supplier_product_code?: string | null
          supplier_product_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_aliases_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_aliases_global_product_id_fkey"
            columns: ["global_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_extracted_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_category_hints: {
        Row: {
          category: string
          confidence_source: string
          created_at: string
          establishment_id: string
          hit_count: number
          id: string
          normalized_key: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          category: string
          confidence_source?: string
          created_at?: string
          establishment_id: string
          hit_count?: number
          id?: string
          normalized_key: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          confidence_source?: string
          created_at?: string
          establishment_id?: string
          hit_count?: number
          id?: string
          normalized_key?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_category_hints_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_category_hints_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      to_order_lines: {
        Row: {
          created_at: string
          created_by: string
          establishment_id: string
          id: string
          product_id: string
          product_name: string
          quantity: number
          status: string
          supplier_id: string
          unit_id: string
          validated_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          establishment_id: string
          id?: string
          product_id: string
          product_name?: string
          quantity: number
          status?: string
          supplier_id: string
          unit_id: string
          validated_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          establishment_id?: string
          id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          status?: string
          supplier_id?: string
          unit_id?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "to_order_lines_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "to_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "to_order_lines_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "invoice_suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "to_order_lines_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          created_at: string
          establishment_id: string | null
          factor: number
          from_unit_id: string
          id: string
          is_active: boolean
          to_unit_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          factor: number
          from_unit_id: string
          id?: string
          is_active?: boolean
          to_unit_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          factor?: number
          from_unit_id?: string
          id?: string
          is_active?: boolean
          to_unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_to_unit_id_fkey"
            columns: ["to_unit_id"]
            isOneToOne: false
            referencedRelation: "measurement_units"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badge_pins: {
        Row: {
          created_at: string
          id: string
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          created_at: string
          device_id: string
          device_name: string | null
          id: string
          is_active: boolean
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_name?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_establishments: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_establishments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          establishment_id: string | null
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_teams: {
        Row: {
          created_at: string
          establishment_id: string | null
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_teams_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_ai_scan_runs: {
        Row: {
          created_at: string
          created_by: string | null
          doc_type: string
          duration_ms: number | null
          error_message: string | null
          id: string
          insights_count: number
          items_count: number
          model_id: string
          model_label: string
          precision_mode: string
          result_bl: Json | null
          result_bl_items: Json | null
          result_insights: Json | null
          result_invoice: Json | null
          result_items: Json | null
          result_reconciliation: Json | null
          result_releve: Json | null
          result_releve_lines: Json | null
          scan_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_type?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          insights_count?: number
          items_count?: number
          model_id: string
          model_label: string
          precision_mode?: string
          result_bl?: Json | null
          result_bl_items?: Json | null
          result_insights?: Json | null
          result_invoice?: Json | null
          result_items?: Json | null
          result_reconciliation?: Json | null
          result_releve?: Json | null
          result_releve_lines?: Json | null
          scan_id: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_type?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          insights_count?: number
          items_count?: number
          model_id?: string
          model_label?: string
          precision_mode?: string
          result_bl?: Json | null
          result_bl_items?: Json | null
          result_insights?: Json | null
          result_invoice?: Json | null
          result_items?: Json | null
          result_reconciliation?: Json | null
          result_releve?: Json | null
          result_releve_lines?: Json | null
          scan_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_ai_scan_runs_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "vision_ai_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_ai_scans: {
        Row: {
          bl_number: string | null
          created_at: string
          created_by: string | null
          doc_type: string
          establishment_id: string
          file_size_bytes: number | null
          file_type: string
          id: string
          invoice_number: string | null
          last_run_at: string | null
          original_filename: string
          owner_id: string
          releve_period_end: string | null
          releve_period_start: string | null
          runs_count: number
          storage_path: string
          supplier_name: string | null
        }
        Insert: {
          bl_number?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          establishment_id: string
          file_size_bytes?: number | null
          file_type?: string
          id?: string
          invoice_number?: string | null
          last_run_at?: string | null
          original_filename: string
          owner_id: string
          releve_period_end?: string | null
          releve_period_start?: string | null
          runs_count?: number
          storage_path: string
          supplier_name?: string | null
        }
        Update: {
          bl_number?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          establishment_id?: string
          file_size_bytes?: number | null
          file_type?: string
          id?: string
          invoice_number?: string | null
          last_run_at?: string | null
          original_filename?: string
          owner_id?: string
          releve_period_end?: string | null
          releve_period_start?: string | null
          runs_count?: number
          storage_path?: string
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vision_ai_scans_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_ia_documents: {
        Row: {
          created_at: string
          error_message: string | null
          expires_at: string
          file_size: number
          file_type: string
          filename: string
          id: string
          owner_id: string
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          expires_at?: string
          file_size: number
          file_type: string
          filename: string
          id?: string
          owner_id: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          expires_at?: string
          file_size?: number
          file_type?: string
          filename?: string
          id?: string
          owner_id?: string
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      vision_ia_graphs: {
        Row: {
          created_at: string
          document_id: string
          graph_json: Json
          id: string
          owner_id: string
          schema_version: string
        }
        Insert: {
          created_at?: string
          document_id: string
          graph_json: Json
          id?: string
          owner_id: string
          schema_version?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          graph_json?: Json
          id?: string
          owner_id?: string
          schema_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_ia_graphs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "vision_ia_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_stock_snapshots: {
        Row: {
          activated_at: string
          activated_by: string | null
          created_at: string
          establishment_id: string
          id: string
          organization_id: string
          snapshot_version_id: string
          storage_zone_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string
          activated_by?: string | null
          created_at?: string
          establishment_id: string
          id?: string
          organization_id: string
          snapshot_version_id: string
          storage_zone_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string
          activated_by?: string | null
          created_at?: string
          establishment_id?: string
          id?: string
          organization_id?: string
          snapshot_version_id?: string
          storage_zone_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_stock_snapshots_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_stock_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_stock_snapshots_snapshot_version_id_fkey"
            columns: ["snapshot_version_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_stock_snapshots_storage_zone_id_fkey"
            columns: ["storage_zone_id"]
            isOneToOne: false
            referencedRelation: "storage_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      badge_events_integrity_check: {
        Row: {
          cnt: number | null
          day_date: string | null
          establishment_id: string | null
          event_type: string | null
          sequence_index: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "badge_events_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_exists: { Args: never; Returns: boolean }
      can_write_cash: { Args: { _user_id: string }; Returns: boolean }
      compute_supplier_maturity: {
        Args: { p_establishment_id: string; p_supplier_id: string }
        Returns: Json
      }
      export_products_csv: { Args: never; Returns: string }
      fn_abandon_stale_drafts:
        | { Args: never; Returns: number }
        | {
            Args: {
              p_establishment_id: string
              p_storage_zone_id: string
              p_type: string
            }
            Returns: number
          }
      fn_archive_product_v2: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      fn_cancel_b2b_shipment: {
        Args: { p_commande_id: string; p_user_id: string }
        Returns: Json
      }
      fn_complete_inventory_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      fn_convert_b2b_quantity: {
        Args: {
          p_client_quantity: number
          p_client_unit_id: string
          p_product_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["b2b_conversion_result"]
        SetofOptions: {
          from: "*"
          to: "b2b_conversion_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_convert_line_unit_price: {
        Args: {
          p_from_unit_id: string
          p_price_source: number
          p_product_id: string
          p_to_unit_id: string
        }
        Returns: Json
      }
      fn_correct_bl_withdrawal: {
        Args: {
          p_bl_retrait_document_id: string
          p_establishment_id: string
          p_lines: Json
          p_organization_id: string
          p_original_stock_document_id: string
          p_storage_zone_id: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_create_bl_withdrawal: {
        Args: {
          p_created_by?: string
          p_destination_establishment_id?: string
          p_destination_name?: string
          p_establishment_id: string
          p_lines?: Json
          p_organization_id: string
          p_stock_document_id: string
        }
        Returns: Json
      }
      fn_create_product_complete: {
        Args: {
          p_allow_unit_sale?: boolean
          p_category_id?: string
          p_code_barres?: string
          p_code_produit?: string
          p_conditionnement_config?: Json
          p_conditionnement_resume?: string
          p_delivery_unit_id?: string
          p_dlc_warning_days?: number
          p_establishment_id: string
          p_final_unit_id?: string
          p_final_unit_price?: number
          p_info_produit?: string
          p_initial_stock_quantity?: number
          p_initial_stock_unit_id?: string
          p_internal_mode?: string
          p_internal_preferred_unit_id?: string
          p_internal_unit_chain?: Json
          p_kitchen_unit_id?: string
          p_min_stock_quantity_canonical?: number
          p_min_stock_unit_id?: string
          p_name_normalized: string
          p_nom_produit: string
          p_price_display_unit_id?: string
          p_purchase_mode?: string
          p_purchase_preferred_unit_id?: string
          p_purchase_unit_chain?: Json
          p_reception_mode?: string
          p_reception_preferred_unit_id?: string
          p_reception_unit_chain?: Json
          p_stock_handling_unit_id?: string
          p_storage_zone_id?: string
          p_supplier_billing_line_total?: number
          p_supplier_billing_quantity?: number
          p_supplier_billing_unit_id?: string
          p_supplier_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_create_recipe_full: {
        Args: {
          _created_by: string
          _establishment_id: string
          _is_preparation?: boolean
          _lines?: Json
          _name: string
          _portions?: number
          _recipe_type_id: string
          _selling_price?: number
          _selling_price_mode?: string
          _yield_quantity?: number
          _yield_unit_id?: string
        }
        Returns: string
      }
      fn_create_recipe_with_lines:
        | {
            Args: {
              _created_by: string
              _establishment_id: string
              _lines?: Json
              _name: string
              _recipe_type_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _created_by: string
              _establishment_id: string
              _lines?: Json
              _name: string
              _portions?: number
              _recipe_type_id: string
            }
            Returns: string
          }
      fn_delete_invoice: {
        Args: { p_invoice_id: string; p_user_id?: string }
        Returns: Json
      }
      fn_generate_app_invoice: {
        Args: { p_commande_id: string; p_user_id: string }
        Returns: Json
      }
      fn_get_b2b_catalogue: {
        Args: { p_client_establishment_id: string; p_partnership_id: string }
        Returns: Json
      }
      fn_get_b2b_followed_recipes: {
        Args: { _establishment_id: string }
        Returns: {
          b2b_price: number
          followed_at: string
          id: string
          listing_id: string
          partnership_id: string
          portions: number
          recipe_name: string
          recipe_type_icon: string
          recipe_type_name: string
          supplier_name: string
        }[]
      }
      fn_get_b2b_partner_profile: {
        Args: { p_partner_establishment_id: string }
        Returns: Json
      }
      fn_get_b2b_recipe_catalogue: {
        Args: { _supplier_establishment_id: string }
        Returns: {
          b2b_price: number
          is_followed: boolean
          listing_id: string
          portions: number
          recipe_id: string
          recipe_name: string
          recipe_type_icon: string
          recipe_type_name: string
        }[]
      }
      fn_get_b2b_source_input_config: {
        Args: {
          _client_establishment_id: string
          _source_establishment_id: string
          _source_product_id: string
        }
        Returns: Json
      }
      fn_get_b2b_supplier_stock: {
        Args: {
          p_client_establishment_id: string
          p_partnership_id: string
          p_supplier_establishment_id: string
        }
        Returns: Json
      }
      fn_get_group_members: {
        Args: { p_establishment_id: string; p_product_id: string }
        Returns: {
          carrier_product_id: string
          group_display_name: string
          group_id: string
          is_carrier: boolean
          is_mutualized: boolean
          member_product_id: string
        }[]
      }
      fn_get_packaging_signature: {
        Args: { p_product_id: string }
        Returns: Json
      }
      fn_hard_delete_product_v2: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      fn_health_check_cross_tenant_uuids: {
        Args: { p_establishment_id?: string }
        Returns: {
          establishment_id: string
          establishment_name: string
          foreign_uuid: string
          product_id: string
          product_name: string
          uuid_location: string
        }[]
      }
      fn_health_check_stock_integrity: { Args: never; Returns: Json }
      fn_import_b2b_product_atomic:
        | {
            Args: {
              p_category: string
              p_category_id: string
              p_code_produit: string
              p_conditionnement_config: Json
              p_conditionnement_resume: string
              p_delivery_unit_id: string
              p_establishment_id: string
              p_final_unit_id: string
              p_final_unit_price: number
              p_kitchen_unit_id: string
              p_min_stock_quantity_canonical: number
              p_min_stock_unit_id: string
              p_name_normalized: string
              p_nom_produit: string
              p_price_display_unit_id: string
              p_source_establishment_id: string
              p_source_product_id: string
              p_stock_handling_unit_id: string
              p_storage_zone_id: string
              p_supplier_billing_line_total?: number
              p_supplier_billing_quantity?: number
              p_supplier_billing_unit_id: string
              p_supplier_id: string
              p_user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_category: string
              p_category_id: string
              p_code_produit: string
              p_conditionnement_config: Json
              p_conditionnement_resume: string
              p_delivery_unit_id: string
              p_establishment_id: string
              p_final_unit_id: string
              p_final_unit_price: number
              p_kitchen_unit_id: string
              p_min_stock_quantity_canonical: number
              p_min_stock_unit_id: string
              p_name_normalized: string
              p_nom_produit: string
              p_price_display_unit_id: string
              p_source_establishment_id: string
              p_source_product_id: string
              p_stock_handling_unit_id: string
              p_storage_zone_id: string
              p_supplier_billing_line_total?: number
              p_supplier_billing_quantity?: number
              p_supplier_billing_unit_id: string
              p_supplier_id: string
              p_unit_mapping?: Json
              p_user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_allow_unit_sale?: boolean
              p_category: string
              p_category_id: string
              p_code_produit: string
              p_conditionnement_config: Json
              p_conditionnement_resume: string
              p_delivery_unit_id: string
              p_establishment_id: string
              p_final_unit_id: string
              p_final_unit_price: number
              p_kitchen_unit_id: string
              p_min_stock_quantity_canonical: number
              p_min_stock_unit_id: string
              p_name_normalized: string
              p_nom_produit: string
              p_price_display_unit_id: string
              p_source_establishment_id: string
              p_source_product_id: string
              p_stock_handling_unit_id: string
              p_storage_zone_id: string
              p_supplier_billing_line_total?: number
              p_supplier_billing_quantity?: number
              p_supplier_billing_unit_id: string
              p_supplier_id: string
              p_unit_mapping?: Json
              p_user_id: string
            }
            Returns: string
          }
      fn_initialize_product_stock: {
        Args: {
          p_initial_quantity?: number
          p_product_id: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_log_conversion_error: {
        Args: {
          p_client_unit_id: string
          p_establishment_id: string
          p_flow?: string
          p_product_id: string
        }
        Returns: undefined
      }
      fn_next_bl_withdrawal_number: {
        Args: { p_establishment_id: string }
        Returns: string
      }
      fn_open_commande: {
        Args: { p_commande_id: string; p_user_id: string }
        Returns: Json
      }
      fn_phase0_stock_zero_v2: { Args: never; Returns: Json }
      fn_post_b2b_reception: {
        Args: {
          p_client_establishment_id: string
          p_client_organization_id: string
          p_client_user_id: string
          p_order_id: string
          p_validated_lines: Json
        }
        Returns: Json
      }
      fn_post_stock_document: {
        Args: {
          p_document_id: string
          p_event_reason?: string
          p_expected_lock_version: number
          p_idempotency_key?: string
          p_override_flag?: boolean
          p_override_reason?: string
          p_posted_by?: string
        }
        Returns: Json
      }
      fn_product_has_stock: { Args: { p_product_id: string }; Returns: boolean }
      fn_product_unit_price_factor: {
        Args: {
          p_from_unit_id: string
          p_product_id: string
          p_to_unit_id: string
        }
        Returns: number
      }
      fn_quick_adjustment: {
        Args: {
          p_canonical_family: string
          p_canonical_label?: string
          p_canonical_unit_id: string
          p_context_hash?: string
          p_establishment_id: string
          p_estimated_qty: number
          p_organization_id: string
          p_product_id: string
          p_storage_zone_id: string
          p_target_qty: number
          p_user_id?: string
        }
        Returns: Json
      }
      fn_receive_commande: {
        Args: { p_commande_id: string; p_lines: Json; p_user_id: string }
        Returns: Json
      }
      fn_receive_commande_plat: {
        Args: { p_commande_plat_id: string; p_lines: Json; p_user_id: string }
        Returns: Json
      }
      fn_redeem_b2b_code: {
        Args: { p_client_establishment_id: string; p_code: string }
        Returns: Json
      }
      fn_replace_invoice: {
        Args: {
          p_amount_eur?: number
          p_establishment_id: string
          p_file_name?: string
          p_file_path?: string
          p_file_size?: number
          p_file_type?: string
          p_idempotency_key: string
          p_invoice_date?: string
          p_invoice_number?: string
          p_old_invoice_id: string
          p_organization_id: string
          p_supplier_id: string
          p_supplier_name?: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_resolve_litige: {
        Args: { p_litige_id: string; p_user_id: string }
        Returns: Json
      }
      fn_resolve_litige_plat: {
        Args: { p_litige_plat_id: string; p_user_id: string }
        Returns: Json
      }
      fn_save_product_wizard:
        | {
            Args: {
              p_canonical_family?: string
              p_canonical_unit_id?: string
              p_category: string
              p_category_id?: string
              p_code_produit: string
              p_conditionnement_config: Json
              p_conditionnement_resume: string
              p_context_hash?: string
              p_delivery_unit_id: string
              p_dlc_warning_days?: number
              p_estimated_qty?: number
              p_expected_updated_at?: string
              p_final_unit_id: string
              p_final_unit_price: number
              p_kitchen_unit_id: string
              p_min_stock_quantity_canonical: number
              p_min_stock_unit_id: string
              p_name_normalized: string
              p_new_zone_id: string
              p_nom_produit: string
              p_old_zone_id: string
              p_price_display_unit_id: string
              p_product_id: string
              p_stock_handling_unit_id: string
              p_supplier_billing_line_total?: number
              p_supplier_billing_quantity?: number
              p_supplier_billing_unit_id: string
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_allow_unit_sale?: boolean
              p_canonical_family?: string
              p_canonical_unit_id?: string
              p_category: string
              p_category_id?: string
              p_code_produit: string
              p_conditionnement_config: Json
              p_conditionnement_resume: string
              p_context_hash?: string
              p_delivery_unit_id: string
              p_dlc_warning_days?: number
              p_estimated_qty?: number
              p_expected_updated_at?: string
              p_final_unit_id: string
              p_final_unit_price: number
              p_kitchen_unit_id: string
              p_min_stock_quantity_canonical: number
              p_min_stock_unit_id: string
              p_name_normalized: string
              p_new_zone_id: string
              p_nom_produit: string
              p_old_zone_id: string
              p_price_display_unit_id: string
              p_product_id: string
              p_stock_handling_unit_id: string
              p_supplier_billing_line_total?: number
              p_supplier_billing_quantity?: number
              p_supplier_billing_unit_id: string
              p_user_id: string
            }
            Returns: Json
          }
      fn_send_commande: { Args: { p_commande_id: string }; Returns: Json }
      fn_send_commande_notification: {
        Args: {
          p_alert_type: string
          p_body: string
          p_establishment_id: string
          p_order_id: string
          p_source_establishment_name?: string
          p_title: string
        }
        Returns: number
      }
      fn_ship_commande: {
        Args: { p_commande_id: string; p_lines: Json; p_user_id: string }
        Returns: Json
      }
      fn_ship_commande_plat: {
        Args: { p_commande_plat_id: string; p_lines: Json; p_user_id: string }
        Returns: Json
      }
      fn_transfer_product_zone: {
        Args: {
          p_canonical_family?: string
          p_canonical_unit_id?: string
          p_context_hash?: string
          p_estimated_qty?: number
          p_new_zone_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: Json
      }
      fn_void_stock_document: {
        Args: {
          p_document_id: string
          p_void_reason: string
          p_voided_by: string
        }
        Returns: Json
      }
      generate_supplier_invitation: {
        Args: { p_supplier_establishment_id: string }
        Returns: Json
      }
      get_business_day: { Args: { _ts?: string }; Returns: string }
      get_imported_supplier_products: {
        Args: {
          p_client_establishment_id: string
          p_supplier_establishment_id: string
        }
        Returns: {
          category: string
          code_barres: string
          code_produit: string
          conditionnement_config: Json
          conditionnement_resume: string
          delivery_unit_id: string
          final_unit: string
          final_unit_id: string
          final_unit_price: number
          id: string
          info_produit: string
          kitchen_unit_id: string
          min_stock_quantity_canonical: number
          min_stock_unit_id: string
          nom_produit: string
          price_display_unit_id: string
          stock_handling_unit_id: string
          storage_zone_id: string
          storage_zone_name: string
          supplier_billing_unit: string
          supplier_billing_unit_id: string
        }[]
      }
      get_my_permissions: { Args: never; Returns: Json }
      get_my_permissions_v2: {
        Args: { _establishment_id: string }
        Returns: Json
      }
      get_service_day: {
        Args: { _establishment_id: string; _ts?: string }
        Returns: string
      }
      get_service_day_now: {
        Args: { _establishment_id: string }
        Returns: string
      }
      get_user_establishment_ids: { Args: never; Returns: string[] }
      get_user_organization_id: { Args: never; Returns: string }
      has_alertes_read_access: { Args: { _user_id: string }; Returns: boolean }
      has_cash_permission: {
        Args: {
          _scope: Database["public"]["Enums"]["permission_scope"]
          _user_id: string
        }
        Returns: boolean
      }
      has_module_access: {
        Args: {
          _establishment_id: string
          _min_level: Database["public"]["Enums"]["access_level"]
          _module_key: string
        }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      increment_counted_products: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_platform_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      normalize_supplier_name: { Args: { raw_name: string }; Returns: string }
      planning_create_shift_atomic: {
        Args: {
          p_break_minutes: number
          p_end_time: string
          p_establishment_id: string
          p_net_minutes: number
          p_organization_id: string
          p_shift_date: string
          p_start_time: string
          p_user_id: string
        }
        Returns: Json
      }
      platform_create_organization_wizard: {
        Args: { p_payload: Json }
        Returns: Json
      }
      platform_delete_organization: { Args: { _org_id: string }; Returns: Json }
      platform_get_establishment_profile: {
        Args: { p_establishment_id: string }
        Returns: Json
      }
      platform_get_kpis: { Args: never; Returns: Json }
      platform_list_establishment_users: {
        Args: { _establishment_id: string }
        Returns: Json
      }
      platform_list_establishments: { Args: { _org_id: string }; Returns: Json }
      platform_list_modules: { Args: never; Returns: Json }
      platform_list_organizations: { Args: never; Returns: Json }
      platform_rename_organization: {
        Args: { _new_name: string; _org_id: string }
        Returns: Json
      }
      platform_upsert_establishment_profile: {
        Args: { p_establishment_id: string; p_payload: Json }
        Returns: Json
      }
      resolve_commande_actors: {
        Args: { p_ids: Json }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      resolve_establishment_by_name: {
        Args: { p_name: string }
        Returns: string
      }
      start_impersonation: {
        Args: { _target_establishment_id: string; _target_user_id: string }
        Returns: Json
      }
      stop_impersonation: { Args: never; Returns: Json }
      user_belongs_to_establishment: {
        Args: { _est_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      access_level: "none" | "read" | "write" | "full"
      commande_status:
        | "brouillon"
        | "envoyee"
        | "ouverte"
        | "expediee"
        | "litige"
        | "recue"
        | "cloturee"
      discrepancy_status: "open" | "analyzed" | "closed"
      establishment_status: "active" | "archived"
      incident_status: "OPEN" | "RESOLVED"
      inventory_status: "en_cours" | "en_pause" | "termine" | "annule"
      invitation_status:
        | "invited"
        | "requested"
        | "accepted"
        | "rejected"
        | "canceled"
        | "expired"
      permission_scope:
        | "self"
        | "team"
        | "establishment"
        | "org"
        | "caisse_day"
        | "caisse_month"
      return_resolution: "avoir" | "remplacement" | "retour_physique"
      return_status: "pending" | "accepted" | "refused"
      return_type:
        | "mauvais_produit"
        | "produit_en_plus"
        | "produit_casse"
        | "dlc_depassee"
        | "dlc_trop_proche"
        | "non_conforme"
      stock_document_status: "DRAFT" | "POSTED" | "VOID" | "ABANDONED"
      stock_document_type:
        | "RECEIPT"
        | "WITHDRAWAL"
        | "ADJUSTMENT"
        | "RECEIPT_CORRECTION"
        | "INITIAL_STOCK"
      stock_event_type:
        | "RECEIPT"
        | "WITHDRAWAL"
        | "ADJUSTMENT"
        | "VOID"
        | "INITIAL_STOCK"
      user_status: "invited" | "requested" | "active" | "disabled" | "rejected"
    }
    CompositeTypes: {
      b2b_conversion_result: {
        supplier_unit_id: string | null
        supplier_quantity: number | null
        supplier_family: string | null
        status: string | null
      }
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
      access_level: ["none", "read", "write", "full"],
      commande_status: [
        "brouillon",
        "envoyee",
        "ouverte",
        "expediee",
        "litige",
        "recue",
        "cloturee",
      ],
      discrepancy_status: ["open", "analyzed", "closed"],
      establishment_status: ["active", "archived"],
      incident_status: ["OPEN", "RESOLVED"],
      inventory_status: ["en_cours", "en_pause", "termine", "annule"],
      invitation_status: [
        "invited",
        "requested",
        "accepted",
        "rejected",
        "canceled",
        "expired",
      ],
      permission_scope: [
        "self",
        "team",
        "establishment",
        "org",
        "caisse_day",
        "caisse_month",
      ],
      return_resolution: ["avoir", "remplacement", "retour_physique"],
      return_status: ["pending", "accepted", "refused"],
      return_type: [
        "mauvais_produit",
        "produit_en_plus",
        "produit_casse",
        "dlc_depassee",
        "dlc_trop_proche",
        "non_conforme",
      ],
      stock_document_status: ["DRAFT", "POSTED", "VOID", "ABANDONED"],
      stock_document_type: [
        "RECEIPT",
        "WITHDRAWAL",
        "ADJUSTMENT",
        "RECEIPT_CORRECTION",
        "INITIAL_STOCK",
      ],
      stock_event_type: [
        "RECEIPT",
        "WITHDRAWAL",
        "ADJUSTMENT",
        "VOID",
        "INITIAL_STOCK",
      ],
      user_status: ["invited", "requested", "active", "disabled", "rejected"],
    },
  },
} as const
