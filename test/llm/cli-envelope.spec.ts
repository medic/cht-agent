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

  it('takes the last result when the transcript holds more than one', () => {
    const two = '[{"type":"result","result":"first"},{"type":"result","result":"second"}]';
    expect(findResultEnvelope(two)).to.include({ result: 'second' });
  });

  it('uses the errors list as the result text for error results', () => {
    const maxTurns = '{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["Reached maximum number of turns (150)"]}';
    expect(findResultEnvelope(maxTurns)).to.include({ result: 'Reached maximum number of turns (150)' });
  });

  it('stays fast on long bracketed noise with no JSON', function () {
    this.timeout(1000);
    const noise = Array.from({ length: 2000 }, (_, i) => `[warn] line ${i} [x]`).join('\n');
    expect(findResultEnvelope(noise)).to.be.null;
  });

  it('finds a pretty-printed result object after bracketed noise', () => {
    expect(findResultEnvelope('[warn] x\n{\n  "type": "result",\n  "result": "ok"\n}\n')).to.include({ result: 'ok' });
  });
});
