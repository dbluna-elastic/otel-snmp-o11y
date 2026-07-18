# Deployed tiered SNMP dashboards

| Tier | Title | URL |
|------|-------|-----|
| 0 | SNMP — US Sites Overview | https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier0-us-map |
| 1 | SNMP — Site Detail | https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier1-site-detail |
| 2 | SNMP — Device Faceplate | https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/dashboards#/view/snmp-tier2-device-faceplate |
| Map | SNMP Site Health | https://gawdzilla-0d3e9e.kb.us-east-2.aws.elastic-cloud.com/app/maps#/map/snmp-sites-health-map |

Re-seed health metrics after regenerating Track B data:

```bash
node kibana/tiered/seed-sites-topology.mjs
```

Redeploy:

```bash
node kibana/tiered/deploy.mjs
```
