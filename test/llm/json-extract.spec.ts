import { expect } from 'chai';
import { extractJsonObject } from '../../src/llm/json-extract';

describe('extractJsonObject', () => {
  it('returns a lone object unchanged', () => {
    expect(extractJsonObject('{"a": 1}')).to.equal('{"a": 1}');
  });

  it('strips a ```json fence', () => {
    expect(extractJsonObject('```json\n{"a": 1}\n```')).to.equal('{"a": 1}');
  });

  it('drops prose on either side', () => {
    expect(extractJsonObject('Here you go:\n{"a": 1}\nHope that helps.')).to.equal('{"a": 1}');
  });

  // The regression. Observed on the contacts coherence gate: two valid objects
  // in one response, glued by the old outermost span into a string that cannot
  // parse — so a draft that got two answers was recorded as unchecked.
  it('takes the first object when the model emits two', () => {
    const out = '{"contradictions": [{"quoteA": "x", "quoteB": "y"}]}\n{"contradictions": []}';
    const got = extractJsonObject(out);
    expect(got).to.equal('{"contradictions": [{"quoteA": "x", "quoteB": "y"}]}');
    expect(() => JSON.parse(got as string)).to.not.throw();
  });

  it('keeps nested objects whole', () => {
    expect(extractJsonObject('{"a": {"b": {"c": 1}}}')).to.equal('{"a": {"b": {"c": 1}}}');
  });

  it('ignores a brace inside a quoted string', () => {
    // These payloads quote draft prose, and code snippets in prose have braces.
    const out = '{"quote": "for (const doc of docs.data) { yield doc }"}';
    expect(extractJsonObject(out)).to.equal(out);
  });

  it('ignores an escaped quote when tracking string boundaries', () => {
    const out = '{"quote": "he said \\"hi\\" }"}';
    expect(extractJsonObject(out)).to.equal(out);
  });

  it('falls back to the widest span when the response is truncated', () => {
    // Unbalanced input is a real truncation; hand the caller what there is.
    expect(extractJsonObject('{"a": {"b": 1}')).to.equal('{"a": {"b": 1}');
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('no json here')).to.equal(null);
  });
});
