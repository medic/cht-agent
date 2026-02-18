# Code Context Layer — Recommendation Document

**Issue:** [medic/cht-agent#13](https://github.com/medic/cht-agent/issues/13)
**Status:** Decided
**Decision:** Self-Hosted OpenDeepWiki (Tier 2)
**Date:** 2026-02-18

---

## Summary

After squad evaluation and discussion, we are adopting **self-hosted OpenDeepWiki** as the Code Context Layer for cht-agent. This layer provides source code architecture understanding (module relationships, component diagrams, code patterns) to complement the existing Documentation Access Layer (Kapa AI).

The decision was informed by squad feedback on the original two-tier proposal, with consensus favoring the control, flexibility, and platform independence that self-hosting provides.

---

## Tool Comparison

We evaluated tools that can provide **source code architecture understanding** to complement our existing Documentation Access Layer (Kapa AI).

| | **DeepWiki (Hosted)** | **OpenDeepWiki (Self-Hosted)** | **Google CodeWiki** | **Repomix** | **Sourcegraph** | **Custom RAG** | **Local Context Files** |
|---|---|---|---|---|---|---|---|
| **Freshness** | Manual email refresh only — cht-core last indexed July 1, 2025 | **Full control** — configurable auto re-index interval (daily/weekly) + on-demand | Auto-updates on every commit | **Always fresh** — packs directly from current repo state on each call | Real-time | CI/CD triggered | Depends on developer discipline |
| **Can it auto-generate CHT architecture docs?** | Already indexed [cht-core](https://deepwiki.com/medic/cht-core/1-overview) with 19 pages — architecture, module relationships, tech stack tables | Same capability, self-hosted. Supports Anthropic, OpenAI, and other providers | Best-in-class Gemini analysis with per-commit auto-regeneration | Packs entire repos into a single LLM-friendly file — raw context, not architectural analysis | Search tool, not a documentation generator | Returns code chunks, not architectural narratives | Only as good as what humans write and maintain |
| **Can it produce module relationship diagrams?** | Auto-generates Mermaid diagrams for component relationships | Auto-generates Mermaid diagrams | Architecture, class, and sequence diagrams — auto-updated on every commit | No diagram generation | No diagram generation | Not applicable | Manual Mermaid only |
| **How does an agent access it?** | **Official free MCP server** — 3 tools: `read_wiki_structure`, `read_wiki_contents`, `ask_question`. No auth required | **Built-in MCP server** per repo via Streamable HTTP or SSE | **No MCP, no API** — browser-only. CLI extension on waitlist since Nov 2025 | **MCP server** via `repomix --mcp` — 6 tools | No official MCP server | Must build custom MCP wrapper | Not queryable without custom tooling |
| **Multi-repo (cht-core, cht-conf, cht-watchdog)** | Each repo indexed separately; supervisor merges | Each repo gets its own MCP endpoint | Separate wiki per repo | Can pack any local or remote repo on demand | Cross-repo search | Must implement per-repo | Each repo has its own files |
| **Platform support** | GitHub only | GitHub, GitLab, Gitea, and other platforms | GitHub only | Any local or remote repo | GitHub, GitLab, Bitbucket | Any source | Any source |
| **Cost** | Free | ~$10-80/mo depending on model and frequency | Free | Free & open-source | Enterprise pricing + heavy infra | Embedding + vector DB + dev time | Free |
| **Setup complexity** | Zero — just point MCP at URL | Docker Compose + model API keys | Zero for public repos | `npx repomix --mcp` — single command | Kubernetes deployment | Weeks of engineering | Just create files |

### Summary Ratings

| Tool | Architecture | MCP Server | Multi-Repo | Diagrams | Freshness | Cost | Setup | Maintenance | **Verdict** |
|---|---|---|---|---|---|---|---|---|---|
| **DeepWiki (Hosted)** | ★★★★ | ★★★★★ | ★★★★ | ★★★★ | ★★ | ★★★★★ | ★★★★★ | ★★★★ | Viable but limited control |
| **OpenDeepWiki** | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ | ★★★★★ | ★★★ | ★★★ | ★★★ | **Chosen** |
| **Google CodeWiki** | ★★★★★ | — | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | Watch — no MCP |
| **Repomix** | ★★ | ★★★★ | ★★★ | — | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | Better fit for Code Gen Layer ([#14](https://github.com/medic/cht-agent/issues/14)) |
| **Sourcegraph** | ★★★ | ★ | ★★★★★ | ★ | ★★★★★ | ★★ | ★★ | ★★ | Not recommended |
| **Custom RAG** | ★★ | ★★★ | ★★★ | — | ★★★★★ | ★★ | ★ | ★ | Not recommended |
| **Local Context Files** | ★★★ | ★ | ★★★★ | ★★ | ★★★★ | ★★★★★ | ★★★★★ | ★★ | Essential complement |

---

---

## Decision: Self-Hosted OpenDeepWiki

Based on squad feedback, we are adopting **OpenDeepWiki (Tier 2)** as the Code Context Layer. The key factors:

### Why OpenDeepWiki

1. **Full freshness control** — Weekly automated re-indexing of main/master branches, with on-demand re-indexing available. No dependency on Cognition AI's manual email process or badges.

2. **Branch-level indexing for major refactors** — Agents can use wiki generated from specific branches during large architectural changes, not just the main branch. This is great for supporting CHT development workflows where feature branches may restructure significant portions of the codebase.

3. **Platform independence (GitLab, Gitea)** — Community members and country implementations (e.g., eCHIS-KE on GitLab) can request an indexing of their repos or re-deploy the same OpenDeepWiki setup with all of our community knowledge/support. Hosted DeepWiki is GitHub-only.

4. **Model flexibility** — Supports Anthropic, OpenAI, DeepSeek, Qwen, and compatible APIs. Path to local models eliminates ongoing API costs entirely.

5. **Manageable setup and maintenance** — Docker Compose deployment estimated at hours. The advantages of control outweigh the maintenance burden. This is something we will keep an eye on and re-evaluate as the landscape changes (e.g., if Google CodeWiki ships an MCP server, or Cognition AI provides programmatic re-indexing).

6. **No wasted work** — The `.devin/wiki.json` steering files created for each CHT repo work identically with both hosted DeepWiki and self-hosted OpenDeepWiki.

### Complementary Tools

- **Repomix** — Evaluated here but better suited for the **Code Generation Layer** ([#14](https://github.com/medic/cht-agent/issues/14)). Repomix packs raw source code into LLM-friendly context — this serves code generation (the Development Supervisor needs actual files to generate compatible code) rather than architecture understanding (this layer's role). Recommend evaluating Repomix as part of issue #14.
- **Local Context Files** in `agent-memory/` continue to serve as the persistent, human-curated knowledge base.
- **Google CodeWiki** stays on the watch list — if they ship MCP/API access, it could supplement or replace OpenDeepWiki for GitHub-hosted repos.

### Estimated Costs

| Configuration | Re-index frequency | Monthly cost |
|---|---|---|
| Claude Sonnet via Anthropic API | Weekly (main only) | ~$20-40/mo |
| DeepSeek/Qwen via compatible API | Weekly (main only) | ~$10-20/mo |
| Local model (Qwen/Llama on own hardware) | Daily | $0 API cost (hardware only) |

Indexing only main/master branches weekly (per sugat's suggestion) keeps costs at the lower end of each range.

---

## Integration Architecture

The Code Context Layer (OpenDeepWiki) operates as a **separate MCP tool** queried independently from the Documentation Layer (Kapa AI). The Supervisor Agent merges results from both layers.

```
┌──────────────────────────────────────────────────────────────┐
│                   Research Supervisor                         │
│                                                              │
│  User Query: "How does sentinel process transitions?"        │
│                                                              │
│  1. Check agent-memory/mappings for known context routes     │
│                                                              │
│  ┌──────────────────┐       ┌──────────────────────┐         │
│  │   Kapa AI MCP    │       │   OpenDeepWiki MCP   │         │
│  │  (Docs Layer)    │       │  (Code Context Layer) │        │
│  └────────┬─────────┘       └──────────┬───────────┘         │
│           │                            │                     │
│           ▼                            ▼                     │
│  CHT Documentation             Code Architecture             │
│  Forum Posts                   Module Relations               │
│  GitHub Issues                 Mermaid Diagrams               │
│                                Code Patterns                  │
│           │                            │                     │
│           └────────────┬───────────────┘                     │
│                        ▼                                     │
│                 Merged Context                                │
│                        │                                     │
│                        ▼                                     │
│  2. Save combined output → outputs/context-results/          │
│                                                              │
│  3. User reviews & opens PR → agent-memory/mappings/         │
│     with new query→repo routing for future lookups           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**MCP Configuration (per repo):**
```json
{
  "mcpServers": {
    "cht-core-wiki": {
      "url": "http://our-server:8090/api/mcp?owner=medic&name=cht-core"
    },
    "cht-conf-wiki": {
      "url": "http://our-server:8090/api/mcp?owner=medic&name=cht-conf"
    },
    "cht-watchdog-wiki": {
      "url": "http://our-server:8090/api/mcp?owner=medic&name=cht-watchdog"
    }
  }
}
```

---
