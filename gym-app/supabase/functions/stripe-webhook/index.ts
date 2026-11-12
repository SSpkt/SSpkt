// Receives Stripe webhooks and mirrors subscription state into public.subscriptions, which
// is what the database uses to decide whether a trainer is on the Pro plan.
// Secrets required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Deployed with verify_jwt = false (see supabase/config.toml): Stripe cannot send a Supabase
// JWT, so authenticity comes from the signature check below instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@23';

import { pickSubscription, toSubscriptionRow } from '../_shared/subscription.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

/** Rewrites one customer's row from what Stripe says right now, not from the event payload. */
async function syncCustomer(customerId: string, hintedUserId: string | null): Promise<void> {
  const { data: known, error: lookupError } = await admin
    .from('subscriptions').select('user_id').eq('stripe_customer_id', customerId).maybeSingle();
  if (lookupError) throw lookupError;

  // Prefer our own record of who owns the customer. The hint (set by our checkout function)
  // only matters if that record is somehow missing.
  const userId = known?.user_id ?? hintedUserId;
  if (!userId) {
    console.warn(`No user for Stripe customer ${customerId}; ignoring`);
    return;
  }

  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  const row = toSubscriptionRow(userId, customerId, pickSubscription(list.data));

  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  // 23503: the account was deleted in the meantime. Nothing left to update.
  if (error && error.code !== '23503') throw error;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    // Must be the raw body: the signature covers the exact bytes Stripe sent.
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (!HANDLED.has(event.type)) return new Response(JSON.stringify({ received: true }), { status: 200 });

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = idOf(session.customer);
      if (session.mode === 'subscription' && customerId) {
        await syncCustomer(customerId, session.client_reference_id ?? null);
      }
    } else {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = idOf(subscription.customer);
      if (customerId) await syncCustomer(customerId, subscription.metadata?.user_id ?? null);
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (error) {
    // A 500 makes Stripe retry with backoff, so a transient failure heals itself.
    console.error(`stripe-webhook failed on ${event.type}`, error);
    return new Response('Webhook handler failed', { status: 500 });
  }
});
