import { appOrigin, pickSubscription, toSubscriptionRow, type StripeSubscriptionLike } from '../../../supabase/functions/_shared/subscription';

const sub = (overrides: Partial<StripeSubscriptionLike>): StripeSubscriptionLike => ({
  id: 'sub_1',
  status: 'active',
  created: 1_700_000_000,
  ...overrides,
});

describe('pickSubscription', () => {
  it('returns null when the customer has none', () => {
    expect(pickSubscription([])).toBeNull();
  });

  it('prefers a live subscription over an older cancelled one, whatever the order', () => {
    const cancelled = sub({ id: 'sub_old', status: 'canceled', created: 100 });
    const active = sub({ id: 'sub_new', status: 'active', created: 200 });
    expect(pickSubscription([cancelled, active])?.id).toBe('sub_new');
    expect(pickSubscription([active, cancelled])?.id).toBe('sub_new');
  });

  it('keeps a live subscription even when a cancelled one is newer', () => {
    const active = sub({ id: 'sub_live', status: 'trialing', created: 100 });
    const cancelled = sub({ id: 'sub_dead', status: 'canceled', created: 200 });
    expect(pickSubscription([cancelled, active])?.id).toBe('sub_live');
  });

  it('breaks ties by taking the most recent', () => {
    const older = sub({ id: 'sub_a', status: 'canceled', created: 100 });
    const newer = sub({ id: 'sub_b', status: 'canceled', created: 200 });
    expect(pickSubscription([older, newer])?.id).toBe('sub_b');
  });

  it('ranks past_due above cancelled but below active', () => {
    const pastDue = sub({ id: 'sub_pd', status: 'past_due' });
    expect(pickSubscription([sub({ id: 'sub_c', status: 'canceled' }), pastDue])?.id).toBe('sub_pd');
    expect(pickSubscription([pastDue, sub({ id: 'sub_ok', status: 'active' })])?.id).toBe('sub_ok');
  });

  it('does not mutate its input', () => {
    const input = [sub({ id: 'a', status: 'canceled' }), sub({ id: 'b', status: 'active' })];
    pickSubscription(input);
    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('toSubscriptionRow', () => {
  it('writes an inactive row when there is no subscription', () => {
    expect(toSubscriptionRow('user-1', 'cus_1', null)).toEqual({
      user_id: 'user-1',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: null,
      status: 'inactive',
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
  });

  it('reads the period end from the subscription on older API versions', () => {
    const row = toSubscriptionRow('user-1', 'cus_1', sub({ current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_1' } }] } }));
    expect(row.current_period_end).toBe('2027-01-15T08:00:00.000Z');
    expect(row.price_id).toBe('price_1');
    expect(row.status).toBe('active');
  });

  it('reads the period end from the first item on newer API versions', () => {
    const row = toSubscriptionRow(
      'user-1',
      'cus_1',
      sub({ cancel_at_period_end: true, items: { data: [{ current_period_end: 1_800_000_000, price: { id: 'price_1' } }] } }),
    );
    expect(row.current_period_end).toBe('2027-01-15T08:00:00.000Z');
    expect(row.cancel_at_period_end).toBe(true);
  });
});

describe('appOrigin', () => {
  it('reduces a URL to its origin', () => {
    expect(appOrigin('https://app.example.com/account?x=1')).toBe('https://app.example.com');
    expect(appOrigin('http://localhost:8081')).toBe('http://localhost:8081');
  });

  it('refuses plain http for anything but localhost, and garbage', () => {
    expect(() => appOrigin('http://app.example.com')).toThrow();
    expect(() => appOrigin('not a url')).toThrow();
  });
});
