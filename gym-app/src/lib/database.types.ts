export type Role = 'client' | 'trainer';

export type Profile = {
  id: string;
  email: string | null;
  full_name: string;
  role: Role;
  trainer_id: string | null;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
};

export type Workout = {
  id: string;
  trainer_id: string;
  client_id: string;
  title: string;
  notes: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Subscription = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
};

export type JoinTrainerResult =
  | { ok: true; trainer_name: string }
  | { ok: false; error: 'INVALID_CODE' | 'TOO_MANY_ATTEMPTS' | 'TRAINER_AT_CAPACITY' | 'ALREADY_LINKED' | 'NOT_A_CLIENT' };

export type Plan = {
  plan: 'free' | 'pro';
  status: string;
  client_count: number;
  client_limit: number | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: never;
        Update: { full_name?: string };
        Relationships: [];
      };
      workouts: {
        Row: Workout;
        Insert: { trainer_id: string; client_id: string; title: string; notes?: string };
        Update: { title?: string; notes?: string; is_completed?: boolean };
        Relationships: [];
      };
      subscriptions: {
        Row: Subscription;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      join_trainer: { Args: { p_code: string }; Returns: JoinTrainerResult };
      leave_trainer: { Args: Record<never, never>; Returns: undefined };
      remove_client: { Args: { p_client_id: string }; Returns: boolean };
      regenerate_invite_code: { Args: Record<never, never>; Returns: string };
      my_plan: { Args: Record<never, never>; Returns: Plan };
      delete_my_account: { Args: Record<never, never>; Returns: undefined };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
