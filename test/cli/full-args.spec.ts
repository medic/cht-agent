import { expect } from 'chai';
import { parseCliArgs } from '../../src/cli/full-args';

/** argv shape is [node, script, ...userArgs]. */
const argv = (...userArgs: string[]): string[] => ['node', 'full.js', ...userArgs];

describe('full CLI arg parsing (#51)', () => {
  it('parses a bare ticket path with verbose off', () => {
    const result = parseCliArgs(argv('tickets/my-ticket.md'));
    expect(result).to.deep.equal({ verbose: false, ticketPath: 'tickets/my-ticket.md' });
  });

  it('enables verbose with --verbose', () => {
    const result = parseCliArgs(argv('tickets/my-ticket.md', '--verbose'));
    expect(result.verbose).to.equal(true);
    expect(result.ticketPath).to.equal('tickets/my-ticket.md');
  });

  it('enables verbose with the -v alias', () => {
    expect(parseCliArgs(argv('-v', 'tickets/t.md')).verbose).to.equal(true);
  });

  it('resolves the ticket path regardless of flag position (flag first)', () => {
    const result = parseCliArgs(argv('--verbose', 'tickets/t.md'));
    expect(result.ticketPath).to.equal('tickets/t.md');
    expect(result.verbose).to.equal(true);
  });

  it('returns a null ticket path when only flags are given', () => {
    const result = parseCliArgs(argv('--verbose'));
    expect(result.ticketPath).to.be.null;
    expect(result.verbose).to.equal(true);
  });

  it('returns defaults for no args', () => {
    expect(parseCliArgs(argv())).to.deep.equal({ verbose: false, ticketPath: null });
  });
});
