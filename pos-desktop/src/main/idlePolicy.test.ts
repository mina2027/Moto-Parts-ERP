import { expect, it } from 'vitest';
import { IdlePolicy } from './idlePolicy';
it('locks at the configured deadline even without renderer timer activity', () => {
  let now = 1000; const policy = new IdlePolicy(() => now);
  now += 59999; expect(policy.expired(1)).toBe(false);
  now++; expect(policy.expired(1)).toBe(true);
  policy.touch(); expect(policy.expired(1)).toBe(false);
  now -= 1000; expect(policy.expired(1)).toBe(true);
  expect(policy.expired(0)).toBe(false);
});
