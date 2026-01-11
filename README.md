# otel-snmp-o11y

OpenTelemetry SNMP observability demo that collects SNMP metrics and exports them to Elastic Cloud.

## Architecture

This project consists of two Docker containers:

1. **SNMP Container**: Runs `net-snmp` daemon exposing system metrics (uptime, CPU load)
2. **OTEL Collector Container**: Queries SNMP metrics and exports them to Elastic Cloud

```
┌─────────────────┐         ┌──────────────────────┐         ┌──────────────┐
│  SNMP Container │◄────────┤  OTEL Collector      │─────────►│ Elastic Cloud│
│  (net-snmp)     │  SNMP   │  Container            │  HTTP   │              │
│  Port: 161/udp  │  Query  │  Port: 4318           │         │              │
└─────────────────┘         └──────────────────────┘         └──────────────┘
```

## Prerequisites

- Docker and Docker Compose installed
- Access to Elastic Cloud (endpoint and API key configured in `otel-config.yaml`)

## Quick Start

1. **Build and start the containers:**
   ```bash
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   # View all logs
   docker-compose logs -f
   
   # View SNMP container logs
   docker-compose logs -f snmp
   
   # View OTEL collector logs
   docker-compose logs -f otel-collector
   ```

3. **Stop the containers:**
   ```bash
   docker-compose down
   ```

## Verification

### Test SNMP Container

Verify the SNMP container is responding:

```bash
# From your host machine (if snmp tools are installed)
snmpget -v2c -c public localhost:161 1.3.6.1.2.1.1.3.0

# Or from within the container
docker-compose exec snmp snmpget -v2c -c public localhost 1.3.6.1.2.1.1.3.0
```

**Expected output:**
```
iso.3.6.1.2.1.1.3.0 = Timeticks: (2226) 0:00:22.26
```

Test the CPU load OID:
```bash
docker-compose exec snmp snmpget -v2c -c public localhost 1.3.6.1.4.1.2021.10.1.3.1
```

**Expected output:**
```
iso.3.6.1.4.1.2021.10.1.3.1 = STRING: "0.69"
```

### Check OTEL Collector

The OTEL collector logs will show:
- SNMP queries being executed every 30 seconds
- Metrics being collected (system.uptime, system.cpu.load)
- Debug output showing metric values
- Export attempts to Elastic Cloud

```bash
# View all collector logs
docker-compose logs otel-collector

# Filter for metrics
docker-compose logs otel-collector | grep -i "system.uptime\|system.cpu"

# Check for SNMP collection
docker-compose logs otel-collector | grep -i "snmp\|metric"
```

**Expected output in logs:**
```
Metric #0
Descriptor:
     -> Name: system.uptime
     -> Description: 
     -> Unit: s
     -> DataType: Gauge
NumberDataPoints #0
Value: 565
```

### Verify Container Status

Check that both containers are running and healthy:

```bash
docker-compose ps
```

**Expected output:**
```
NAME             IMAGE                                         STATUS
otel-collector   otel/opentelemetry-collector-contrib:latest   Up X seconds
snmp-server      otel-snmp-o11y-snmp                           Up X seconds (healthy)
```

### Verify Elastic Cloud

1. Log into your Elastic Cloud dashboard
2. Navigate to **Discover** or **Stack Management > Index Management**
3. Look for indices:
   - `otel-metrics` - SNMP metrics data
   - `otel-logs` - Log data (if configured)

**Note:** If you see 404 errors in the OTEL collector logs when exporting to Elastic Cloud:
- Verify the endpoint URL is correct in `otel-config.yaml`
- Ensure the API key has write permissions
- Check that indices can be auto-created or create them manually
- Verify network connectivity to Elastic Cloud endpoint

## Configuration

### SNMP Configuration

The SNMP container is configured with:
- Community string: `public` (read-only access)
- SNMP version: v2c
- Default agent address: `udp:161` (uses snmpd default)
- Exposed OIDs:
  - `1.3.6.1.2.1.1.3.0` - System uptime (in timeticks)
  - `1.3.6.1.4.1.2021.10.1.3.1` - CPU load (1-minute average)

