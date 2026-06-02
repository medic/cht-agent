import { expect } from 'chai';
import { crossFileValidate } from '../../src/agents/cross-file-validator';
import { GeneratedFile } from '../../src/types';

const mkFile = (relativePath: string, content: string, originalContent?: string): GeneratedFile => ({
  relativePath,
  content,
  language: 'typescript',
  type: 'source',
  description: '',
  action: originalContent ? 'modify' : 'create',
  ...(originalContent ? { originalContent } : {}),
});

describe('crossFileValidate', () => {
  describe('template-component bindings', () => {
    it('flags template binding without matching component field', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'export class Foo {\n  realField = 1;\n}\n'),
        mkFile('foo.component.html', '<div>{{ fakeField }}</div>\n'),
      ];
      const issues = crossFileValidate(files);
      const fakeIssue = issues.find(i => i.referencedIdentifier === 'fakeField');
      expect(fakeIssue).to.exist;
      expect(fakeIssue!.filePath).to.equal('foo.component.html');
    });

    it('passes when binding matches a declared field', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'export class Foo {\n  myField = 1;\n}\n'),
        mkFile('foo.component.html', '<div>{{ myField }}</div>\n'),
      ];
      const issues = crossFileValidate(files);
      expect(issues.filter(i => i.referencedIdentifier === 'myField')).to.have.length(0);
    });

    it('does NOT flag *ngFor loop variables (D5)', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'export class Foo {\n  items = [];\n}\n'),
        mkFile('foo.component.html', '<div *ngFor="let item of items">{{ item.name }}</div>\n'),
      ];
      const issues = crossFileValidate(files);
      // `item` is the loop local; must not be flagged.
      expect(issues.find(i => i.referencedIdentifier === 'item')).to.not.exist;
    });

    it('skips template when no paired component is in the batch', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.html', '<div>{{ stuff }}</div>\n'),
      ];
      expect(crossFileValidate(files)).to.have.length(0);
    });
  });

  describe('component-selector references', () => {
    it('flags Selectors.X reference without matching declaration', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'this.store.select(Selectors.getMissing);\n'),
        mkFile('webapp/src/ts/selectors/index.ts', 'export const getRealOne = createSelector(...);\n'),
      ];
      const issues = crossFileValidate(files);
      const issue = issues.find(i => i.referencedIdentifier === 'Selectors.getMissing');
      expect(issue).to.exist;
    });

    it('passes when Selectors.X matches a declaration in the same batch', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'this.store.select(Selectors.getFoo);\n'),
        mkFile('webapp/src/ts/selectors/index.ts', 'export const getFoo = createSelector(...);\n'),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'Selectors.getFoo')).to.not.exist;
    });

    it('honors originalContent for MODIFY selectors files', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'this.store.select(Selectors.getPreExisting);\n'),
        mkFile(
          'webapp/src/ts/selectors/index.ts',
          'export const getNew = createSelector(...);\n',
          'export const getPreExisting = createSelector(...);\nexport const getNew = createSelector(...);\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'Selectors.getPreExisting')).to.not.exist;
    });
  });

  describe('effect-action method calls', () => {
    it('flags this.fooActions.X call without matching action method', () => {
      const files: GeneratedFile[] = [
        mkFile(
          'webapp/src/ts/effects/contacts.effects.ts',
          'this.contactsActions.setMissing(payload);\n',
        ),
        mkFile(
          'webapp/src/ts/actions/contacts.ts',
          'export class ContactsActions {\n  setReal() {}\n}\n',
        ),
      ];
      const issues = crossFileValidate(files);
      const issue = issues.find(i => i.referencedIdentifier === 'ContactsActions.setMissing');
      expect(issue).to.exist;
    });

    it('passes when action method exists in the batch', () => {
      const files: GeneratedFile[] = [
        mkFile(
          'webapp/src/ts/effects/contacts.effects.ts',
          'this.contactsActions.setReal(payload);\n',
        ),
        mkFile(
          'webapp/src/ts/actions/contacts.ts',
          'export class ContactsActions {\n  setReal() {}\n}\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'ContactsActions.setReal')).to.not.exist;
    });

    it('handles cht-core Selectors namespace pattern with nested braces (V1)', () => {
      const files: GeneratedFile[] = [
        mkFile(
          'webapp/src/ts/modules/contacts/contacts-content.component.ts',
          'this.store.select(Selectors.getSelectedContact);\nthis.store.select(Selectors.getOther);\n',
        ),
        mkFile(
          'webapp/src/ts/selectors/index.ts',
          'export const Selectors = {\n' +
          '  getSelectedContact: createSelector(getContactsState, s => ({ x: s.x })),\n' +
          '  getOther: createSelector(getContactsState, (s) => {\n' +
          '    return s.other;\n' +
          '  }),\n' +
          '};\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.filter(i => i.referencedIdentifier?.startsWith('Selectors.'))).to.have.length(0);
    });

    it('still flags Selectors.X where X is not declared in the namespace (V1 sentinel)', () => {
      const files: GeneratedFile[] = [
        mkFile('foo.component.ts', 'this.store.select(Selectors.doesNotExist);\n'),
        mkFile(
          'webapp/src/ts/selectors/index.ts',
          'export const Selectors = {\n  getReal: createSelector(/* ... */),\n};\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'Selectors.doesNotExist')).to.exist;
    });
  });

  describe('foreign Actions class handling (V2)', () => {
    it('skips effect-action validation when action class is foreign', () => {
      const files: GeneratedFile[] = [
        mkFile(
          'webapp/src/ts/effects/contacts.effects.ts',
          // globalActions is intentionally NOT in this batch
          'this.globalActions.settingSelected();\nthis.contactsActions.setReal(p);\n',
        ),
        mkFile(
          'webapp/src/ts/actions/contacts.ts',
          'export class ContactsActions {\n  setReal() {}\n}\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'GlobalActions.settingSelected')).to.not.exist;
      expect(issues.find(i => i.referencedIdentifier === 'ContactsActions.setReal')).to.not.exist;
    });

    it('still flags missing method on a same-batch action class (V2 sentinel)', () => {
      const files: GeneratedFile[] = [
        mkFile(
          'webapp/src/ts/effects/contacts.effects.ts',
          'this.contactsActions.doesNotExist();\n',
        ),
        mkFile(
          'webapp/src/ts/actions/contacts.ts',
          'export class ContactsActions {\n  setReal() {}\n}\n',
        ),
      ];
      const issues = crossFileValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'ContactsActions.doesNotExist')).to.exist;
    });
  });
});
