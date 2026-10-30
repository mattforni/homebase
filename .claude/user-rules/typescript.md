---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.mjs"
  - "**/*.js"
---

# camelCase in TypeScript, Always

Every name we choose in TypeScript and JavaScript is camelCase: variables,
functions, parameters, object keys, and the keys of any JSON our own code
writes or reads, such as a runner's summary, a payload, a fixture, or a
golden. Never a mixture of camelCase and snake_case in one codebase. Types
and classes are PascalCase.

The one exception is a name an outside system defines: a HubSpot property
(`hs_lead_status`, `disqualification_reason`), another API's field, an
environment variable, or an MCP tool name (Development README, MCP Tool
Design). Those keep the outside spelling where they meet that system, and
our own objects carry them in camelCase past the boundary.