**Important:** The container uses `NET_BIND_SERVICE` capability to bind to port 161 (privileged port).

To modify SNMP settings, edit `Dockerfile.snmp` and rebuild:
```bash
docker-compose build snmp
docker-compose up -d snmp
```

### OTEL Collector Configuration

Edit `otel-config.yaml` to:
- Change SNMP collection interval
- Add/remove metrics
- Modify Elastic Cloud exporter settings
- Adjust debug verbosity

After changes, restart the collector:
```bash
docker-compose restart otel-collector
```

## Troubleshooting

### SNMP container not responding

1. Check if the container is running:
   ```bash
   docker-compose ps
   ```

2. Check SNMP container logs:
   ```bash
   docker-compose logs snmp
   ```

3. Verify SNMP daemon is listening:
   ```bash
   docker-compose exec snmp netstat -ulnp | grep 161
   ```

### OTEL collector not connecting to SNMP

1. Verify network connectivity:
   ```bash
   docker-compose exec otel-collector ping snmp
   ```

2. Check OTEL collector logs for connection errors:
   ```bash
   docker-compose logs otel-collector
   ```

3. Verify the endpoint in `otel-config.yaml` is set to `udp://snmp:161`

### Metrics not appearing in Elastic Cloud

1. Verify Elastic Cloud credentials in `otel-config.yaml`:
   - Check the endpoint URL format: `https://<deployment-id>.ingest.<region>.gcp.elastic.cloud:443`
   - Verify the API key is valid and has write permissions

2. Check OTEL collector logs for export errors:
   ```bash
   docker-compose logs otel-collector | grep -i error
   ```

3. Common errors and solutions:
   - **404 error**: Indices may not exist. Create `otel-metrics` and `otel-logs` indices manually, or ensure auto-creation is enabled
   - **401/403 error**: API key lacks permissions. Generate a new API key with write access
   - **Connection timeout**: Network connectivity issue. Verify the endpoint is accessible

4. Verify metrics are being collected (even if export fails):
   ```bash
   docker-compose logs otel-collector | grep "system.uptime\|system.cpu"
   ```
   If metrics appear in logs, the SNMP collection is working; the issue is with Elastic Cloud export.

5. Test Elastic Cloud connectivity:
   ```bash
   docker-compose exec otel-collector curl -H "Authorization: ApiKey <your-api-key>" <your-endpoint>
   ```

### Port conflicts

If port 161 is already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "1161:161/udp"  # Use different host port
```

Then update `otel-config.yaml` if accessing from host, or keep `udp://snmp:161` for container-to-container communication.

## Metrics Collected

The following metrics are collected from the SNMP container:

| Metric Name | OID | Type | Unit | Description |
|------------|-----|------|------|-------------|
| `system.uptime` | 1.3.6.1.2.1.1.3.0 | Gauge | s | System uptime in seconds |
| `system.cpu.load` | 1.3.6.1.4.1.2021.10.1.3.1 | Gauge | 1 | 1-minute CPU load average |

Metrics are collected every 30 seconds (configurable in `otel-config.yaml`).

## Files

- `Dockerfile.snmp` - SNMP container definition with net-snmp configuration
- `docker-compose.yml` - Container orchestration with health checks and networking
- `otel-config.yaml` - OpenTelemetry Collector configuration (SNMP receiver, batch processor, Elastic Cloud exporter)
- `README.md` - This file

## Testing

This setup has been tested and verified:
- ✅ SNMP daemon responds to queries on port 161/udp
- ✅ OTEL collector successfully queries SNMP metrics
- ✅ Metrics are collected and formatted correctly (system.uptime, system.cpu.load)
- ✅ Debug exporter shows metric values in logs
- ⚠️ Elastic Cloud export requires valid credentials and index permissions

## License

MIT
