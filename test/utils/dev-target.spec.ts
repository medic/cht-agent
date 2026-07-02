import { expect } from 'chai';
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
    process.env.CHT_CONF_PATH = '/workspace/cht-conf-project';

    const target = resolveDevelopmentTarget('cht-conf');

    expect(target.repoPath).to.equal('/workspace/cht-conf-project');
    expect(target.toolchain).to.equal('cht-conf');
  });

  it('should fail closed for cht-conf tickets without the config mount', () => {
    delete process.env.CHT_CONF_PATH;

    expect(() => resolveDevelopmentTarget('cht-conf')).to.throw('CHT_CONF_PATH');
  });

  it('should refuse to resolve an ambiguous investigate ticket', () => {
    expect(() => resolveDevelopmentTarget('investigate')).to.throw('disambiguated');
  });

  it('should keep cht-core tickets on the cht-core working copy', () => {
    process.env.CHT_CORE_PATH = '/workspace/cht-core';

    const target = resolveDevelopmentTarget('cht-core');

    expect(target.repoPath).to.equal('/workspace/cht-core');
    expect(target.toolchain).to.equal('cht-core');
  });

  it('should default to cht-core for tickets without a layer', () => {
    delete process.env.CHT_CORE_PATH;

    const target = resolveDevelopmentTarget(undefined);

    expect(target.repoPath).to.equal('/workspace/cht-core');
    expect(target.toolchain).to.equal('cht-core');
  });
});
