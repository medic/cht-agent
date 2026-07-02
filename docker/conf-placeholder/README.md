# cht-conf project placeholder

Default mount target for `CHT_CONF_PATH` in `docker-compose.cht-agent.yml`, so
sessions that only work on cht-core tickets need no extra setup. For
`layer: cht-conf` tickets, set `CHT_CONF_PATH` to the deployment's config
working copy instead:

```bash
CHT_CORE_PATH=$HOME/src/cht-core \
CHT_CONF_PATH=$HOME/src/my-deployment-config \
  docker compose -f docker/docker-compose.cht-agent.yml up -d
```

Inside the container the project appears at `/workspace/cht-conf-project`
(writable — the dev/qa gate routes `layer: cht-conf` development here, never
into cht-core). The canonical baseline for config diffs defaults to
`/workspace/cht-core/config/standard`; override with `CANONICAL_CONF`
(a path visible inside the container).
