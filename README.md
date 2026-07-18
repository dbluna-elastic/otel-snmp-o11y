# otel-snmp-o11y

Local Docker demo that simulates SNMP devices and ships live polls + traps into Elastic Cloud, with optional Network Topology sample data.

| Track | Data | How | Elastic Cloud destination |
|-------|------|-----|---------------------------|
| **A — Live SNMP (default)** | System info, interface status/counters, link up/down traps | snmpsim + Logstash + trap-sender | `metrics-snmp-demo`, `logs-snmp-demo` |
| **B — Topology schema** | Interfaces, ARP, MAC, BGP, OSPF (multi-site) | Sample data generator | `logs-snmp.topology-default` |
| **OTEL (optional)** | Host scalars (uptime, CPU, memory) | net-snmp + OTEL Collector | OTLP metrics indices |

> **Elastic Cloud limitation:** The [Network Topology Kibana plugin](https://www.elastic.co/docs/solutions/observability/infra-and-hosts/network-topology) requires self-managed Kibana. Track B loads the same schema for Discover/ES|QL on Elastic Cloud.

## Architecture (Track A)

```
┌─────────────────────────────────────────────────────────┐
│  Docker Desktop                                         │
│                                                         │
│  ┌──────────────┐        ┌────────────────────┐         │
│  │   snmpsim    │◄───────│     logstash       │         │
│  │  (fake SNMP  │  poll  │  (snmp + snmptrap) │──┐      │
│  │   devices)   │        │                    │  │      │
│  └──────────────┘        └────────────────────┘  │      │
│         ▲                                        │      │
│  ┌──────────────┐                                │      │
│  │ trap-sender  │── linkDown / linkUp every 45s ─┘      │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
                         │ HTTPS
                         ▼
              ┌──────────────────────┐
              │  Elastic Cloud       │
              │  metrics-snmp-demo   │
              │  logs-snmp-demo      │
              └──────────────────────┘
```

- **snmpsim** — answers SNMP GETs/walks; community string selects which simulated device
- **Logstash** — polls every 30s (sys + IF-MIB table including `ifAdminStatus` / `ifOperStatus`), listens for traps on UDP/1162
- **trap-sender** — fires linkDown then linkUp so Discover has live events

## Prerequisites

- Docker Desktop (~2 GB RAM free for containers)
- Elastic Cloud deployment — create an API key with `write` + `auto_configure` on `metrics-snmp.*` and `logs-snmp.*`
- Copy Cloud ID from the Elastic Cloud console

## Setup

1. **Configure credentials:**

   ```bash
   cp .env.example .env
   # Set ES_CLOUD_ID, ES_API_KEY, and STACK_VERSION (match your deployment)
   ```

   | Variable | Used by | Notes |
   |----------|---------|-------|
   | `ES_CLOUD_ID` | Logstash (Track A) | From Elastic Cloud console |
   | `ES_API_KEY` | Logstash (Track A) | Key only, no `ApiKey` prefix |
   | `STACK_VERSION` | Logstash image | e.g. `9.0.0` |
   | `ELASTICSEARCH_URL` / `ELASTIC_API_KEY` | Track B topology | Elasticsearch API URL (`*.es.*`) |
   | `ELASTIC_CLOUD_INGEST_ENDPOINT` / `ELASTIC_OTLP_AUTHORIZATION` | Optional OTEL profile | OTLP ingest |

2. **Start Track A (live SNMP):**

   ```bash
   docker compose up -d --build
   docker compose logs -f logstash
   ```

   First build installs the Logstash SNMP plugin (can take a few minutes).

3. **Load topology sample data (Track B, optional):**

   ```bash
   ./topology/setup-topology.sh
   node topology/generate_sample_data.mjs
   # or: docker compose --profile topology run --rm topology-loader
   ```

4. **Optional OTEL path:**

   ```bash
   docker compose --profile otel up -d
   ```

## Verify in Kibana (Track A)

1. Create data views for `metrics-snmp-demo*` and `logs-snmp-demo*`
2. Filter polls by device / interface fields from snmpsim
3. Watch traps on `logs-snmp-demo*` — linkDown / linkUp about every 45s

### Dashboard ideas

- Line: interface in/out octets per device
- Table: top interfaces by throughput
- Timeline: trap events with `event.action`
- Metric: sysUpTime per device

## Track A devices (snmpsim communities)

| `host.name` | Community | Role |
|-------------|-----------|------|
| `core-switch-01` | `public` | Default snmpsim agent |
| `edge-router-01` | `recorded/linux-full-walk` | Built-in recorded walk |
| `access-switch-02` | `variation/multiplex` | Built-in variation |

Polled fields include `sysDescr`, `sysUpTime`, `sysName`, `sysLocation`, and per-interface `ifDescr`, `ifAdminStatus`, `ifOperStatus`, `ifInOctets`, `ifOutOctets`.

## Track B: Topology sample network

Multi-site sample data (HQ-DC1, Branch-NYC, Branch-CHI) with BGP/OSPF/ARP/MAC and port faults. See [`topology/example-queries.esql`](topology/example-queries.esql).

Built-in port fault scenarios:

- **HQ-DC1** link failure: `hq-dist-sw-01 Eth1/1` ↔ `hq-access-sw-01 Eth1/1`
- **HQ-DC1** edge: `hq-access-sw-03 Eth1/4` admin-up / oper-down
- **Branch-NYC** link failure: `nyc-sw-01 Eth1/2` ↔ `nyc-sw-03 Eth1/1`
- **Branch-NYC** admin shutdown: `nyc-sw-02 Eth1/3`
- **Branch-CHI** link failure: `chi-sw-01 Eth1/2` ↔ `chi-sw-02 Eth1/1`

## Custom snmpsim recordings

```bash
snmpwalk -v2c -c public -On <device-ip> 1.3.6.1 > snmpsim-data/my-router.snmprec
```

Then add a host in [`pipeline/snmp.conf`](pipeline/snmp.conf):

```ruby
{ host => "udp:snmpsim/161" community => "custom/my-router" version => "2c" name => "hq-router" }
```

## Dashboards

### Tiered SNMP demo (map → site → faceplate)

Built from [`../snmp-dashboard-design.md`](../snmp-dashboard-design.md). Presenter path: Tier 0 → pick a site → Tier 1 → pick a switch → Tier 2.

| Tier | Title | Open |
|------|-------|------|
| 0 | SNMP — US Sites Overview | [Dashboard](https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier0-us-map) |
| 1 | SNMP — Site Detail | [Dashboard](https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier1-site-detail) |
| 2 | SNMP — Device Faceplate | [Dashboard](https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier2-device-faceplate) |
| Map | SNMP Site Health | [Map](https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/maps#/map/snmp-sites-health-map) |

Definitions and deploy:

```bash
# After Track B sample data is loaded:
node kibana/tiered/deploy.mjs
# Or only refresh site health / topology edges:
node kibana/tiered/seed-sites-topology.mjs
```

- Definitions: [`kibana/tiered/`](kibana/tiered/)
- Design notes: [`../snmp-dashboard-design.md`](../snmp-dashboard-design.md)
- Use the **Site** / **Device** controls at the top of each dashboard (no manual KQL needed)
- Demo faults: `hq-access-sw-03 Eth1/4` oper-down; `nyc-sw-02 Eth1/3` admin-down; faulted uplinks show as `link_status=down` on Tier 1

### Legacy: SNMP Switch Port Status

Track B switch port admin/oper view (single dashboard):  
[Open](https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/cf961475-5d6d-48f1-8d0f-feb316534599) · [`kibana/snmp-switch-port-dashboard.json`](kibana/snmp-switch-port-dashboard.json)

### Switch faceplate (Vega-Lite)

A 24-port (2×12) color-coded faceplate (also on Tier 2):

| Color | Meaning |
|-------|---------|
| Green | Admin up, oper up |
| Red | Admin up, oper down (link/cable fault) |
| Gray | Admin down (intentional shut) |

- Spec: [`kibana/vega/switch-faceplate-hq-access-sw-03.json`](kibana/vega/switch-faceplate-hq-access-sw-03.json) (hard-coded host) · context-aware: [`kibana/vega/switch-faceplate-context.json`](kibana/vega/switch-faceplate-context.json)
- Row 1 = `Eth1/1`–`Eth1/12`, Row 2 = `Eth1/13`–`Eth1/24`

Use time range **Last 15 minutes** after regenerating sample data.

## Verification scripts

```bash
./validate-config.sh
./validate-config.sh --topology
./test-environment.sh          # Track A containers
./test-environment.sh --topology
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Logstash can't reach snmpsim | Use hostname `snmpsim`, not `localhost` |
| No data in Elastic Cloud | `docker compose logs logstash` — auth errors; API key privileges on `metrics-snmp.*` / `logs-snmp.*` |
| Traps not arriving | trap-sender must target `logstash:1162`; wait ~20s after start |
| Version mismatch | Set `STACK_VERSION` in `.env` to match your deployment |
| Ugly OID field names | Adjust `oid_root_skip` in `pipeline/snmp.conf` |
| First start slow | Logstash image build installs SNMP plugin once |

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Track A default; profiles `otel`, `topology` |
| `Dockerfile.logstash` | Logstash + SNMP integration plugin |
| `pipeline/snmp.conf` | SNMP poll + trap → Elastic Cloud data streams |
| `snmpsim-data/` | Optional custom `.snmprec` recordings |
| `otel-config.yaml` | Optional OTEL Collector config (`--profile otel`) |
| `Dockerfile.snmp` | Optional net-snmp agent (`--profile otel`) |
| `topology/*` | Track B schema setup + sample data |
| `kibana/tiered/*` | Tiered dashboards (seed + deploy) |
| `.env.example` | Credential template |

## Related Links

- [SNMP Topology Data in Kibana](https://www.elastic.co/observability-labs/blog/snmp-topology-data-kibana-collection-canvas)
- [Logstash SNMP integration](https://www.elastic.co/guide/en/logstash/current/plugins-integrations-snmp.html)
- [snmpsim](https://github.com/etingof/snmpsim)
- [Network Topology plugin](https://github.com/elastic/kibana-network-topology-plugin)

## License

MIT
