import { expect } from 'chai';
import {
  CHT_DOMAINS,
  CHT_SERVICES,
  CHT_WORKFLOWS,
  CHT_LAYERS,
  CONFIG_ARTIFACTS,
  CONFIG_MECHANISMS,
} from '../../src/constants';
import schema from '../../agent-memory/schema.json';

/**
 * Locks the taxonomy: the TS const arrays (the single TS source of truth, from
 * which the CHTDomain/CHTService/CHTWorkflow/CHTLayer/ConfigArtifact/ConfigMechanism
 * unions are derived) must match the schema.json enums. Adding a value in one place
 * without the other now fails CI instead of drifting silently (the original cause of
 * the VALID_DOMAINS bug).
 */
describe('taxonomy ↔ schema.json sync', () => {
  const defs = (schema as { definitions: Record<string, { enum?: string[] }> }).definitions;

  it('CHTDomain enum matches CHT_DOMAINS', () => {
    expect(defs.CHTDomain.enum).to.have.members([...CHT_DOMAINS]);
    expect(defs.CHTDomain.enum).to.have.lengthOf(CHT_DOMAINS.length);
  });

  it('CHTWorkflow enum matches CHT_WORKFLOWS', () => {
    expect(defs.CHTWorkflow.enum).to.have.members([...CHT_WORKFLOWS]);
    expect(defs.CHTWorkflow.enum).to.have.lengthOf(CHT_WORKFLOWS.length);
  });

  it('CHTService enum matches CHT_SERVICES', () => {
    expect(defs.CHTService.enum).to.have.members([...CHT_SERVICES]);
    expect(defs.CHTService.enum).to.have.lengthOf(CHT_SERVICES.length);
  });

  it('CHTLayer enum matches CHT_LAYERS', () => {
    expect(defs.CHTLayer.enum).to.have.members([...CHT_LAYERS]);
    expect(defs.CHTLayer.enum).to.have.lengthOf(CHT_LAYERS.length);
  });

  it('ConfigArtifact enum matches CONFIG_ARTIFACTS', () => {
    expect(defs.ConfigArtifact.enum).to.have.members([...CONFIG_ARTIFACTS]);
    expect(defs.ConfigArtifact.enum).to.have.lengthOf(CONFIG_ARTIFACTS.length);
  });

  it('ConfigMechanism enum matches CONFIG_MECHANISMS', () => {
    expect(defs.ConfigMechanism.enum).to.have.members([...CONFIG_MECHANISMS]);
    expect(defs.ConfigMechanism.enum).to.have.lengthOf(CONFIG_MECHANISMS.length);
  });
});
