import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDevelopmentTarget } from '../../src/utils/dev-target';

describe('dev-target', () => {
  const ENV_VARS = ['CHT_CONF_PATH', 'CHT_CORE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    ENV_VARS.forEach((name) => {
      savedEnv[name] = process.env[name];
    });
  });

  afterEach(() => {
    ENV_VARS.forEach((name) => {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    });
  });

  it('should route layer: cht-conf development to the config repo mount', () => {
    process.env.CHT_CONF_PATH = '/mounted/deployment-config';

    const target = resolveDevelopmentTarget('cht-conf');

    expect(target.repoPath).to.equal('/mounted/deployment-config');
    expect(target.toolchain).to.equal('cht-conf');
  });

  it('should fail closed for cht-conf tickets without the config mount', () => {
    delete process.env.CHT_CONF_PATH;

    expect(() => resolveDevelopmentTarget('cht-conf')).to.throw('CHT_CONF_PATH');
  });

  it('should fail closed when CHT_CONF_PATH points at the committed placeholder', () => {
    const placeholder = fs.mkdtempSync(path.join(os.tmpdir(), 'conf-placeholder-'));
    try {
      fs.writeFileSync(path.join(placeholder, '.cht-conf-placeholder'), '# marker\n');
      process.env.CHT_CONF_PATH = placeholder;

      expect(() => resolveDevelopmentTarget('cht-conf')).to.throw('placeholder');
    } finally {
      fs.rmSync(placeholder, { recursive: true, force: true });
    }
  });

  it('should refuse to resolve an ambiguous investigate ticket', () => {
    expect(() => resolveDevelopmentTarget('investigate')).to.throw('disambiguated');
  });

  it('should keep cht-core tickets on the cht-core working copy', () => {
    // deliberately NOT the built-in default, so a dropped env lookup fails here
    process.env.CHT_CORE_PATH = '/custom/cht-core-checkout';

    const target = resolveDevelopmentTarget('cht-core');

    expect(target.repoPath).to.equal('/custom/cht-core-checkout');
    expect(target.toolchain).to.equal('cht-core');
  });

  it('should default to cht-core for tickets without a layer', () => {
    delete process.env.CHT_CORE_PATH;

    const target = resolveDevelopmentTarget(undefined);

    expect(target.repoPath).to.equal('/workspace/cht-core');
    expect(target.toolchain).to.equal('cht-core');
  });
});
