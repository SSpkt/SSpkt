// Creates a Stripe Checkout or Billing Portal session for the signed-in trainer and returns
// its URL. Secrets required (supabase secrets set ...):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@23';

import { appOrigin } from '../_shared/subscription.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const PRICE_ID = Deno.env.get('STRIPE_PRICE_ID')!;
// Redirect targets come from server configuration only, never from the request, so this
// endpoint cannot be used to bounce a user to an attacker's site.
const APP_ORIGIN = appOrigin(Deno.env.get('APP_URL')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const authorization = req.headers.get('Authorization') ?? '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'unauthorized' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Verifies the JWT with the auth server; never trust a decoded-but-unverified token.
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json(401, { error: 'unauthorized' });

    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (action !== 'checkout' && action !== 'portal') return json(400, { error: 'invalid_action' });

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== 'trainer') return json(403, { error: 'trainers_only' });

    const { data: existing, error: existingError } = await admin
      .from('subscriptions').select('stripe_customer_id, status').eq('user_id', user.id).maybeSingle();
    if (existingError) throw existingError;

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      // The idempotency key makes two simultaneous requests resolve to one Stripe customer.
      const customer = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { user_id: user.id } },
        { idempotencyKey: `customer-${user.id}` },
      );
      customerId = customer.id;
      const { error: upsertError } = await admin
        .from('subscriptions')
        .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
      if (upsertError) throw upsertError;
    }

    if (action === 'portal') {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${APP_ORIGIN}/account`,
      });
      return json(200, { url: portal.url });
    }

    if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
      return json(409, { error: 'already_subscribed' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${APP_ORIGIN}/account?billing=success`,
      cancel_url: `${APP_ORIGIN}/account`,
    });
    return json(200, { url: session.url });
  } catch (error) {
    // Details go to the function logs only; the caller gets a generic failure.
    console.error('billing-session failed', error);
    return json(500, { error: 'internal_error' });
  }
});
