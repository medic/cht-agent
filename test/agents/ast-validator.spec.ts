import { expect } from 'chai';
import { astValidate } from '../../src/agents/ast-validator';
import { GeneratedFile } from '../../src/types';

const mkTs = (relativePath: string, content: string, originalContent?: string): GeneratedFile => ({
  relativePath,
  content,
  language: 'typescript',
  type: 'source',
  description: '',
  action: originalContent ? 'modify' : 'create',
  ...(originalContent ? { originalContent } : {}),
});

const mkJson = (relativePath: string, content: string, originalContent?: string): GeneratedFile => ({
  relativePath,
  content,
  language: 'json',
  type: 'config',
  description: '',
  action: originalContent ? 'modify' : 'create',
  ...(originalContent ? { originalContent } : {}),
});

describe('astValidate', () => {
  describe('checkPermissionLiterals (Pass 4 — addresses C1)', () => {
    it('flags can_X literal not defined in app_settings.json', () => {
      const files = [
        mkTs(
          'webapp/src/ts/modules/foo.component.ts',
          'this.auth.has("can_create_contacts_on_muted_places");\n',
        ),
        mkJson(
          'config/default/app_settings.json',
          JSON.stringify({
            permissions: {
              can_create_people_on_muted_contacts: ['nurse'],
              can_create_places_on_muted_contacts: ['nurse'],
            },
          }),
        ),
      ];
      const issues = astValidate(files);
      const issue = issues.find(i => i.referencedIdentifier === 'can_create_contacts_on_muted_places');
      expect(issue).to.exist;
      expect(issue!.expectedSource).to.equal('config/default/app_settings.json');
    });

    it('passes when can_X literal matches an app_settings.json key', () => {
      const files = [
        mkTs(
          'webapp/src/ts/modules/foo.component.ts',
          'this.auth.has("can_create_people_on_muted_contacts");\n',
        ),
        mkJson(
          'config/default/app_settings.json',
          JSON.stringify({
            permissions: { can_create_people_on_muted_contacts: ['nurse'] },
          }),
        ),
      ];
      const issues = astValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'can_create_people_on_muted_contacts')).to.not.exist;
    });

    it('honors originalContent for app_settings.json (existing permissions count)', () => {
      const files = [
        mkTs(
          'webapp/src/ts/modules/foo.component.ts',
          'this.auth.has("can_export_devices_details");\n',
        ),
        mkJson(
          'config/default/app_settings.json',
          // new content adds a new perm; doesn't remove the existing one
          JSON.stringify({
            permissions: {
              can_export_devices_details: ['national_admin'],
              can_create_people_on_muted_contacts: ['nurse'],
            },
          }),
          JSON.stringify({
            permissions: { can_export_devices_details: ['national_admin'] },
          }),
        ),
      ];
      const issues = astValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'can_export_devices_details')).to.not.exist;
    });

    it('does NOT flag non-permission string literals (e.g., short ones, no can_ prefix)', () => {
      const files = [
        mkTs(
          'webapp/src/ts/modules/foo.component.ts',
          'const x = "user_id"; const y = "auth_token"; const z = "two_words";\n',
        ),
        mkJson(
          'config/default/app_settings.json',
          JSON.stringify({ permissions: { can_real: ['admin'] } }),
        ),
      ];
      const issues = astValidate(files);
      // None of these are `can_*`, so nothing should flag.
      expect(issues).to.have.length(0);
    });
  });

  describe('checkSignatureCoverage (Pass 1 — addresses C2)', () => {
    it('flags caller that passes the old arg count', () => {
      const files = [
        mkTs(
          'webapp/src/ts/services/foo.service.ts',
          'export class FooService {\n  getX(a: string, b: number, c?: boolean) {\n    return a;\n  }\n}\n',
          'export class FooService {\n  getX(a: string, b: number) {\n    return a;\n  }\n}\n',
        ),
        mkTs(
          'webapp/src/ts/modules/bar.component.ts',
          'this.fooService.getX("x", 1);\n', // old signature: 2 args
        ),
      ];
      const issues = astValidate(files);
      const issue = issues.find(i => i.referencedIdentifier === 'getX');
      expect(issue).to.exist;
      expect(issue!.expectedSource).to.equal('webapp/src/ts/services/foo.service.ts');
    });

    it('passes when caller passes the new arg count', () => {
      const files = [
        mkTs(
          'webapp/src/ts/services/foo.service.ts',
          'export class FooService {\n  getX(a: string, b: number, c?: boolean) {\n    return a;\n  }\n}\n',
          'export class FooService {\n  getX(a: string, b: number) {\n    return a;\n  }\n}\n',
        ),
        mkTs(
          'webapp/src/ts/modules/bar.component.ts',
          'this.fooService.getX("x", 1, true);\n',
        ),
      ];
      const issues = astValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'getX')).to.not.exist;
    });

    it('does NOT flag newly added methods (no original signature to compare)', () => {
      const files = [
        mkTs(
          'webapp/src/ts/services/foo.service.ts',
          'export class FooService {\n  addX(a: string) {\n    return a;\n  }\n}\n',
          'export class FooService {\n}\n', // original had no method at all
        ),
        mkTs(
          'webapp/src/ts/modules/bar.component.ts',
          'this.fooService.addX("x");\n',
        ),
      ];
      const issues = astValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'addX')).to.not.exist;
    });

    it('does NOT flag when MODIFY file has no originalContent', () => {
      const files = [
        // No originalContent → can't tell what changed; skip.
        mkTs(
          'webapp/src/ts/services/foo.service.ts',
          'export class FooService {\n  getX(a: string, b: number, c?: boolean) { return a; }\n}\n',
        ),
        mkTs('webapp/src/ts/modules/bar.component.ts', 'this.fooService.getX("x", 1);\n'),
      ];
      const issues = astValidate(files);
      expect(issues.find(i => i.referencedIdentifier === 'getX')).to.not.exist;
    });
  });
});
