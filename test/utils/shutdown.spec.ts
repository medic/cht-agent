import { expect } from 'chai';
import {
  installShutdownHandlers,
  isShutdownRequested,
  __resetShutdownForTests,
} from '../../src/utils/shutdown';

describe('shutdown utility', () => {
  afterEach(() => {
    __resetShutdownForTests();
  });

  it('should report shutdown not requested before any signal', () => {
    installShutdownHandlers();
    expect(isShutdownRequested()).to.equal(false);
  });

  it('should set the flag when SIGINT fires', () => {
    installShutdownHandlers();
    process.emit('SIGINT', 'SIGINT');
    expect(isShutdownRequested()).to.equal(true);
  });

  it('should set the flag when SIGTERM fires', () => {
    installShutdownHandlers();
    process.emit('SIGTERM', 'SIGTERM');
    expect(isShutdownRequested()).to.equal(true);
  });

  it('should be idempotent (re-calling installShutdownHandlers does not stack listeners)', () => {
    const initialCount = process.listenerCount('SIGINT');
    installShutdownHandlers();
    installShutdownHandlers();
    installShutdownHandlers();
    // process.once handlers leave the count at +1 (and clear after firing),
    // and the `installed` boolean prevents repeat registration.
    expect(process.listenerCount('SIGINT')).to.equal(initialCount + 1);
  });
});
