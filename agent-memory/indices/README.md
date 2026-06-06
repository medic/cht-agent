# Indices

Lookup tables the agent uses to narrow where to search in cht-core before
reaching for heavier sources (Kapa docs, OpenDeepWiki). Each index maps a key
(such as a doc URL or a domain) to relevant code locations.

## How entries work

- Most entries point to specific files: the concrete implementation to search
  for that topic.
- Some entries point to directories instead. These represent structural units
  (such as major architectural components) and are meant as a map to narrow
  into, not directories to read in full.
- When an entry's intent isn't obvious from its paths alone, the index file
  records it inline (see the index's `_meta` block).
