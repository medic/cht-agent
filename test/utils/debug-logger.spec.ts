import { expect } from 'chai';
import {
  createDebugLogger,
  redactSensitive,
  truncate,
} from '../../src/utils/debug-logger';

describe('debug-logger utility (#51)', () => {
  /** A capturing sink so tests never touch real stderr. */
  const makeSink = () => {
    const lines: string[] = [];
    return { sink: (line: string) => lines.push(line), lines };
  };

  describe('redactSensitive', () => {
    it('redacts Anthropic sk-ant- API keys', () => {
      const out = redactSensitive('key is sk-ant-api03-abcDEF123456_-xyz done');
      expect(out).to.not.include('abcDEF123456');
      expect(out).to.include('sk-ant-***REDACTED***');
    });

    it('redacts other sk- prefixed keys (e.g. OpenAI)', () => {
      const out = redactSensitive('token sk-abcdefghijklmnopqrstuvwxyz012345');
      expect(out).to.include('sk-***REDACTED***');
      expect(out).to.not.include('abcdefghijklmnopqrstuvwxyz');
    });

    it('redacts the whole credential in an Authorization header', () => {
      const out = redactSensitive('Authorization: Bearer abcdef123456.token-value');
      expect(out).to.equal('Authorization: ***REDACTED***');
      expect(out).to.not.include('abcdef123456.token-value');
    });

    it('redacts a standalone Bearer token outside an Authorization header', () => {
      const out = redactSensitive('sent header value Bearer abcdef123456xyz to server');
      expect(out).to.include('Bearer ***REDACTED***');
      expect(out).to.not.include('abcdef123456xyz');
    });

    it('redacts key/value secrets (api_key, token, password, authorization)', () => {
      const json = '{"api_key":"supersecretvalue","ANTHROPIC_API_KEY":"another-secret-1234","name":"ok"}';
      const out = redactSensitive(json);
      expect(out).to.not.include('supersecretvalue');
      expect(out).to.not.include('another-secret-1234');
      expect(out).to.include('***REDACTED***');
      // Non-sensitive fields are preserved.
      expect(out).to.include('"name":"ok"');
    });

    it('leaves non-sensitive text untouched', () => {
      const text = 'ordinary log line with numbers 12345 and words';
      expect(redactSensitive(text)).to.equal(text);
    });
  });

  describe('truncate', () => {
    it('leaves short text unchanged', () => {
      expect(truncate('short', 100)).to.equal('short');
    });

    it('truncates long text and reports the original length', () => {
      const out = truncate('x'.repeat(50), 10);
      expect(out).to.match(/^x{10}… \(50 chars total\)$/);
    });
  });

  describe('createDebugLogger', () => {
    it('writes labelled output to the sink when enabled', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: true, sink });
      debug.log('phase', 'research');
      expect(lines).to.have.length(1);
      expect(lines[0]).to.equal('[debug] phase: research\n');
    });

    it('logs a bare label with no payload', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: true, sink });
      debug.log('starting');
      expect(lines[0]).to.equal('[debug] starting\n');
    });

    it('is a no-op when disabled (normal output unchanged)', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: false, sink });
      debug.log('should not appear', { secret: 'x' });
      const stop = debug.time('phase');
      stop();
      expect(lines).to.have.length(0);
      expect(debug.enabled).to.equal(false);
    });

    it('redacts and truncates payloads before writing', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: true, sink, maxLength: 20 });
      debug.log('config', { api_key: 'topsecretkey', filler: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
      expect(lines[0]).to.not.include('topsecretkey');
      expect(lines[0]).to.include('… (');
    });

    it('serializes object payloads as JSON', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: true, sink });
      debug.log('opts', { previewMode: true, files: 3 });
      expect(lines[0]).to.include('{"previewMode":true,"files":3}');
    });

    it('does not throw on circular payloads', () => {
      const { sink, lines } = makeSink();
      const debug = createDebugLogger({ enabled: true, sink });
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => debug.log('circular', circular)).to.not.throw();
      expect(lines).to.have.length(1);
    });

    it('time() logs elapsed milliseconds using the injected clock', () => {
      const { sink, lines } = makeSink();
      let t = 1000;
      const debug = createDebugLogger({ enabled: true, sink, now: () => t });
      const stop = debug.time('workflow');
      t = 1042;
      stop();
      expect(lines[0]).to.equal('[debug] workflow (42ms)\n');
    });
  });
});
