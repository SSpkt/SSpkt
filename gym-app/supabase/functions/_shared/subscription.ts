// Pure helpers shared by the billing functions. No Deno or network access in here, so the
// same file is unit-tested from the app's test suite.

/** The parts of a Stripe subscription these functions read. */
export type StripeSubscriptionLike = {
  id: string;
  status: string;
  created: number;
  cancel_at_period_end?: boolean | null;
  // Older API versions put the period on the subscription, newer ones on each item.
  current_period_end?: number | null;
  items?: { data?: { current_period_end?: number | null; price?: { id?: string | null } | null }[] } | null;
};

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 0,
  past_due: 1,
  unpaid: 2,
  paused: 3,
  incomplete: 4,
  canceled: 5,
  incomplete_expired: 6,
};

/**
 * Picks the subscription that defines a customer's entitlement: a live one beats a lapsed
 * one, and the newest wins a tie. Reconciling from the full list on every webhook means
 * late or out-of-order events can never downgrade someone who has since re-subscribed.
 */
export function pickSubscription<T extends StripeSubscriptionLike>(subscriptions: T[]): T | null {
  if (subscriptions.length === 0) return null;
  return [...subscriptions].sort((a, b) => {
    const byStatus = (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9);
    return byStatus !== 0 ? byStatus : b.created - a.created;
  })[0];
}

export function toSubscriptionRow(
  userId: string,
  customerId: string,
  subscription: StripeSubscriptionLike | null,
): SubscriptionRow {
  if (!subscription) {
    return {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      status: 'inactive',
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    };
  }
  const item = subscription.items?.data?.[0];
  const periodEnd = subscription.current_period_end ?? item?.current_period_end ?? null;
  return {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: item?.price?.id ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  };
}

/** `https://app.example.com/anything` -> `https://app.example.com`. Throws on a bad value. */
export function appOrigin(appUrl: string): string {
  const url = new URL(appUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('APP_URL must use https');
  }
  return url.origin;
}
