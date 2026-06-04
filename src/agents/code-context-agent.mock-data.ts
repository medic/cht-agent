import { ArchitectureInsight, CHTDomain, ModuleRelationship } from '../types';

export type MockCodeContextData = {
  insights: ArchitectureInsight[];
  relationships: ModuleRelationship[];
  diagrams: string[];
};

type MockCodeContextDataset = {
  secondaryRepos: Record<string, MockCodeContextData>;
  domains: Record<CHTDomain, MockCodeContextData>;
};

const rawMockCodeContextData = String.raw`{
  "secondaryRepos": {
    "cht-conf": {
      "insights": [
        {
          "component": "cht-conf/src/lib/compile-app-settings",
          "description": "Compiles app_settings.json from declarative config files",
          "patterns": ["compilation pipeline", "JSON schema validation"],
          "dependencies": ["cht-conf/src/nools", "cht-conf/src/contact-summary"]
        }
      ],
      "relationships": [
        {
          "source": "cht-conf/src/lib",
          "target": "api/controllers/settings",
          "relationship": "calls",
          "description": "cht-conf uploads compiled config via settings API"
        }
      ],
      "diagrams": [
        "graph TD\n    A[cht-conf CLI] --> B[compile-app-settings]\n    B --> C[nools compiler]\n    B --> D[contact-summary compiler]\n    A -->|upload| E[api/settings]"
      ]
    },
    "cht-watchdog": {
      "insights": [
        {
          "component": "cht-watchdog/src/monitor",
          "description": "Monitors CHT instance health, connectivity, and sync status",
          "patterns": ["health polling", "alerting", "metric collection"],
          "dependencies": ["cht-watchdog/src/config", "cht-watchdog/src/notifier"]
        }
      ],
      "relationships": [
        {
          "source": "cht-watchdog/src/monitor",
          "target": "api/services/monitoring",
          "relationship": "calls",
          "description": "Watchdog polls API monitoring endpoints for health checks"
        }
      ],
      "diagrams": [
        "graph TD\n    A[cht-watchdog] --> B[api/monitoring]\n    A --> C[alerting/notifier]\n    B --> D[CouchDB/_active_tasks]"
      ]
    }
  },
  "domains": {
    "contacts": {
      "insights": [
        {
          "component": "api/controllers/people",
          "description": "REST controller handling contact CRUD operations and search",
          "patterns": ["RESTful endpoints", "CouchDB views", "lineage validation"],
          "dependencies": ["shared-libs/lineage", "shared-libs/contacts"]
        },
        {
          "component": "webapp/modules/contacts",
          "description": "Angular module for contact display, search, and hierarchy navigation",
          "patterns": [
            "Angular module pattern",
            "service-controller separation",
            "search indexing"
          ],
          "dependencies": ["webapp/services/db", "webapp/services/search"]
        }
      ],
      "relationships": [
        {
          "source": "webapp/modules/contacts",
          "target": "api/controllers/people",
          "relationship": "calls",
          "description": "Webapp contacts module calls people API for CRUD operations"
        },
        {
          "source": "api/controllers/people",
          "target": "shared-libs/lineage",
          "relationship": "depends-on",
          "description": "People controller uses lineage lib for hierarchy validation"
        }
      ],
      "diagrams": [
        "graph TD\n    A[webapp/contacts] -->|HTTP| B[api/people]\n    B --> C[shared-libs/lineage]\n    B --> D[CouchDB]\n    A --> E[webapp/search-service]"
      ]
    },
    "forms-and-reports": {
      "insights": [
        {
          "component": "api/controllers/forms",
          "description": "Handles form submission, validation, and XForm processing",
          "patterns": ["XForm parsing", "validation pipeline", "Enketo integration"],
          "dependencies": ["shared-libs/rules-engine", "sentinel/transitions"]
        },
        {
          "component": "sentinel/transitions",
          "description": "Background processing pipeline triggered after form submission",
          "patterns": ["event-driven transitions", "sequential processing", "error recovery"],
          "dependencies": ["shared-libs/infodoc", "api/services/db"]
        }
      ],
      "relationships": [
        {
          "source": "webapp/modules/reports",
          "target": "api/controllers/forms",
          "relationship": "calls",
          "description": "Reports module submits forms via API"
        },
        {
          "source": "api/controllers/forms",
          "target": "sentinel/transitions",
          "relationship": "depends-on",
          "description": "Form submissions trigger sentinel transitions"
        }
      ],
      "diagrams": [
        "graph TD\n    A[webapp/reports] -->|submit| B[api/forms]\n    B --> C[sentinel/transitions]\n    C --> D[shared-libs/rules-engine]\n    B --> E[Enketo]"
      ]
    },
    "tasks-and-targets": {
      "insights": [
        {
          "component": "shared-libs/rules-engine",
          "description": "Core rules engine that evaluates task and target rules",
          "patterns": ["rule evaluation", "emission pipeline", "caching"],
          "dependencies": ["shared-libs/calendar-interval", "shared-libs/contact-types-utils"]
        },
        {
          "component": "webapp/modules/tasks",
          "description": "UI module for displaying and managing tasks",
          "patterns": ["Angular module pattern", "lazy loading", "task prioritization"],
          "dependencies": ["shared-libs/rules-engine", "webapp/services/db"]
        }
      ],
      "relationships": [
        {
          "source": "webapp/modules/tasks",
          "target": "shared-libs/rules-engine",
          "relationship": "depends-on",
          "description": "Tasks module uses rules engine for task evaluation"
        },
        {
          "source": "shared-libs/rules-engine",
          "target": "shared-libs/calendar-interval",
          "relationship": "imports",
          "description": "Rules engine uses calendar-interval for date calculations"
        }
      ],
      "diagrams": [
        "graph TD\n    A[webapp/tasks] --> B[shared-libs/rules-engine]\n    A[webapp/targets] --> B\n    B --> C[shared-libs/calendar-interval]\n    B --> D[contact-types-utils]"
      ]
    },
    "authentication": {
      "insights": [
        {
          "component": "api/auth",
          "description": "Authentication middleware handling session management and permissions",
          "patterns": ["session-based auth", "role-based access", "cookie management"],
          "dependencies": ["api/services/cookie", "CouchDB/_users"]
        }
      ],
      "relationships": [
        {
          "source": "webapp/services/auth",
          "target": "api/auth",
          "relationship": "calls",
          "description": "Webapp auth service calls API auth endpoints"
        }
      ],
      "diagrams": [
        "graph TD\n    A[webapp/auth-service] -->|login/logout| B[api/auth]\n    B --> C[CouchDB/_users]\n    B --> D[api/cookie-service]"
      ]
    },
    "messaging": {
      "insights": [
        {
          "component": "sentinel/schedule/outbound",
          "description": "Outbound message scheduling and gateway integration",
          "patterns": ["scheduled processing", "gateway abstraction", "retry logic"],
          "dependencies": ["api/services/messaging", "shared-libs/message-utils"]
        }
      ],
      "relationships": [
        {
          "source": "sentinel/schedule/outbound",
          "target": "api/services/messaging",
          "relationship": "calls",
          "description": "Outbound scheduler uses messaging service for delivery"
        }
      ],
      "diagrams": [
        "graph TD\n    A[sentinel/outbound] --> B[api/messaging]\n    B --> C[SMS Gateway]\n    A --> D[shared-libs/message-utils]"
      ]
    },
    "data-sync": {
      "insights": [
        {
          "component": "api/services/replication",
          "description": "CouchDB replication management for offline-first sync",
          "patterns": ["filtered replication", "purging", "conflict resolution"],
          "dependencies": ["api/services/db", "shared-libs/purging-utils"]
        },
        {
          "component": "webapp/services/db-sync",
          "description": "Client-side sync coordination between PouchDB and CouchDB",
          "patterns": ["PouchDB sync", "offline detection", "retry backoff"],
          "dependencies": ["webapp/services/db", "api/services/replication"]
        }
      ],
      "relationships": [
        {
          "source": "webapp/services/db-sync",
          "target": "api/services/replication",
          "relationship": "calls",
          "description": "Client sync service coordinates with server replication"
        },
        {
          "source": "api/services/replication",
          "target": "shared-libs/purging-utils",
          "relationship": "depends-on",
          "description": "Replication service uses purging utils for data management"
        }
      ],
      "diagrams": [
        "graph TD\n    A[webapp/db-sync] -->|replicate| B[api/replication]\n    B --> C[CouchDB]\n    B --> D[shared-libs/purging-utils]\n    A --> E[PouchDB]"
      ]
    },
    "configuration": {
      "insights": [
        {
          "component": "cht-conf/src/lib",
          "description": "Configuration compilation and upload tooling",
          "patterns": ["declarative config", "compilation pipeline", "validation"],
          "dependencies": ["cht-conf/src/nools", "cht-conf/src/contact-summary"]
        },
        {
          "component": "api/controllers/settings",
          "description": "App settings management and validation API",
          "patterns": ["settings CRUD", "validation middleware", "defaults merging"],
          "dependencies": ["api/services/config", "shared-libs/settings"]
        }
      ],
      "relationships": [
        {
          "source": "cht-conf/src/lib",
          "target": "api/controllers/settings",
          "relationship": "calls",
          "description": "cht-conf uploads compiled config via settings API"
        },
        {
          "source": "api/controllers/settings",
          "target": "shared-libs/settings",
          "relationship": "depends-on",
          "description": "Settings controller uses shared settings library"
        }
      ],
      "diagrams": [
        "graph TD\n    A[cht-conf] -->|upload| B[api/settings]\n    B --> C[shared-libs/settings]\n    B --> D[CouchDB/app_settings]"
      ]
    },
    "interoperability": {
      "insights": [
        {
          "component": "mediator/src/routes",
          "description": "cht-interoperability mediator FHIR routes (patient, encounter, endpoint, organization, service-request) that bridge CHT and external FHIR systems via OpenHIM",
          "patterns": [
            "route-level FHIR validation",
            "shared request wrapper for consistent responses",
            "resource-specific Joi schemas"
          ],
          "dependencies": [
            "mediator/src/utils/fhir.ts",
            "mediator/src/utils/request.ts",
            "mediator/src/middlewares/index.ts"
          ]
        },
        {
          "component": "mediator/src/controllers/service-request.ts",
          "description": "Mediator controller orchestrating create vs update behavior for FHIR resources, with identifier-based lookup before create to avoid OpenMRS sync duplicates",
          "patterns": ["identifier-based existence checks", "create/update method semantics"],
          "dependencies": ["mediator/src/utils/fhir.ts"]
        },
        {
          "component": "sentinel/src/schedule/outbound.js",
          "description": "Sentinel outbound push scheduler that retries queued tasks; runs alongside the mark_for_outbound transition for immediate delivery",
          "patterns": [
            "dual transition + scheduler delivery",
            "send-once/hash-of-payload deduplication",
            "recursive infodoc retries on CouchDB 409"
          ],
          "dependencies": [
            "shared-libs/transitions/src/transitions/mark_for_outbound.js",
            "shared-libs/outbound/src/outbound.js",
            "shared-libs/infodoc/src/infodoc.js"
          ]
        },
        {
          "component": "api/src/controllers/contacts-by-phone.js",
          "description": "Public GET /api/v1/contacts-by-phone endpoint used by inbound RapidPro flows to resolve a hydrated contact from a normalized phone number",
          "patterns": [
            "versioned external API",
            "phone normalization",
            "hydration of ancestor hierarchy"
          ],
          "dependencies": ["shared-libs/phone-number/src/phone-number.js"]
        }
      ],
      "relationships": [
        {
          "source": "mediator/src/routes",
          "target": "mediator/src/utils/fhir.ts",
          "relationship": "depends-on",
          "description": "Routes apply validateFhirResource and resource helpers from the shared FHIR utility"
        },
        {
          "source": "mediator/src/routes",
          "target": "mediator/src/utils/request.ts",
          "relationship": "depends-on",
          "description": "Routes pass through requestHandler for consistent response shaping"
        },
        {
          "source": "shared-libs/transitions/src/transitions/mark_for_outbound.js",
          "target": "shared-libs/outbound/src/outbound.js",
          "relationship": "calls",
          "description": "Immediate-push transition reuses the extracted send logic shared with the scheduler"
        },
        {
          "source": "sentinel/src/schedule/outbound.js",
          "target": "shared-libs/outbound/src/outbound.js",
          "relationship": "calls",
          "description": "Scheduler retries failed pushes via the same shared outbound send logic"
        },
        {
          "source": "sentinel/src/schedule/outbound.js",
          "target": "shared-libs/infodoc/src/infodoc.js",
          "relationship": "depends-on",
          "description": "Outbound delegates infodoc completed_tasks updates to infodocLib.saveCompletedTasks for recursive 409 retries"
        },
        {
          "source": "api/src/controllers/contacts-by-phone.js",
          "target": "shared-libs/phone-number/src/phone-number.js",
          "relationship": "depends-on",
          "description": "Endpoint normalizes the phone parameter via the shared phone-number library"
        }
      ],
      "diagrams": [
        "graph TD\n    A[shared-libs/transitions/mark_for_outbound] -->|immediate| C[shared-libs/outbound]\n    B[sentinel/schedule/outbound] -->|retry| C\n    C --> D[shared-libs/infodoc]\n    C -->|HTTP| E[OpenHIM]\n    E --> F[mediator/src/routes]\n    F --> G[mediator/src/utils/fhir]\n    F --> H[FHIR Server / OpenMRS]\n    I[RapidPro] -->|inbound SMS| J[api/contacts-by-phone]\n    J --> K[shared-libs/phone-number]"
      ]
    }
  }
}`;

export const MOCK_CODE_CONTEXT_DATA = JSON.parse(
  rawMockCodeContextData
) as MockCodeContextDataset;
