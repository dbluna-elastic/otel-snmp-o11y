#!/bin/bash
# Script to verify SNMP metrics are being collected and exported

echo "=== Checking Container Status ==="
docker-compose ps

echo ""
echo "=== Checking Metrics Collection (last 30 seconds) ==="
docker-compose logs otel-collector --since 30s | grep -E "Metrics|resource metrics|data points" | tail -5

echo ""
echo "=== Metrics Being Collected ==="
docker-compose logs otel-collector --tail 200 | grep "Name:" | sort -u

echo ""
echo "=== Recent Metric Values ==="
docker-compose logs otel-collector --tail 100 | grep -A 1 "Name:" | grep "Value:" | tail -7

echo ""
echo "=== Checking Export Status ==="
echo "Looking for export errors or successes..."
docker-compose logs otel-collector --tail 100 | grep -E "Exporting|otlp|elastic|error|Error|deadline|timeout" | tail -10

echo ""
echo "=== Full Recent Logs (last 20 lines) ==="
docker-compose logs otel-collector --tail 20
