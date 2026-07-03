import { expect } from 'chai';
import { parseSingleFileContent } from '../../../../src/layers/code-gen/lib/output-parsing';

describe('parseSingleFileContent', () => {
  describe('trailing newline preservation (C1)', () => {
    it('should append a trailing newline when content is non-empty', () => {
      expect(parseSingleFileContent('export const x = 1;')).to.equal('export const x = 1;\n');
    });

    it('should preserve a trailing newline that was already present', () => {
      expect(parseSingleFileContent('export const x = 1;\n')).to.equal('export const x = 1;\n');
    });

    it('should strip surrounding whitespace but re-add a single trailing newline', () => {
      expect(parseSingleFileContent('  export const x = 1;  \n\n')).to.equal('export const x = 1;\n');
    });

    it('should preserve emptiness for empty input', () => {
      expect(parseSingleFileContent('')).to.equal('');
    });

    it('should preserve emptiness when input is only whitespace', () => {
      expect(parseSingleFileContent('   \n   ')).to.equal('');
    });

    it('should strip markdown code fences and still end with a single newline', () => {
      const input = '```typescript\nexport const x = 1;\n```';
      expect(parseSingleFileContent(input)).to.equal('export const x = 1;\n');
    });

    it('should strip the FILE delimiter format and still end with a single newline', () => {
      const input = '=== FILE: src/x.ts ===\nPURPOSE: A test\n--- CONTENT START ---\nexport const x = 1;\n--- CONTENT END ---';
      expect(parseSingleFileContent(input)).to.equal('export const x = 1;\n');
    });
  });
});
