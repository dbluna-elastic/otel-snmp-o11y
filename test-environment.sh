#!/bin/bash
# Test script for Track A (snmpsim + Logstash) and optional Track B topology

set -e

TOPOLOGY_MODE=0
if [ "${1:-}" = "--topology" ]; then
    TOPOLOGY_MODE=1
fi

echo "=========================================="
echo "SNMP Elastic Demo — Environment Test"
echo "=========================================="
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

print_test() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗${NC} $2"
        ((TESTS_FAILED++))
    fi
}

check_docker() {
    echo "=== Checking Docker ==="
    if docker ps > /dev/null 2>&1; then
        print_test 0 "Docker daemon is running"
    else
        print_test 1 "Docker daemon is not running"
        echo -e "${YELLOW}Please start Docker Desktop and try again${NC}"
        exit 1
    fi
}

check_containers() {
    echo ""
    echo "=== Checking Track A Containers ==="

    if docker compose ps 2>/dev/null | grep -q "snmpsim"; then
        if docker compose ps snmpsim 2>/dev/null | grep -qE "Up|running"; then
            print_test 0 "snmpsim is running"
        else
            print_test 1 "snmpsim is not running"
        fi
    else
        print_test 1 "snmpsim container not found"
    fi

    if docker compose ps 2>/dev/null | grep -q "logstash-snmp\|logstash"; then
        if docker compose ps logstash 2>/dev/null | grep -qE "Up|running"; then
            print_test 0 "logstash is running"
        else
            print_test 1 "logstash is not running"
        fi
    else
        print_test 1 "logstash container not found"
    fi

    if docker compose ps 2>/dev/null | grep -q "trap-sender"; then
        if docker compose ps trap-sender 2>/dev/null | grep -qE "Up|running"; then
            print_test 0 "trap-sender is running"
        else
            print_test 1 "trap-sender is not running"
        fi
    else
        print_test 1 "trap-sender container not found"
    fi
}

test_logstash_logs() {
    echo ""
    echo "=== Checking Logstash Activity ==="

    LS_LOGS=$(docker compose logs logstash --tail 100 2>/dev/null || true)

    if echo "$LS_LOGS" | grep -qiE "Pipeline started|Successfully started|Pipeline main started"; then
        print_test 0 "Logstash pipeline has started"
    else
        print_test 1 "Logstash pipeline start not detected yet (may still be booting)"
    fi

    if echo "$LS_LOGS" | grep -qiE "401|403|unauthorized|authentication"; then
        print_test 1 "Possible Elastic Cloud auth errors in Logstash logs"
        echo -e "${YELLOW}Check ES_CLOUD_ID and ES_API_KEY in .env${NC}"
    else
        print_test 0 "No obvious auth errors in recent Logstash logs"
    fi
}

test_trap_sender() {
    echo ""
    echo "=== Checking Trap Sender ==="
    TRAP_LOGS=$(docker compose logs trap-sender --tail 20 2>/dev/null || true)
    if echo "$TRAP_LOGS" | grep -qiE "linkDown|linkUp"; then
        print_test 0 "trap-sender is emitting linkDown/linkUp"
    else
        print_test 1 "No linkDown/linkUp yet (wait ~20–90s after start)"
    fi
}

test_topology_data() {
    echo ""
    echo "=== Testing Topology Data in Elasticsearch ==="

    if [ ! -f ".env" ]; then
        print_test 1 ".env not found — copy from .env.example"
        return
    fi

    # shellcheck disable=SC1091
    set -a
    source .env
    set +a

    if [ -z "${ELASTICSEARCH_URL:-}" ] || [ -z "${ELASTIC_API_KEY:-}" ]; then
        print_test 1 "ELASTICSEARCH_URL or ELASTIC_API_KEY not set in .env"
        return
    fi

    COUNT=$(curl -s -H "Authorization: ApiKey ${ELASTIC_API_KEY}" \
        "${ELASTICSEARCH_URL}/logs-snmp.topology-default/_count" 2>/dev/null \
        | grep -o '"count":[0-9]*' | cut -d: -f2 || echo "0")

    if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
        print_test 0 "Topology data stream has ${COUNT} documents"
    else
        print_test 1 "No documents in logs-snmp.topology-default (run topology loader first)"
    fi
}

main() {
    check_docker

    if ! docker compose ps 2>/dev/null | grep -q "snmpsim"; then
        echo ""
        echo -e "${YELLOW}Track A containers not running. Starting...${NC}"
        docker compose up -d --build
        echo "Waiting for containers to settle..."
        sleep 30
    fi

    check_containers
    test_logstash_logs
    test_trap_sender

    if [ $TOPOLOGY_MODE -eq 1 ]; then
        test_topology_data
    fi

    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="
    echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
    else
        echo -e "${GREEN}Tests Failed: $TESTS_FAILED${NC}"
    fi
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed! ✓${NC}"
        exit 0
    else
        echo -e "${YELLOW}Some tests failed. Check the output above for details.${NC}"
        exit 1
    fi
}

main
