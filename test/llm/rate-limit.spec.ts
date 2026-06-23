import { expect } from 'chai';
import { isRateLimitError, isAuthError, isBatchFatalError } from '../../src/llm/rate-limit';

describe('isRateLimitError', () => {
  const positives = [
    'HTTP 429: rate limit exceeded',
    'rate_limit_error',
    'Claude usage limit reached. Your limit will reset at 5pm',
    'Too Many Requests',
    'Claude CLI error: 5-hour limit reached',
    "LLM triage unavailable: Claude CLI error: You've hit your session limit · resets 9:10am (UTC)",
    "Claude CLI error: You've hit your weekly limit · resets Monday",
    'You have exceeded your quota',
  ];
  for (const msg of positives) {
    it(`detects a rate limit: "${msg}"`, () => {
      expect(isRateLimitError(new Error(msg))).to.equal(true);
    });
  }

  const negatives = [
    'scrape failed',
    'Claude CLI timed out after 300000ms',
    'CLI response did not contain valid JSON object',
    'gh: command not found',
  ];
  for (const msg of negatives) {
    it(`does not flag an unrelated error: "${msg}"`, () => {
      expect(isRateLimitError(new Error(msg))).to.equal(false);
    });
  }

  it('handles non-Error values', () => {
    expect(isRateLimitError('rate limit')).to.equal(true);
    expect(isRateLimitError(null)).to.equal(false);
    expect(isRateLimitError(undefined)).to.equal(false);
  });
});

describe('isAuthError', () => {
  const positives = [
    'Claude CLI error: Failed to authenticate. API Error: 401 Invalid authentication credentials',
    'LLM triage unavailable: 401 Unauthorized',
    'not authenticated',
  ];
  for (const msg of positives) {
    it(`detects an auth failure: "${msg.slice(0, 40)}..."`, () => {
      expect(isAuthError(new Error(msg))).to.equal(true);
    });
  }

  it('does not flag unrelated errors or rate limits', () => {
    expect(isAuthError(new Error('scrape failed'))).to.equal(false);
    expect(isAuthError(new Error('rate limit exceeded'))).to.equal(false);
  });
});

describe('isBatchFatalError', () => {
  it('is true for both rate-limit and auth errors, false otherwise', () => {
    expect(isBatchFatalError(new Error('HTTP 429'))).to.equal(true);
    expect(isBatchFatalError(new Error("You've hit your session limit"))).to.equal(true);
    expect(isBatchFatalError(new Error('401 Invalid authentication credentials'))).to.equal(true);
    expect(isBatchFatalError(new Error('scrape failed'))).to.equal(false);
  });
});
