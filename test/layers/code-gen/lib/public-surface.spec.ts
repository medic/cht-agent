import { expect } from 'chai';
import { extractPublicSurface } from '../../../../src/layers/code-gen/lib/public-surface';

describe('extractPublicSurface', () => {
  describe('TypeScript class', () => {
    it('extracts class exports and public members', () => {
      const content = `
export class FooService {
  private secret = 1;
  public foo: string;
  bar(x: number): void { }
}
`;
      const surface = extractPublicSurface('foo.service.ts', content);
      expect(surface).to.include('export class FooService');
      expect(surface).to.include('foo:');
      expect(surface).to.include('bar(');
      expect(surface).to.not.include('secret');
    });

    it('extracts namespace-style object properties', () => {
      const content = `
export const Actions = {
  setFoo: createAction('...'),
  setBar: createAction('...'),
};
`;
      expect(extractPublicSurface('a.ts', content)).to.include('setFoo, setBar');
    });

    it('handles 4-space-indented members (D6 regex relaxation)', () => {
      const content = `
export class FooService {
    public foo: string;
    bar(x: number): void { }
}
`;
      const surface = extractPublicSurface('foo.service.ts', content);
      expect(surface).to.include('export class FooService');
      expect(surface).to.include('foo:');
      expect(surface).to.include('bar(');
    });
  });

  describe('HTML', () => {
    it('extracts component-field references from bindings and interpolation', () => {
      const content = `<div *ngIf="canCreate"><button (click)="submit()">{{ name }}</button></div>`;
      const surface = extractPublicSurface('foo.component.html', content);
      expect(surface).to.include('canCreate');
      expect(surface).to.include('submit');
      expect(surface).to.include('name');
    });

    it('does NOT false-flag *ngFor loop variables (D5 fix)', () => {
      const content = `<div *ngFor="let item of items">{{ item.name }}</div>`;
      const surface = extractPublicSurface('foo.component.html', content);
      // The iterable (items) and the field accessed on the loop var (name)
      // should be referenced; the loop var (item) itself should not be.
      const referenced = surface.split(':')[1].split(',').map(s => s.trim());
      expect(referenced).to.include('items');
      expect(referenced).to.include('name');
      expect(referenced).to.not.include('item');
    });

    it('does NOT false-flag #templateRef declarations (D5 fix)', () => {
      const content = `<ng-template #myTpl><div>{{ value }}</div></ng-template><div *ngIf="show">use</div>`;
      const surface = extractPublicSurface('foo.component.html', content);
      const referenced = surface.split(':')[1].split(',').map(s => s.trim());
      expect(referenced).to.include('show');
      expect(referenced).to.include('value');
      expect(referenced).to.not.include('myTpl');
    });
  });

  describe('JSON', () => {
    it('extracts top-level keys with their value types', () => {
      const content = JSON.stringify({ a: 1, b: 'str', c: { nested: true } });
      const surface = extractPublicSurface('foo.json', content);
      expect(surface).to.include('a:');
      expect(surface).to.include('b:');
      expect(surface).to.include('c:');
    });
  });

  describe('properties', () => {
    it('extracts keys from a .properties file', () => {
      const content = `# a comment\nkey.one=value one\nkey.two=value two\n`;
      const surface = extractPublicSurface('msg.properties', content);
      expect(surface).to.include('key.one');
      expect(surface).to.include('key.two');
    });
  });

  describe('multi-line namespace bodies (V3)', () => {
    it('extracts properties from cht-core-style Selectors namespace with multi-line callbacks', () => {
      const content =
        'export const Selectors = {\n' +
        '  getSelectedContact: createSelector(getContactsState, s => ({ x: s.x })),\n' +
        '  getMultiLine: createSelector(getContactsState, (state) => {\n' +
        '    return state.other;\n' +
        '  }),\n' +
        '  getSimple: createSelector(getContactsState, s => s.simple),\n' +
        '};\n';
      const surface = extractPublicSurface('webapp/src/ts/selectors/index.ts', content);
      expect(surface).to.include('getSelectedContact');
      expect(surface).to.include('getMultiLine');
      expect(surface).to.include('getSimple');
      expect(surface).to.include('namespace Selectors:');
    });

    it('handles empty Selectors namespace gracefully', () => {
      const content = 'export const Selectors = {\n};\n';
      const surface = extractPublicSurface('webapp/src/ts/selectors/index.ts', content);
      expect(surface).to.not.include('namespace Selectors:');
    });
  });
});
