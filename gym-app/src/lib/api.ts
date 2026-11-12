import type { JoinTrainerResult, Plan, Profile, Workout } from './database.types';
import { supabase } from './supabase';

export type ClientSummary = Profile & { total: number; completed: number };

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateName(userId: string, fullName: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', userId);
  if (error) throw error;
}

/** A trainer's clients with their workout progress. RLS limits both queries to the caller's own. */
export async function fetchClients(trainerId: string): Promise<ClientSummary[]> {
  const [clients, workouts] = await Promise.all([
    supabase.from('profiles').select('*').eq('role', 'client').eq('trainer_id', trainerId).order('full_name'),
    supabase.from('workouts').select('client_id, is_completed').eq('trainer_id', trainerId),
  ]);
  if (clients.error) throw clients.error;
  if (workouts.error) throw workouts.error;

  const progress = new Map<string, { total: number; completed: number }>();
  for (const workout of workouts.data) {
    const entry = progress.get(workout.client_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (workout.is_completed) entry.completed += 1;
    progress.set(workout.client_id, entry);
  }
  return clients.data.map((client) => ({ ...client, ...(progress.get(client.id) ?? { total: 0, completed: 0 }) }));
}

export async function fetchClient(clientId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('id', clientId).eq('role', 'client').maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchTrainerName(trainerId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('full_name').eq('id', trainerId).maybeSingle();
  if (error) throw error;
  return data?.full_name ?? null;
}

export async function fetchWorkoutsForClient(clientId: string): Promise<Workout[]> {
  const { data, error } = await supabase
    .from('workouts').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function assignWorkout(input: {
  trainerId: string;
  clientId: string;
  title: string;
  notes: string;
}): Promise<Workout> {
  const { data, error } = await supabase
    .from('workouts')
    .insert({
      trainer_id: input.trainerId,
      client_id: input.clientId,
      title: input.title.trim(),
      notes: input.notes.trim(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setWorkoutCompleted(workoutId: string, isCompleted: boolean): Promise<Workout> {
  const { data, error } = await supabase
    .from('workouts').update({ is_completed: isCompleted }).eq('id', workoutId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWorkout(workoutId: string): Promise<void> {
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
  if (error) throw error;
}

export async function joinTrainer(code: string): Promise<JoinTrainerResult> {
  const { data, error } = await supabase.rpc('join_trainer', { p_code: code });
  if (error) throw error;
  return data;
}

export async function leaveTrainer(): Promise<void> {
  const { error } = await supabase.rpc('leave_trainer');
  if (error) throw error;
}

export async function removeClient(clientId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_client', { p_client_id: clientId });
  if (error) throw error;
}

export async function regenerateInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code');
  if (error) throw error;
  return data;
}

export async function fetchPlan(): Promise<Plan> {
  const { data, error } = await supabase.rpc('my_plan');
  if (error) throw error;
  return data;
}

export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
}

/** Asks the billing function for a Stripe-hosted page and returns its URL. */
export async function createBillingSession(action: 'checkout' | 'portal'): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>('billing-session', { body: { action } });
  if (error) throw error;
  if (!data?.url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(data.url)) {
    throw new Error('Unexpected billing response');
  }
  return data.url;
}
