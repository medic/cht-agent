import { expect } from 'chai';
import { findResultEnvelope } from '../../src/llm/cli-envelope';

describe('findResultEnvelope', () => {
  const transcript = '[{"type":"system","subtype":"init"},{"type":"result","result":"ok","total_cost_usd":0.1}]';

  it('finds the result in an array transcript preceded by bracketed noise', () => {
    expect(findResultEnvelope(`warning [cli]: retrying\n${transcript}`)).to.include({ type: 'result', result: 'ok' });
  });

  it('finds the result when bracketed noise surrounds the transcript on both sides', () => {
    expect(findResultEnvelope(`warn [a]\n${transcript}\nhook [done] {x}`)).to.include({ result: 'ok' });
  });

  it('returns null when no line block holds a result message', () => {
    expect(findResultEnvelope('warn [a]\n[{"type":"system"}]\n')).to.be.null;
  });
});
