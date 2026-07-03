# Semantic-gate planted-bug fixtures

These fixtures back `test/layers/test-gen/semantic-correctness-gate.spec.ts`, which
proves the test-gen layer's generated tests actually catch bugs (HARNESS section 8.3):
the layer's real `generate()` (with a stubbed LLM) emits a test that **fails** against
buggy source and **passes** against fixed source.

## The planted bug

`source.fixed.ts` mirrors the live `formatListForPrompt` in
`src/utils/domain-inference.ts`. Items are 1-indexed:

```
formatListForPrompt(['apple', 'banana'])  ->  "1. apple\n2. banana"
```

`source.buggy.ts` is a deliberate off-by-one mutation (`${i}` instead of `${i + 1}`):

```
formatListForPrompt(['apple', 'banana'])  ->  "0. apple\n1. banana"
```

`source.fixed.ts` mirrors the live source by hand. It is **not** auto-synced: if
`domain-inference.ts` changes, this fixture does not follow. The fixture is a frozen,
self-contained reference for the gate, not an import of production code.

## tsconfig.json

The inner mocha run (spawned by the spec) executes the emitted test under
`ts-node/register`. This `tsconfig.json` is copied into the per-run temp dir and
pointed at via `TS_NODE_PROJECT`; it resolves chai through the temp dir's
`node_modules` symlink (CommonJS, `esModuleInterop`).

## Files written at runtime, never committed

The spec writes `source.ts` (a copy of the chosen variant) and `gen.spec.ts` (the
module's emitted test) into a fresh `mkdtemp` temp dir per run, then removes the dir.
Only `source.fixed.ts`, `source.buggy.ts`, `tsconfig.json`, and this README are
committed.

## Manual repro

```
tmp=$(mktemp -d)
ln -s "$PWD/node_modules" "$tmp/node_modules"
cp test/fixtures/test-gen/semantic-gate/tsconfig.json "$tmp/tsconfig.json"
cp test/fixtures/test-gen/semantic-gate/source.buggy.ts "$tmp/source.ts"   # or source.fixed.ts
cat > "$tmp/gen.spec.ts" <<'EOF'
import { expect } from 'chai';
import { formatListForPrompt } from './source';
describe('formatListForPrompt numbering', () => {
  it('numbers items starting at 1', () => {
    const out = formatListForPrompt(['apple', 'banana']);
    expect(out).to.include('1. apple');
    expect(out).to.not.include('0. apple');
  });
});
EOF
TS_NODE_PROJECT="$tmp/tsconfig.json" node_modules/.bin/mocha \
  --no-config --require ts-node/register --extension ts "$tmp/gen.spec.ts"
echo "exit: $?"   # buggy -> nonzero, fixed -> 0
rm -rf "$tmp"
```

`--no-config` is required: without it the repo `.mocharc.json` injects its
`test/**/*.spec.ts` glob and pulls the whole suite into the child process.
