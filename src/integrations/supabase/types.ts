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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_recovery_codes: {
        Row: {
          batch_id: string
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          batch_id: string
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      amenity_categories: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          display_order?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      amenity_options: {
        Row: {
          active: boolean
          allowed_ride_types: string[]
          category_id: string | null
          code: string
          complimentary: boolean
          created_at: string
          currency: string
          description: string | null
          display_order: number
          icon: string | null
          id: string
          image_url: string | null
          internal_cost_cents: number | null
          inventory_note: string | null
          name: string
          price_delta_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_ride_types?: string[]
          category_id?: string | null
          code: string
          complimentary?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          image_url?: string | null
          internal_cost_cents?: number | null
          inventory_note?: string | null
          name: string
          price_delta_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_ride_types?: string[]
          category_id?: string | null
          code?: string
          complimentary?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          image_url?: string | null
          internal_cost_cents?: number | null
          inventory_note?: string | null
          name?: string
          price_delta_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_options_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "amenity_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          consent_version: string | null
          created_at: string
          id: string
          name: string
          props: Json
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          consent_version?: string | null
          created_at?: string
          id?: string
          name: string
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          consent_version?: string | null
          created_at?: string
          id?: string
          name?: string
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          next: Json | null
          previous: Json | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          next?: Json | null
          previous?: Json | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          next?: Json | null
          previous?: Json | null
          reason?: string | null
        }
        Relationships: []
      }
      booking_amenities: {
        Row: {
          amenity_code: string
          amenity_name: string
          amenity_option_id: string
          booking_id: string
          complimentary: boolean
          created_at: string
          currency: string
          id: string
          price_delta_cents: number
          quantity: number
        }
        Insert: {
          amenity_code: string
          amenity_name: string
          amenity_option_id: string
          booking_id: string
          complimentary?: boolean
          created_at?: string
          currency?: string
          id?: string
          price_delta_cents?: number
          quantity?: number
        }
        Update: {
          amenity_code?: string
          amenity_name?: string
          amenity_option_id?: string
          booking_id?: string
          complimentary?: boolean
          created_at?: string
          currency?: string
          id?: string
          price_delta_cents?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_amenities_amenity_option_id_fkey"
            columns: ["amenity_option_id"]
            isOneToOne: false
            referencedRelation: "amenity_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_amenities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_amenities_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      booking_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          booking_id: string
          created_at: string
          dispatch_status: Database["public"]["Enums"]["dispatch_status"]
          driver_id: string | null
          id: string
          is_current: boolean
          note: string | null
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          booking_id: string
          created_at?: string
          dispatch_status?: Database["public"]["Enums"]["dispatch_status"]
          driver_id?: string | null
          id?: string
          is_current?: boolean
          note?: string | null
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          booking_id?: string
          created_at?: string
          dispatch_status?: Database["public"]["Enums"]["dispatch_status"]
          driver_id?: string | null
          id?: string
          is_current?: boolean
          note?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_pins: {
        Row: {
          attempts: number
          booking_id: string
          created_at: string
          locked_until: string | null
          pin_hash: string
          pin_plain: string | null
          salt: string
        }
        Insert: {
          attempts?: number
          booking_id: string
          created_at?: string
          locked_until?: string | null
          pin_hash: string
          pin_plain?: string | null
          salt: string
        }
        Update: {
          attempts?: number
          booking_id?: string
          created_at?: string
          locked_until?: string | null
          pin_hash?: string
          pin_plain?: string | null
          salt?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_pins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_pins_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      bookings: {
        Row: {
          created_at: string
          distance_km: number | null
          driver_id: string | null
          dropoff: string
          dropoff_components: Json | null
          dropoff_lat: number | null
          dropoff_lng: number | null
          dropoff_place_id: string | null
          id: string
          notes: string | null
          paid: boolean
          paid_at: string | null
          passenger_id: string
          passengers: number
          pickup: string
          pickup_components: Json | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_place_id: string | null
          pickup_time: string
          price: number | null
          receipt_url: string | null
          ride_type: Database["public"]["Enums"]["ride_type"]
          status: Database["public"]["Enums"]["booking_status"]
          stripe_session_id: string | null
          suggested_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          driver_id?: string | null
          dropoff: string
          dropoff_components?: Json | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_place_id?: string | null
          id?: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          passenger_id: string
          passengers?: number
          pickup: string
          pickup_components?: Json | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_place_id?: string | null
          pickup_time: string
          price?: number | null
          receipt_url?: string | null
          ride_type?: Database["public"]["Enums"]["ride_type"]
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_session_id?: string | null
          suggested_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          driver_id?: string | null
          dropoff?: string
          dropoff_components?: Json | null
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          dropoff_place_id?: string | null
          id?: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          passenger_id?: string
          passengers?: number
          pickup?: string
          pickup_components?: Json | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_place_id?: string | null
          pickup_time?: string
          price?: number | null
          receipt_url?: string | null
          ride_type?: Database["public"]["Enums"]["ride_type"]
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_session_id?: string | null
          suggested_price?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      cancellation_policies: {
        Row: {
          active: boolean
          admin_review_required: boolean
          allow_cancellation_inside_cutoff: boolean
          created_at: string
          created_by: string | null
          customer_summary: string
          effective_at: string
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string
          free_cancellation_cutoff_hours: number
          free_cancellation_enabled: boolean
          id: string
          internal_notes: string | null
          late_cancellation_enabled: boolean
          name: string
          policy_key: string
          service_type: string
          version: number
        }
        Insert: {
          active?: boolean
          admin_review_required?: boolean
          allow_cancellation_inside_cutoff?: boolean
          created_at?: string
          created_by?: string | null
          customer_summary: string
          effective_at?: string
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type: string
          free_cancellation_cutoff_hours?: number
          free_cancellation_enabled?: boolean
          id?: string
          internal_notes?: string | null
          late_cancellation_enabled?: boolean
          name: string
          policy_key: string
          service_type?: string
          version: number
        }
        Update: {
          active?: boolean
          admin_review_required?: boolean
          allow_cancellation_inside_cutoff?: boolean
          created_at?: string
          created_by?: string | null
          customer_summary?: string
          effective_at?: string
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string
          free_cancellation_cutoff_hours?: number
          free_cancellation_enabled?: boolean
          id?: string
          internal_notes?: string | null
          late_cancellation_enabled?: boolean
          name?: string
          policy_key?: string
          service_type?: string
          version?: number
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          agent_name: string | null
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          translation_en: string | null
          translation_tr: string | null
          user_id: string | null
          user_language: string | null
        }
        Insert: {
          agent_name?: string | null
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          translation_en?: string | null
          translation_tr?: string | null
          user_id?: string | null
          user_language?: string | null
        }
        Update: {
          agent_name?: string | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          translation_en?: string | null
          translation_tr?: string | null
          user_id?: string | null
          user_language?: string | null
        }
        Relationships: []
      }
      communication_events: {
        Row: {
          booking_id: string
          channel: Database["public"]["Enums"]["comm_channel"]
          direction: Database["public"]["Enums"]["comm_direction"]
          driver_id: string | null
          duration_sec: number
          id: string
          started_at: string
          status: Database["public"]["Enums"]["comm_status"]
        }
        Insert: {
          booking_id: string
          channel?: Database["public"]["Enums"]["comm_channel"]
          direction: Database["public"]["Enums"]["comm_direction"]
          driver_id?: string | null
          duration_sec?: number
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["comm_status"]
        }
        Update: {
          booking_id?: string
          channel?: Database["public"]["Enums"]["comm_channel"]
          direction?: Database["public"]["Enums"]["comm_direction"]
          driver_id?: string | null
          duration_sec?: number
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["comm_status"]
        }
        Relationships: [
          {
            foreignKeyName: "communication_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "communication_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      concierge_sessions: {
        Row: {
          agent: string
          last_active_at: string
          user_id: string
        }
        Insert: {
          agent: string
          last_active_at?: string
          user_id: string
        }
        Update: {
          agent?: string
          last_active_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cookie_consents: {
        Row: {
          categories: Json
          granted_at: string
          id: string
          ip_hash: string | null
          policy_ver: string
          session_key: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          categories: Json
          granted_at?: string
          id?: string
          ip_hash?: string | null
          policy_ver: string
          session_key: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          categories?: Json
          granted_at?: string
          id?: string
          ip_hash?: string | null
          policy_ver?: string
          session_key?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      discount_rules: {
        Row: {
          active: boolean
          created_at: string
          flat_off: number | null
          id: string
          max_miles: number
          min_miles: number
          percent_off: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          flat_off?: number | null
          id?: string
          max_miles?: number
          min_miles?: number
          percent_off?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          flat_off?: number | null
          id?: string
          max_miles?: number
          min_miles?: number
          percent_off?: number | null
        }
        Relationships: []
      }
      driver_documents: {
        Row: {
          created_at: string
          document_number: string | null
          driver_id: string
          expires_at: string | null
          file_url: string | null
          id: string
          issued_at: string | null
          kind: Database["public"]["Enums"]["driver_document_kind"]
          notes: string | null
          status: Database["public"]["Enums"]["driver_document_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_number?: string | null
          driver_id: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          issued_at?: string | null
          kind: Database["public"]["Enums"]["driver_document_kind"]
          notes?: string | null
          status?: Database["public"]["Enums"]["driver_document_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_number?: string | null
          driver_id?: string
          expires_at?: string | null
          file_url?: string | null
          id?: string
          issued_at?: string | null
          kind?: Database["public"]["Enums"]["driver_document_kind"]
          notes?: string | null
          status?: Database["public"]["Enums"]["driver_document_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_profiles: {
        Row: {
          assigned_vehicle_id: string | null
          availability_status: Database["public"]["Enums"]["driver_availability"]
          created_at: string
          email: string | null
          employee_id: string
          employment_status: Database["public"]["Enums"]["employment_status"]
          full_name: string
          id: string
          license_expires_at: string | null
          license_number: string | null
          notes: string | null
          phone: string | null
          photo_url: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_vehicle_id?: string | null
          availability_status?: Database["public"]["Enums"]["driver_availability"]
          created_at?: string
          email?: string | null
          employee_id: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name: string
          id?: string
          license_expires_at?: string | null
          license_number?: string | null
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_vehicle_id?: string | null
          availability_status?: Database["public"]["Enums"]["driver_availability"]
          created_at?: string
          email?: string | null
          employee_id?: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name?: string
          id?: string
          license_expires_at?: string | null
          license_number?: string | null
          notes?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_profiles_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_trip_events: {
        Row: {
          assignment_id: string
          created_at: string
          driver_id: string
          event: Database["public"]["Enums"]["driver_trip_event_kind"]
          id: string
          payload: Json
          reason: string | null
        }
        Insert: {
          assignment_id: string
          created_at?: string
          driver_id: string
          event: Database["public"]["Enums"]["driver_trip_event_kind"]
          id?: string
          payload?: Json
          reason?: string | null
        }
        Update: {
          assignment_id?: string
          created_at?: string
          driver_id?: string
          event?: Database["public"]["Enums"]["driver_trip_event_kind"]
          id?: string
          payload?: Json
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_trip_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "booking_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_trip_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_unavailability: {
        Row: {
          created_at: string
          driver_id: string
          ends_at: string
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["unavailability_reason"]
          starts_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          ends_at: string
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["unavailability_reason"]
          starts_at: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          ends_at?: string
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["unavailability_reason"]
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_unavailability_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active_booking_id: string | null
          current_lat: number | null
          current_lng: number | null
          id: string
          is_online: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          active_booking_id?: string | null
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_online?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          active_booking_id?: string | null
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_online?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_active_booking_id_fkey"
            columns: ["active_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_active_booking_id_fkey"
            columns: ["active_booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          booking_id: string | null
          created_at: string
          error: string | null
          id: string
          locale: string
          meta: Json
          provider: string | null
          provider_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          template: string
          to_email: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          meta?: Json
          provider?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template: string
          to_email: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          meta?: Json
          provider?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      incidents: {
        Row: {
          admin_notes: string | null
          booking_id: string | null
          category: Database["public"]["Enums"]["incident_category"]
          created_at: string
          description: string
          driver_id: string | null
          id: string
          photo_urls: string[]
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          status: Database["public"]["Enums"]["incident_status"]
        }
        Insert: {
          admin_notes?: string | null
          booking_id?: string | null
          category: Database["public"]["Enums"]["incident_category"]
          created_at?: string
          description: string
          driver_id?: string | null
          id?: string
          photo_urls?: string[]
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
        }
        Update: {
          admin_notes?: string | null
          booking_id?: string | null
          category?: Database["public"]["Enums"]["incident_category"]
          created_at?: string
          description?: string
          driver_id?: string | null
          id?: string
          photo_urls?: string[]
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
        }
        Relationships: [
          {
            foreignKeyName: "incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "incidents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_health: {
        Row: {
          checked_at: string
          created_at: string
          details: Json
          id: string
          integration: string
          latency_ms: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          created_at?: string
          details?: Json
          id?: string
          integration: string
          latency_ms?: number | null
          status: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          details?: Json
          id?: string
          integration?: string
          latency_ms?: number | null
          status?: string
        }
        Relationships: []
      }
      invitation_cooldowns: {
        Row: {
          created_at: string
          email_key: string
          last_actor_id: string | null
          last_sent_at: string
          send_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_key: string
          last_actor_id?: string | null
          last_sent_at?: string
          send_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_key?: string
          last_actor_id?: string | null
          last_sent_at?: string
          send_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          id: string
          kind: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          kind: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          kind?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          created_at: string
          effective_at: string
          id: string
          kind: string
          summary: string
          version: string
        }
        Insert: {
          created_at?: string
          effective_at?: string
          id?: string
          kind: string
          summary?: string
          version: string
        }
        Update: {
          created_at?: string
          effective_at?: string
          id?: string
          kind?: string
          summary?: string
          version?: string
        }
        Relationships: []
      }
      monitoring_events: {
        Row: {
          context: Json
          created_at: string
          id: string
          message: string
          request_id: string | null
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          message: string
          request_id?: string | null
          severity: string
          source: string
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          message?: string
          request_id?: string | null
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      nfc_tags: {
        Row: {
          active: boolean
          code_id: string
          created_at: string
          id: string
          issued_to: string | null
          label: string | null
          last_tapped_at: string | null
          tag_uid: string
          tap_count: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code_id: string
          created_at?: string
          id?: string
          issued_to?: string | null
          label?: string | null
          last_tapped_at?: string | null
          tag_uid: string
          tap_count?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code_id?: string
          created_at?: string
          id?: string
          issued_to?: string | null
          label?: string | null
          last_tapped_at?: string | null
          tag_uid?: string
          tap_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfc_tags_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      no_show_policies: {
        Row: {
          active: boolean
          admin_review_required: boolean
          automatic_charge_enabled: boolean
          created_at: string
          created_by: string | null
          customer_summary: string
          effective_at: string
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string
          id: string
          internal_notes: string | null
          min_wait_seconds: number
          name: string
          no_show_enabled: boolean
          policy_key: string
          required_contact_attempts: number
          service_type: string
          version: number
        }
        Insert: {
          active?: boolean
          admin_review_required?: boolean
          automatic_charge_enabled?: boolean
          created_at?: string
          created_by?: string | null
          customer_summary: string
          effective_at?: string
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type: string
          id?: string
          internal_notes?: string | null
          min_wait_seconds: number
          name: string
          no_show_enabled?: boolean
          policy_key: string
          required_contact_attempts?: number
          service_type: string
          version: number
        }
        Update: {
          active?: boolean
          admin_review_required?: boolean
          automatic_charge_enabled?: boolean
          created_at?: string
          created_by?: string | null
          customer_summary?: string
          effective_at?: string
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string
          id?: string
          internal_notes?: string | null
          min_wait_seconds?: number
          name?: string
          no_show_enabled?: boolean
          policy_key?: string
          required_contact_attempts?: number
          service_type?: string
          version?: number
        }
        Relationships: []
      }
      no_show_reports: {
        Row: {
          admin_notes: string | null
          admin_status: Database["public"]["Enums"]["no_show_status"]
          arrival_at: string
          arrival_lat: number | null
          arrival_lng: number | null
          attempts_count: number
          booking_id: string
          created_at: string
          driver_id: string
          id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          waited_seconds: number
        }
        Insert: {
          admin_notes?: string | null
          admin_status?: Database["public"]["Enums"]["no_show_status"]
          arrival_at: string
          arrival_lat?: number | null
          arrival_lng?: number | null
          attempts_count?: number
          booking_id: string
          created_at?: string
          driver_id: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          waited_seconds: number
        }
        Update: {
          admin_notes?: string | null
          admin_status?: Database["public"]["Enums"]["no_show_status"]
          arrival_at?: string
          arrival_lat?: number | null
          arrival_lng?: number | null
          attempts_count?: number
          booking_id?: string
          created_at?: string
          driver_id?: string
          id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          waited_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "no_show_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "no_show_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "no_show_reports_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passenger_verifications: {
        Row: {
          booking_id: string
          evidence: Json
          id: string
          method: Database["public"]["Enums"]["verification_method"]
          verified_at: string
          verified_by_driver_id: string | null
        }
        Insert: {
          booking_id: string
          evidence?: Json
          id?: string
          method: Database["public"]["Enums"]["verification_method"]
          verified_at?: string
          verified_by_driver_id?: string | null
        }
        Update: {
          booking_id?: string
          evidence?: Json
          id?: string
          method?: Database["public"]["Enums"]["verification_method"]
          verified_at?: string
          verified_by_driver_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "passenger_verifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passenger_verifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "passenger_verifications_verified_by_driver_id_fkey"
            columns: ["verified_by_driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          home_address: string | null
          id: string
          is_suspended: boolean
          is_test_account: boolean
          name: string | null
          phone: string | null
          preferred_language: string | null
          surname: string | null
          suspended_at: string | null
          suspended_by: string | null
          suspended_reason: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          home_address?: string | null
          id: string
          is_suspended?: boolean
          is_test_account?: boolean
          name?: string | null
          phone?: string | null
          preferred_language?: string | null
          surname?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          home_address?: string | null
          id?: string
          is_suspended?: boolean
          is_test_account?: boolean
          name?: string | null
          phone?: string | null
          preferred_language?: string | null
          surname?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspended_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          bucket_key: string
          created_at: string
          hit_count: number
          id: string
          last_hit_at: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          action: string
          bucket_key: string
          created_at?: string
          hit_count?: number
          id?: string
          last_hit_at?: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          action?: string
          bucket_key?: string
          created_at?: string
          hit_count?: number
          id?: string
          last_hit_at?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      receipt_verifications: {
        Row: {
          attempts: number
          booking_id: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          passenger_id: string
        }
        Insert: {
          attempts?: number
          booking_id: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          passenger_id: string
        }
        Update: {
          attempts?: number
          booking_id?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          passenger_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_verifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_verifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      referral_campaigns: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          name: string
          per_referrer_limit: number | null
          reward_flat_amount: number | null
          reward_percent: number
          reward_validity_days: number
          starts_at: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name: string
          per_referrer_limit?: number | null
          reward_flat_amount?: number | null
          reward_percent?: number
          reward_validity_days?: number
          starts_at?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          per_referrer_limit?: number | null
          reward_flat_amount?: number | null
          reward_percent?: number
          reward_validity_days?: number
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          active: boolean
          campaign_id: string | null
          code: string
          created_at: string
          id: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_id?: string | null
          code: string
          created_at?: string
          id?: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_id?: string | null
          code?: string
          created_at?: string
          id?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "referral_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          amount_flat: number | null
          amount_percent: number | null
          booking_id: string | null
          campaign_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          issued_at: string
          notes: string | null
          recipient_user_id: string
          redeemed_at: string | null
          referral_id: string
          status: Database["public"]["Enums"]["reward_status"]
          updated_at: string
        }
        Insert: {
          amount_flat?: number | null
          amount_percent?: number | null
          booking_id?: string | null
          campaign_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          recipient_user_id: string
          redeemed_at?: string | null
          referral_id: string
          status?: Database["public"]["Enums"]["reward_status"]
          updated_at?: string
        }
        Update: {
          amount_flat?: number | null
          amount_percent?: number | null
          booking_id?: string | null
          campaign_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          issued_at?: string
          notes?: string | null
          recipient_user_id?: string
          redeemed_at?: string | null
          referral_id?: string
          status?: Database["public"]["Enums"]["reward_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "referral_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          campaign_id: string | null
          code_id: string | null
          converted_at: string | null
          created_at: string
          first_booking_id: string | null
          id: string
          ip_hash: string | null
          nfc_tag_id: string | null
          referred_user_id: string | null
          referrer_user_id: string
          source: Database["public"]["Enums"]["referral_source"]
          status: Database["public"]["Enums"]["referral_status"]
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          campaign_id?: string | null
          code_id?: string | null
          converted_at?: string | null
          created_at?: string
          first_booking_id?: string | null
          id?: string
          ip_hash?: string | null
          nfc_tag_id?: string | null
          referred_user_id?: string | null
          referrer_user_id: string
          source: Database["public"]["Enums"]["referral_source"]
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          campaign_id?: string | null
          code_id?: string | null
          converted_at?: string | null
          created_at?: string
          first_booking_id?: string | null
          id?: string
          ip_hash?: string | null
          nfc_tag_id?: string | null
          referred_user_id?: string | null
          referrer_user_id?: string
          source?: Database["public"]["Enums"]["referral_source"]
          status?: Database["public"]["Enums"]["referral_status"]
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "referral_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "referral_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_nfc_tag_id_fkey"
            columns: ["nfc_tag_id"]
            isOneToOne: false
            referencedRelation: "nfc_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      restore_drills: {
        Row: {
          created_at: string
          dataset: string
          id: string
          method: string
          notes: string | null
          performed_at: string
          performed_by: string | null
          result: string
        }
        Insert: {
          created_at?: string
          dataset: string
          id?: string
          method: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          result: string
        }
        Update: {
          created_at?: string
          dataset?: string
          id?: string
          method?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          result?: string
        }
        Relationships: []
      }
      ride_reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          passenger_id: string
          rating: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          passenger_id: string
          rating: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          passenger_id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      sms_deliveries: {
        Row: {
          booking_id: string | null
          created_at: string
          error: string | null
          id: string
          locale: string
          meta: Json
          provider: string | null
          provider_id: string | null
          sent_at: string | null
          status: string
          template: string
          to_phone: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          meta?: Json
          provider?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          template: string
          to_phone: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          locale?: string
          meta?: Json
          provider?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          template?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_deliveries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_deliveries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      sms_opt_outs: {
        Row: {
          created_at: string
          phone: string
          reason: string
        }
        Insert: {
          created_at?: string
          phone: string
          reason?: string
        }
        Update: {
          created_at?: string
          phone?: string
          reason?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          environment: string
          event_id: string
          event_type: string
          received_at: string
        }
        Insert: {
          environment: string
          event_id: string
          event_type: string
          received_at?: string
        }
        Update: {
          environment?: string
          event_id?: string
          event_type?: string
          received_at?: string
        }
        Relationships: []
      }
      stripe_refunds: {
        Row: {
          amount_cents: number
          booking_id: string
          created_at: string
          currency: string
          environment: string
          id: string
          initiated_by: string | null
          raw: Json
          reason: string | null
          status: string
          stripe_payment_intent: string | null
          stripe_refund_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          booking_id: string
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          initiated_by?: string | null
          raw?: Json
          reason?: string | null
          status: string
          stripe_payment_intent?: string | null
          stripe_refund_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          booking_id?: string
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          initiated_by?: string | null
          raw?: Json
          reason?: string | null
          status?: string
          stripe_payment_intent?: string | null
          stripe_refund_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_refunds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_refunds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      support_conversations: {
        Row: {
          admin_unread_count: number
          assigned_admin_id: string | null
          booking_id: string | null
          category: Database["public"]["Enums"]["support_category"]
          created_at: string
          id: string
          last_admin_msg_at: string | null
          last_passenger_msg_at: string | null
          passenger_id: string
          passenger_unread_count: number
          status: Database["public"]["Enums"]["support_status"]
          subject: string
          updated_at: string
        }
        Insert: {
          admin_unread_count?: number
          assigned_admin_id?: string | null
          booking_id?: string | null
          category?: Database["public"]["Enums"]["support_category"]
          created_at?: string
          id?: string
          last_admin_msg_at?: string | null
          last_passenger_msg_at?: string | null
          passenger_id: string
          passenger_unread_count?: number
          status?: Database["public"]["Enums"]["support_status"]
          subject: string
          updated_at?: string
        }
        Update: {
          admin_unread_count?: number
          assigned_admin_id?: string | null
          booking_id?: string | null
          category?: Database["public"]["Enums"]["support_category"]
          created_at?: string
          id?: string
          last_admin_msg_at?: string | null
          last_passenger_msg_at?: string | null
          passenger_id?: string
          passenger_unread_count?: number
          status?: Database["public"]["Enums"]["support_status"]
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
        ]
      }
      support_message_rate: {
        Row: {
          message_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          message_count?: number
          updated_at?: string
          user_id: string
          window_started_at?: string
        }
        Update: {
          message_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          is_internal_note: boolean
          sender_type: Database["public"]["Enums"]["support_sender"]
          sender_user_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          sender_type: Database["public"]["Enums"]["support_sender"]
          sender_user_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          sender_type?: Database["public"]["Enums"]["support_sender"]
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_settings: {
        Row: {
          email_address: string | null
          email_enabled: boolean
          emergency_message: string | null
          fallback_message: string | null
          id: number
          operating_hours: string | null
          updated_at: string
          updated_by: string | null
          whatsapp_enabled: boolean
          whatsapp_phone_e164: string | null
          whatsapp_template: string | null
        }
        Insert: {
          email_address?: string | null
          email_enabled?: boolean
          emergency_message?: string | null
          fallback_message?: string | null
          id?: number
          operating_hours?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_e164?: string | null
          whatsapp_template?: string | null
        }
        Update: {
          email_address?: string | null
          email_enabled?: boolean
          emergency_message?: string | null
          fallback_message?: string | null
          id?: number
          operating_hours?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_enabled?: boolean
          whatsapp_phone_e164?: string | null
          whatsapp_template?: string | null
        }
        Relationships: []
      }
      trip_locations: {
        Row: {
          accuracy_m: number | null
          booking_id: string
          driver_id: string
          id: string
          kind: Database["public"]["Enums"]["trip_location_kind"]
          lat: number
          lng: number
          recorded_at: string
        }
        Insert: {
          accuracy_m?: number | null
          booking_id: string
          driver_id: string
          id?: string
          kind: Database["public"]["Enums"]["trip_location_kind"]
          lat: number
          lng: number
          recorded_at?: string
        }
        Update: {
          accuracy_m?: number | null
          booking_id?: string
          driver_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["trip_location_kind"]
          lat?: number
          lng?: number
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_locations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_locations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "trip_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_route_points: {
        Row: {
          booking_id: string
          driver_id: string
          lat: number
          lng: number
          recorded_at: string
          seq: number
          speed_mps: number | null
        }
        Insert: {
          booking_id: string
          driver_id: string
          lat: number
          lng: number
          recorded_at?: string
          seq: number
          speed_mps?: number | null
        }
        Update: {
          booking_id?: string
          driver_id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          seq?: number
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_route_points_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_route_points_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "trip_evidence_v"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "trip_route_points_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          category: Database["public"]["Enums"]["vehicle_category"]
          created_at: string
          id: string
          insurance_expires_at: string | null
          license_plate: string
          model_year: number | null
          name: string
          seats: number
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
          vin: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["vehicle_category"]
          created_at?: string
          id?: string
          insurance_expires_at?: string | null
          license_plate: string
          model_year?: number | null
          name: string
          seats?: number
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vin?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["vehicle_category"]
          created_at?: string
          id?: string
          insurance_expires_at?: string | null
          license_plate?: string
          model_year?: number | null
          name?: string
          seats?: number
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vin?: string | null
        }
        Relationships: []
      }
      verification_settings: {
        Row: {
          id: number
          min_waiting_seconds: number
          nfc_enabled: boolean
          pin_enabled: boolean
          qr_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          min_waiting_seconds?: number
          nfc_enabled?: boolean
          pin_enabled?: boolean
          qr_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          min_waiting_seconds?: number
          nfc_enabled?: boolean
          pin_enabled?: boolean
          qr_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      trip_evidence_v: {
        Row: {
          booking_id: string | null
          booking_status: Database["public"]["Enums"]["booking_status"] | null
          communications: Json | null
          dispatch_status: Database["public"]["Enums"]["dispatch_status"] | null
          driver_id: string | null
          dropoff: string | null
          events: Json | null
          incidents: Json | null
          key_locations: Json | null
          no_show: Json | null
          passenger_id: string | null
          pickup: string | null
          pickup_time: string | null
          route_point_count: number | null
          vehicle_id: string | null
          verifications: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_active_cancellation_policy: {
        Row: {
          admin_review_required: boolean | null
          allow_cancellation_inside_cutoff: boolean | null
          customer_summary: string | null
          effective_at: string | null
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string | null
          free_cancellation_cutoff_hours: number | null
          free_cancellation_enabled: boolean | null
          id: string | null
          late_cancellation_enabled: boolean | null
          name: string | null
          policy_key: string | null
          service_type: string | null
          version: number | null
        }
        Insert: {
          admin_review_required?: boolean | null
          allow_cancellation_inside_cutoff?: boolean | null
          customer_summary?: string | null
          effective_at?: string | null
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string | null
          free_cancellation_cutoff_hours?: number | null
          free_cancellation_enabled?: boolean | null
          id?: string | null
          late_cancellation_enabled?: boolean | null
          name?: string | null
          policy_key?: string | null
          service_type?: string | null
          version?: number | null
        }
        Update: {
          admin_review_required?: boolean | null
          allow_cancellation_inside_cutoff?: boolean | null
          customer_summary?: string | null
          effective_at?: string | null
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string | null
          free_cancellation_cutoff_hours?: number | null
          free_cancellation_enabled?: boolean | null
          id?: string | null
          late_cancellation_enabled?: boolean | null
          name?: string | null
          policy_key?: string | null
          service_type?: string | null
          version?: number | null
        }
        Relationships: []
      }
      v_active_no_show_policy: {
        Row: {
          admin_review_required: boolean | null
          automatic_charge_enabled: boolean | null
          customer_summary: string | null
          effective_at: string | null
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string | null
          id: string | null
          min_wait_seconds: number | null
          name: string | null
          no_show_enabled: boolean | null
          policy_key: string | null
          required_contact_attempts: number | null
          service_type: string | null
          version: number | null
        }
        Insert: {
          admin_review_required?: boolean | null
          automatic_charge_enabled?: boolean | null
          customer_summary?: string | null
          effective_at?: string | null
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string | null
          id?: string | null
          min_wait_seconds?: number | null
          name?: string | null
          no_show_enabled?: boolean | null
          policy_key?: string | null
          required_contact_attempts?: number | null
          service_type?: string | null
          version?: number | null
        }
        Update: {
          admin_review_required?: boolean | null
          automatic_charge_enabled?: boolean | null
          customer_summary?: string | null
          effective_at?: string | null
          expires_at?: string | null
          fee_cap_cents?: number | null
          fee_fixed_cents?: number | null
          fee_percent_bps?: number | null
          fee_type?: string | null
          id?: string | null
          min_wait_seconds?: number | null
          name?: string | null
          no_show_enabled?: boolean | null
          policy_key?: string | null
          required_contact_attempts?: number | null
          service_type?: string | null
          version?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _audit_write: {
        Args: {
          _action: string
          _actor_id: string
          _entity_id: string
          _entity_type: string
          _nxt: Json
          _previous: Json
          _reason: string
        }
        Returns: undefined
      }
      _email_fingerprint: { Args: { _email: string }; Returns: string }
      _validate_cancellation_payload: {
        Args: { _payload: Json }
        Returns: undefined
      }
      _validate_no_show_payload: {
        Args: { _payload: Json }
        Returns: undefined
      }
      admin_activate_cancellation_policy: {
        Args: { _id: string; _reason?: string }
        Returns: Json
      }
      admin_activate_no_show_policy: {
        Args: { _id: string; _reason?: string }
        Returns: Json
      }
      admin_assign_driver: {
        Args: {
          _booking_id: string
          _driver_id: string
          _reason?: string
          _vehicle_id?: string
        }
        Returns: Json
      }
      admin_audit_log: {
        Args: {
          _action: string
          _entity_id: string
          _entity_type: string
          _next: Json
          _previous: Json
          _reason?: string
        }
        Returns: string
      }
      admin_audit_mfa_reset: {
        Args: { _reason: string; _target_user_id: string }
        Returns: undefined
      }
      admin_audit_mfa_reset_outcome: {
        Args: {
          _error?: string
          _outcome: string
          _removed: number
          _target_user_id: string
          _total: number
        }
        Returns: undefined
      }
      admin_audit_mfa_reset_requested: {
        Args: { _reason: string; _target_user_id: string }
        Returns: string
      }
      admin_audit_provisioning_failure: {
        Args: {
          _account_type: string
          _correlation_id: string
          _email: string
          _failure_category: string
        }
        Returns: undefined
      }
      admin_consume_recovery_code: { Args: { _code: string }; Returns: boolean }
      admin_convert_user_role: {
        Args: {
          _confirmed?: boolean
          _driver?: Json
          _new_role: string
          _reason: string
          _user_id: string
        }
        Returns: Json
      }
      admin_create_cancellation_policy: {
        Args: { _payload: Json }
        Returns: Json
      }
      admin_create_cancellation_policy_version: {
        Args: { _payload: Json; _policy_key: string }
        Returns: Json
      }
      admin_create_no_show_policy: { Args: { _payload: Json }; Returns: Json }
      admin_create_no_show_policy_version: {
        Args: { _payload: Json; _policy_key: string }
        Returns: Json
      }
      admin_deactivate_cancellation_policy: {
        Args: { _id: string; _reason?: string }
        Returns: Json
      }
      admin_deactivate_no_show_policy: {
        Args: { _id: string; _reason?: string }
        Returns: Json
      }
      admin_delete_amenity: { Args: { _id: string }; Returns: undefined }
      admin_delete_campaign: { Args: { _id: string }; Returns: undefined }
      admin_delete_discount: { Args: { _id: string }; Returns: undefined }
      admin_delete_driver: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      admin_delete_nfc_tag: { Args: { _id: string }; Returns: undefined }
      admin_delete_vehicle: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      admin_dispatch_kpis: { Args: never; Returns: Json }
      admin_dispatch_overview: { Args: never; Returns: Json }
      admin_fleet_compliance_alerts: { Args: { _days?: number }; Returns: Json }
      admin_fleet_expirations: { Args: never; Returns: Json }
      admin_generate_recovery_codes: {
        Args: never
        Returns: {
          code: string
        }[]
      }
      admin_get_invitation_cooldown: {
        Args: { _cooldown_seconds?: number; _email: string }
        Returns: Json
      }
      admin_incident_feed: { Args: { _limit?: number }; Returns: Json }
      admin_integration_health_summary: {
        Args: never
        Returns: {
          checked_at: string
          details: Json
          integration: string
          latency_ms: number
          status: string
        }[]
      }
      admin_list_admins: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_list_amenities: { Args: never; Returns: Json }
      admin_list_cancellation_policies: {
        Args: never
        Returns: {
          active: boolean
          admin_review_required: boolean
          allow_cancellation_inside_cutoff: boolean
          created_at: string
          created_by: string | null
          customer_summary: string
          effective_at: string
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string
          free_cancellation_cutoff_hours: number
          free_cancellation_enabled: boolean
          id: string
          internal_notes: string | null
          late_cancellation_enabled: boolean
          name: string
          policy_key: string
          service_type: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "cancellation_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_integration_health: {
        Args: never
        Returns: {
          checked_at: string
          details: Json
          integration: string
          latency_ms: number
          status: string
        }[]
      }
      admin_list_managed_users: { Args: never; Returns: Json }
      admin_list_no_show_policies: {
        Args: never
        Returns: {
          active: boolean
          admin_review_required: boolean
          automatic_charge_enabled: boolean
          created_at: string
          created_by: string | null
          customer_summary: string
          effective_at: string
          expires_at: string | null
          fee_cap_cents: number | null
          fee_fixed_cents: number | null
          fee_percent_bps: number | null
          fee_type: string
          id: string
          internal_notes: string | null
          min_wait_seconds: number
          name: string
          no_show_enabled: boolean
          policy_key: string
          required_contact_attempts: number
          service_type: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "no_show_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_restore_drills: {
        Args: { _limit?: number }
        Returns: {
          dataset: string
          id: string
          method: string
          notes: string
          performed_at: string
          performed_by: string
          result: string
        }[]
      }
      admin_provision_user_finalize: {
        Args: {
          _account_type: string
          _driver?: Json
          _is_test?: boolean
          _profile: Json
          _user_id: string
        }
        Returns: Json
      }
      admin_recent_monitoring_events: {
        Args: { _limit?: number }
        Returns: {
          context: Json
          created_at: string
          id: string
          message: string
          request_id: string
          severity: string
          source: string
          user_id: string
        }[]
      }
      admin_record_integration_health: {
        Args: {
          _details?: Json
          _integration: string
          _latency_ms?: number
          _status: string
        }
        Returns: string
      }
      admin_record_restore_drill: {
        Args: {
          _dataset: string
          _method: string
          _notes?: string
          _result: string
        }
        Returns: string
      }
      admin_recovery_status: {
        Args: never
        Returns: {
          last_generated_at: string
          last_used_at: string
          total_codes: number
          unused_codes: number
        }[]
      }
      admin_referral_kpis: { Args: never; Returns: Json }
      admin_remove_assignment: {
        Args: { _assignment_id: string; _reason?: string }
        Returns: Json
      }
      admin_reserve_invitation_slot: {
        Args: { _cooldown_seconds?: number; _email: string }
        Returns: Json
      }
      admin_resolve_incident: {
        Args: { _id: string; _notes?: string; _status: string }
        Returns: Json
      }
      admin_review_no_show: {
        Args: { _id: string; _notes?: string; _status: string }
        Returns: Json
      }
      admin_set_booking_status: {
        Args: { _booking_id: string; _reason?: string; _status: string }
        Returns: Json
      }
      admin_set_driver_availability: {
        Args: { _availability: string; _driver_id: string; _reason?: string }
        Returns: Json
      }
      admin_set_user_suspension: {
        Args: { _reason?: string; _suspend: boolean; _user_id: string }
        Returns: Json
      }
      admin_support_assign: {
        Args: { _assignee: string; _conversation_id: string }
        Returns: Json
      }
      admin_support_reply: {
        Args: { _body: string; _conversation_id: string; _internal?: boolean }
        Returns: string
      }
      admin_support_set_status: {
        Args: { _conversation_id: string; _status: string }
        Returns: Json
      }
      admin_system_health_snapshot: { Args: never; Returns: Json }
      admin_toggle_campaign: { Args: { _id: string }; Returns: Json }
      admin_update_support_settings: { Args: { _payload: Json }; Returns: Json }
      admin_update_user_profile: {
        Args: { _driver?: Json; _profile: Json; _user_id: string }
        Returns: Json
      }
      admin_upsert_amenity: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_campaign: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_discount: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_driver: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_nfc_tag: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_vehicle: {
        Args: { _id: string; _payload: Json }
        Returns: Json
      }
      admin_upsert_verification_settings: {
        Args: { _payload: Json }
        Returns: Json
      }
      advance_assignment: {
        Args: { _assignment_id: string; _next_status: string; _reason?: string }
        Returns: Json
      }
      booking_amenity_total_cents: {
        Args: { _booking_id: string }
        Returns: number
      }
      check_and_bump_rate_limit: {
        Args: {
          _action: string
          _key: string
          _limit: number
          _window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after: number
        }[]
      }
      create_booking:
        | {
            Args: {
              _dropoff: string
              _passengers: number
              _pickup: string
              _pickup_time: string
              _ride_type: string
            }
            Returns: string
          }
        | {
            Args: {
              _dropoff: string
              _dropoff_components?: Json
              _dropoff_lat?: number
              _dropoff_lng?: number
              _dropoff_place_id?: string
              _passengers: number
              _pickup: string
              _pickup_components?: Json
              _pickup_lat?: number
              _pickup_lng?: number
              _pickup_place_id?: string
              _pickup_time: string
              _ride_type: string
            }
            Returns: string
          }
      driver_owns_booking: { Args: { _booking_id: string }; Returns: boolean }
      driver_signin_eligibility: { Args: never; Returns: boolean }
      get_active_cancellation_policy: {
        Args: { _at?: string; _service_type: string }
        Returns: Json
      }
      get_active_no_show_policy: {
        Args: { _at?: string; _service_type: string }
        Returns: Json
      }
      get_my_booking_pin: { Args: { _booking_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_current_user_admin: { Args: never; Returns: boolean }
      list_active_amenities: { Args: { _ride_type?: string }; Returns: Json }
      monitoring_capture: {
        Args: {
          _context?: Json
          _message: string
          _request_id?: string
          _severity: string
          _source: string
        }
        Returns: string
      }
      passenger_owns_booking: {
        Args: { _booking_id: string }
        Returns: boolean
      }
      record_legal_acceptance: {
        Args: { _kind: string; _version: string }
        Returns: undefined
      }
      set_booking_amenities: {
        Args: { _amenity_ids: string[]; _booking_id: string }
        Returns: Json
      }
      sms_opt_out: { Args: { _phone: string }; Returns: undefined }
      support_mark_read: {
        Args: { _conversation_id: string }
        Returns: undefined
      }
      support_open_conversation: {
        Args: {
          _booking_id?: string
          _category: string
          _first_message: string
          _subject: string
        }
        Returns: string
      }
      support_send_message: {
        Args: { _body: string; _conversation_id: string }
        Returns: string
      }
      test_dispatch_state_machine: {
        Args: never
        Returns: {
          detail: string
          passed: boolean
          t_name: string
        }[]
      }
      verify_booking_pin: {
        Args: { _booking_id: string; _pin: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "driver" | "passenger"
      booking_status:
        | "requested"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
      comm_channel: "phone" | "inapp"
      comm_direction: "driver_to_passenger" | "passenger_to_driver"
      comm_status: "initiated" | "connected" | "missed" | "failed"
      dispatch_status:
        | "pending"
        | "assigned"
        | "accepted"
        | "en_route"
        | "arrived"
        | "in_progress"
        | "completed"
        | "cancelled"
      driver_availability:
        | "available"
        | "assigned"
        | "on_trip"
        | "offline"
        | "vacation"
      driver_document_kind:
        | "license"
        | "insurance"
        | "company_id"
        | "medical"
        | "other"
      driver_document_status: "valid" | "expiring" | "expired"
      driver_trip_event_kind:
        | "accepted"
        | "rejected"
        | "arrived"
        | "waiting"
        | "started"
        | "completed"
        | "no_show"
        | "incident"
        | "dispatch_contacted"
        | "passenger_contacted"
      employment_status: "active" | "inactive" | "vacation"
      incident_category:
        | "vehicle"
        | "passenger"
        | "traffic"
        | "road_closure"
        | "lost_property"
        | "emergency"
        | "other"
      incident_severity: "low" | "medium" | "high" | "critical"
      incident_status: "open" | "reviewing" | "resolved" | "dismissed"
      no_show_status: "pending" | "approved" | "rejected"
      referral_source: "nfc" | "qr" | "link"
      referral_status:
        | "pending"
        | "converted"
        | "rewarded"
        | "expired"
        | "cancelled"
      reward_status: "pending" | "redeemed" | "expired" | "cancelled"
      ride_type: "escalade" | "suburban" | "denali"
      support_category:
        | "booking_help"
        | "driver_concern"
        | "payment_receipt"
        | "lost_item"
        | "safety_concern"
        | "vehicle_preference"
        | "amenity_question"
        | "technical_problem"
        | "general_support"
      support_sender: "passenger" | "admin" | "system"
      support_status: "open" | "pending" | "resolved"
      trip_location_kind: "arrival" | "trip_start" | "trip_end"
      unavailability_reason: "vacation" | "maintenance" | "personal"
      vehicle_category: "escalade" | "suburban" | "denali" | "other"
      vehicle_status: "active" | "maintenance"
      verification_method: "pin" | "qr" | "nfc"
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
      app_role: ["admin", "driver", "passenger"],
      booking_status: [
        "requested",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
      ],
      comm_channel: ["phone", "inapp"],
      comm_direction: ["driver_to_passenger", "passenger_to_driver"],
      comm_status: ["initiated", "connected", "missed", "failed"],
      dispatch_status: [
        "pending",
        "assigned",
        "accepted",
        "en_route",
        "arrived",
        "in_progress",
        "completed",
        "cancelled",
      ],
      driver_availability: [
        "available",
        "assigned",
        "on_trip",
        "offline",
        "vacation",
      ],
      driver_document_kind: [
        "license",
        "insurance",
        "company_id",
        "medical",
        "other",
      ],
      driver_document_status: ["valid", "expiring", "expired"],
      driver_trip_event_kind: [
        "accepted",
        "rejected",
        "arrived",
        "waiting",
        "started",
        "completed",
        "no_show",
        "incident",
        "dispatch_contacted",
        "passenger_contacted",
      ],
      employment_status: ["active", "inactive", "vacation"],
      incident_category: [
        "vehicle",
        "passenger",
        "traffic",
        "road_closure",
        "lost_property",
        "emergency",
        "other",
      ],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: ["open", "reviewing", "resolved", "dismissed"],
      no_show_status: ["pending", "approved", "rejected"],
      referral_source: ["nfc", "qr", "link"],
      referral_status: [
        "pending",
        "converted",
        "rewarded",
        "expired",
        "cancelled",
      ],
      reward_status: ["pending", "redeemed", "expired", "cancelled"],
      ride_type: ["escalade", "suburban", "denali"],
      support_category: [
        "booking_help",
        "driver_concern",
        "payment_receipt",
        "lost_item",
        "safety_concern",
        "vehicle_preference",
        "amenity_question",
        "technical_problem",
        "general_support",
      ],
      support_sender: ["passenger", "admin", "system"],
      support_status: ["open", "pending", "resolved"],
      trip_location_kind: ["arrival", "trip_start", "trip_end"],
      unavailability_reason: ["vacation", "maintenance", "personal"],
      vehicle_category: ["escalade", "suburban", "denali", "other"],
      vehicle_status: ["active", "maintenance"],
      verification_method: ["pin", "qr", "nfc"],
    },
  },
} as const
