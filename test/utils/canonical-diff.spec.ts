import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  artifactCandidatePaths,
  diffAgainstCanonical,
  resolveCanonicalConfigRoot,
  resolveDeploymentConfigRoot,
} from '../../src/utils/canonical-diff';

describe('canonical-diff', () => {
  let canonicalRoot: string;
  let deploymentRoot: string;

  const ENV_VARS = ['CHT_CONF_PATH', 'CANONICAL_CONF', 'CHT_CORE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;

  const write = (root: string, relative: string, content: string | Buffer) => {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  beforeEach(() => {
    canonicalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-'));
    deploymentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-'));
    savedEnv = {};
    ENV_VARS.forEach((name) => {
      savedEnv[name] = process.env[name];
    });
  });

  afterEach(() => {
    fs.rmSync(canonicalRoot, { recursive: true, force: true });
    fs.rmSync(deploymentRoot, { recursive: true, force: true });
    ENV_VARS.forEach((name) => {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    });
  });

  const diff = (artifact: Parameters<typeof diffAgainstCanonical>[0]['artifact'], artifactName?: string) =>
    diffAgainstCanonical({ artifact, artifactName, deploymentRoot, canonicalRoot });

  describe('artifactCandidatePaths', () => {
    it('should probe xlsx, xml, and properties for a named form', () => {
      const candidates = artifactCandidatePaths('form', 'pnc_followup');

      expect(candidates).to.deep.equal([
        path.join('forms', 'app', 'pnc_followup.xlsx'),
        path.join('forms', 'app', 'pnc_followup.xml'),
        path.join('forms', 'app', 'pnc_followup.properties.json'),
      ]);
    });

    it('should fall back to the forms directory for an unnamed form', () => {
      expect(artifactCandidatePaths('form')).to.deep.equal([path.join('forms', 'app')]);
    });

    it('should map code artifacts to their project files', () => {
      expect(artifactCandidatePaths('task')).to.deep.equal(['tasks.js']);
      expect(artifactCandidatePaths('target')).to.deep.equal(['targets.js']);
      expect(artifactCandidatePaths('app-settings')).to.deep.equal([
        'app_settings.json',
        path.join('app_settings', 'base_settings.json'),
      ]);
      expect(artifactCandidatePaths('translations', 'en')).to.deep.equal([
        path.join('translations', 'messages-en.properties'),
      ]);
    });
  });

  describe('root resolution', () => {
    it('should return CHT_CONF_PATH as the deployment root when set', () => {
      process.env.CHT_CONF_PATH = '/mounted/config';

      expect(resolveDeploymentConfigRoot()).to.equal('/mounted/config');
    });

    it('should return undefined when CHT_CONF_PATH is unset', () => {
      delete process.env.CHT_CONF_PATH;

      expect(resolveDeploymentConfigRoot()).to.be.undefined;
    });

    it('should prefer CANONICAL_CONF for the canonical root', () => {
      process.env.CANONICAL_CONF = '/baselines/standard';

      expect(resolveCanonicalConfigRoot()).to.equal('/baselines/standard');
    });

    it('should default the canonical root to cht-core standard config', () => {
      delete process.env.CANONICAL_CONF;
      // deliberately NOT the built-in default, so a dropped env lookup fails here
      process.env.CHT_CORE_PATH = '/custom/cht-core-checkout';

      expect(resolveCanonicalConfigRoot()).to.equal(
        path.join('/custom/cht-core-checkout', 'config', 'standard')
      );
    });

    it('should treat the committed placeholder as not mounted', () => {
      fs.writeFileSync(path.join(deploymentRoot, '.cht-conf-placeholder'), '# marker\n');
      process.env.CHT_CONF_PATH = deploymentRoot;

      expect(resolveDeploymentConfigRoot()).to.be.undefined;

      const result = diffAgainstCanonical({ artifact: 'task', canonicalRoot });
      expect(result.status).to.equal('unavailable');
    });

    it('should treat an explicitly passed placeholder root as unavailable', () => {
      fs.writeFileSync(path.join(deploymentRoot, '.cht-conf-placeholder'), '# marker\n');
      write(canonicalRoot, 'tasks.js', 'module.exports = [];\n');

      const result = diff('task');

      expect(result.status).to.equal('unavailable');
    });
  });

  describe('diffAgainstCanonical', () => {
    it('should report identical artifacts', () => {
      write(canonicalRoot, 'tasks.js', 'module.exports = [];\n');
      write(deploymentRoot, 'tasks.js', 'module.exports = [];\n');

      const result = diff('task');

      expect(result.status).to.equal('identical');
      expect(result.relativePath).to.equal('tasks.js');
    });

    it('should produce a line diff for differing text artifacts', () => {
      write(canonicalRoot, 'tasks.js', 'const a = 1;\nconst b = 2;\n');
      write(deploymentRoot, 'tasks.js', 'const a = 1;\nconst b = 3;\n');

      const result = diff('task');

      expect(result.status).to.equal('differs');
      expect(result.diff).to.be.a('string');
      expect(result.diff).to.include('-const b = 2;');
      expect(result.diff).to.include('+const b = 3;');
      expect(result.summary).to.include('tasks.js');
    });

    it('should flag deployment-specific artifacts as missing-in-canonical', () => {
      write(deploymentRoot, 'purge.js', 'module.exports = {};\n');

      const result = diff('purge');

      expect(result.status).to.equal('missing-in-canonical');
      expect(result.relativePath).to.equal('purge.js');
    });

    it('should flag artifacts absent from the deployment as missing-in-deployment', () => {
      write(canonicalRoot, 'targets.js', 'module.exports = [];\n');

      const result = diff('target');

      expect(result.status).to.equal('missing-in-deployment');
    });

    it('should be unavailable when the artifact exists on neither side', () => {
      const result = diff('contact-summary');

      expect(result.status).to.equal('unavailable');
      expect(result.summary).to.include('contact-summary');
    });

    it('should be unavailable when the deployment root does not exist', () => {
      const result = diffAgainstCanonical({
        artifact: 'task',
        deploymentRoot: path.join(deploymentRoot, 'does-not-exist'),
        canonicalRoot,
      });

      expect(result.status).to.equal('unavailable');
    });

    it('should be unavailable when CHT_CONF_PATH is unset and no root is passed', () => {
      delete process.env.CHT_CONF_PATH;

      const result = diffAgainstCanonical({ artifact: 'task', canonicalRoot });

      expect(result.status).to.equal('unavailable');
      expect(result.summary).to.include('CHT_CONF_PATH');
    });

    it('should use the base_settings fallback for app-settings projects', () => {
      const nested = path.join('app_settings', 'base_settings.json');
      write(canonicalRoot, nested, '{"a":1}\n');
      write(deploymentRoot, nested, '{"a":2}\n');

      const result = diff('app-settings');

      expect(result.status).to.equal('differs');
      expect(result.relativePath).to.equal(nested);
    });

    it('should report binary-differs for differing spreadsheets without an xml sibling', () => {
      const xlsx = path.join('forms', 'app', 'pnc.xlsx');
      write(canonicalRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
      write(deploymentRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x02]));

      const result = diff('form', 'pnc');

      expect(result.status).to.equal('binary-differs');
      expect(result.summary).to.include('binary');
    });

    it('should diff the converted xml when a differing xlsx has xml on both sides', () => {
      const xlsx = path.join('forms', 'app', 'pnc.xlsx');
      const xml = path.join('forms', 'app', 'pnc.xml');
      write(canonicalRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
      write(deploymentRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x02]));
      write(canonicalRoot, xml, '<bind nodeset="next_visit" relevant="old"/>\n');
      write(deploymentRoot, xml, '<bind nodeset="next_visit" relevant="new"/>\n');

      const result = diff('form', 'pnc');

      expect(result.status).to.equal('differs');
      expect(result.summary).to.include('binary');
      expect(result.diff).to.include('-<bind nodeset="next_visit" relevant="old"/>');
      expect(result.diff).to.include('+<bind nodeset="next_visit" relevant="new"/>');
    });

    it('should compare directory listings for unnamed form artifacts', () => {
      write(canonicalRoot, path.join('forms', 'app', 'shared.xlsx'), 'x');
      write(deploymentRoot, path.join('forms', 'app', 'shared.xlsx'), 'x');
      write(deploymentRoot, path.join('forms', 'app', 'custom_form.xlsx'), 'y');

      const result = diff('form');

      expect(result.status).to.equal('differs');
      expect(result.summary).to.include('only in deployment: custom_form.xlsx');
    });

    it('should report identical directory listings', () => {
      write(canonicalRoot, path.join('forms', 'app', 'shared.xlsx'), 'x');
      write(deploymentRoot, path.join('forms', 'app', 'shared.xlsx'), 'y');

      const result = diff('form');

      expect(result.status).to.equal('identical');
      expect(result.summary).to.include('contents not compared');
    });

    it('should collapse unchanged runs and keep context around changes', () => {
      const canonicalLines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].join('\n');
      const deploymentLines = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6-changed', 'l7'].join('\n');
      write(canonicalRoot, 'tasks.js', canonicalLines);
      write(deploymentRoot, 'tasks.js', deploymentLines);

      const result = diff('task');

      expect(result.diff).to.include('…');
      expect(result.diff).to.include(' l5');
      expect(result.diff).to.include('-l6');
      expect(result.diff).to.include('+l6-changed');
      expect(result.diff).to.not.include(' l2');
    });

    it('should diff a one-line drift in a file too large for a full LCS table', () => {
      // 3000x3000 lines would exceed the cell cap; the common prefix/suffix
      // trim must reduce it to the single drifted line.
      const base = Array.from({ length: 3000 }, (_, i) => `"setting_${i}": ${i},`);
      const drifted = [...base];
      drifted[1500] = '"setting_1500": 99999,';
      write(canonicalRoot, 'app_settings.json', base.join('\n'));
      write(deploymentRoot, 'app_settings.json', drifted.join('\n'));

      const result = diff('app-settings');

      expect(result.status).to.equal('differs');
      expect(result.diff).to.be.a('string');
      expect(result.diff).to.include('-"setting_1500": 1500,');
      expect(result.diff).to.include('+"setting_1500": 99999,');
    });

    it('should skip the inline diff when files differ beyond the size cap', () => {
      const canonicalLines = Array.from({ length: 2500 }, (_, i) => `canonical ${i}`);
      const deploymentLines = Array.from({ length: 2500 }, (_, i) => `deployment ${i}`);
      write(canonicalRoot, 'tasks.js', canonicalLines.join('\n'));
      write(deploymentRoot, 'tasks.js', deploymentLines.join('\n'));

      const result = diff('task');

      expect(result.status).to.equal('differs');
      expect(result.diff).to.be.undefined;
      expect(result.summary).to.include('too large');
    });

    it('should truncate oversized diffs with an explicit marker', () => {
      write(canonicalRoot, 'tasks.js', 'short\n');
      write(deploymentRoot, 'tasks.js', `${'x'.repeat(6000)}\n`);

      const result = diff('task');

      expect(result.status).to.equal('differs');
      expect(result.diff).to.be.a('string');
      expect(result.diff).to.match(/… \(diff truncated\)$/);
    });

    it('should report drift in a sibling facet when the first facet is identical', () => {
      // The .properties.json facet is independent of the spreadsheet: a form
      // whose xlsx matches but whose properties drifted must not read 'identical'.
      const xlsx = path.join('forms', 'app', 'pnc.xlsx');
      const props = path.join('forms', 'app', 'pnc.properties.json');
      write(canonicalRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
      write(deploymentRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
      write(canonicalRoot, props, '{"title":"PNC"}\n');
      write(deploymentRoot, props, '{"title":"PNC visit"}\n');

      const result = diff('form', 'pnc');

      expect(result.status).to.equal('differs');
      expect(result.relativePath).to.equal(props);
      expect(result.diff).to.include('+{"title":"PNC visit"}');
    });

    it('should report a facet mismatch instead of missing-in-canonical', () => {
      // Deployment committed only the converted xml; canonical ships only the
      // xlsx. There is no comparable facet, but the form is NOT deployment-specific.
      write(deploymentRoot, path.join('forms', 'app', 'pnc.xml'), '<form/>\n');
      write(canonicalRoot, path.join('forms', 'app', 'pnc.xlsx'), Buffer.from([0x50, 0x4b, 0x00]));

      const result = diff('form', 'pnc');

      expect(result.status).to.equal('differs');
      expect(result.summary).to.include('no directly comparable facet');
    });

    it('should keep binary-differs when the xlsx differs but its xml is identical', () => {
      const xlsx = path.join('forms', 'app', 'pnc.xlsx');
      const xml = path.join('forms', 'app', 'pnc.xml');
      write(canonicalRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x01]));
      write(deploymentRoot, xlsx, Buffer.from([0x50, 0x4b, 0x00, 0x02]));
      write(canonicalRoot, xml, '<bind relevant="same"/>\n');
      write(deploymentRoot, xml, '<bind relevant="same"/>\n');

      const result = diff('form', 'pnc');

      expect(result.status).to.equal('binary-differs');
      expect(result.summary).to.include('binary');
    });
  });
});
