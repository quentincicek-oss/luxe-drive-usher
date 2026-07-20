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
          id: string
          notes: string | null
          paid: boolean
          paid_at: string | null
          passenger_id: string
          passengers: number
          pickup: string
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
          id?: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          passenger_id: string
          passengers?: number
          pickup: string
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
          id?: string
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          passenger_id?: string
          passengers?: number
          pickup?: string
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
          name: string | null
          phone: string | null
          preferred_language: string | null
          surname: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          home_address?: string | null
          id: string
          name?: string | null
          phone?: string | null
          preferred_language?: string | null
          surname?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          home_address?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          preferred_language?: string | null
          surname?: string | null
          updated_at?: string
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
      admin_incident_feed: { Args: { _limit?: number }; Returns: Json }
      admin_referral_kpis: { Args: never; Returns: Json }
      admin_remove_assignment: {
        Args: { _assignment_id: string; _reason?: string }
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
      admin_toggle_campaign: { Args: { _id: string }; Returns: Json }
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
      create_booking: {
        Args: {
          _dropoff: string
          _passengers: number
          _pickup: string
          _pickup_time: string
          _ride_type: string
        }
        Returns: string
      }
      driver_owns_booking: { Args: { _booking_id: string }; Returns: boolean }
      get_my_booking_pin: { Args: { _booking_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      passenger_owns_booking: {
        Args: { _booking_id: string }
        Returns: boolean
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
      trip_location_kind: ["arrival", "trip_start", "trip_end"],
      unavailability_reason: ["vacation", "maintenance", "personal"],
      vehicle_category: ["escalade", "suburban", "denali", "other"],
      vehicle_status: ["active", "maintenance"],
      verification_method: ["pin", "qr", "nfc"],
    },
  },
} as const
