#!/bin/bash
# Validate configuration files without requiring Docker

set -e

TOPOLOGY_MODE=0
if [ "${1:-}" = "--topology" ]; then
    TOPOLOGY_MODE=1
fi

echo "=========================================="
echo "Configuration Validation"
echo "=========================================="
echo ""

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

VALIDATION_PASSED=0
VALIDATION_FAILED=0

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        ((VALIDATION_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $1 not found"
        ((VALIDATION_FAILED++))
        return 1
    fi
}

check_required_files() {
    echo "=== Checking Required Files (Track A) ==="
    check_file "docker-compose.yml"
    check_file "Dockerfile.logstash"
    check_file "pipeline/snmp.conf"
    check_file "README.md"
    check_file ".env.example"
}

check_yaml_syntax() {
    echo ""
    echo "=== Validating YAML Syntax ==="
    if command -v python3 &> /dev/null; then
        if python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} docker-compose.yml has valid YAML syntax"
            ((VALIDATION_PASSED++))
        else
            echo -e "${RED}✗${NC} docker-compose.yml has invalid YAML syntax"
            ((VALIDATION_FAILED++))
        fi
        if [ -f otel-config.yaml ]; then
            if python3 -c "import yaml; yaml.safe_load(open('otel-config.yaml'))" 2>/dev/null; then
                echo -e "${GREEN}✓${NC} otel-config.yaml has valid YAML syntax"
                ((VALIDATION_PASSED++))
            else
                echo -e "${RED}✗${NC} otel-config.yaml has invalid YAML syntax"
                ((VALIDATION_FAILED++))
            fi
        fi
    else
        echo -e "${YELLOW}⚠${NC} Python3 not found, skipping YAML syntax validation"
    fi
}

check_track_a_config() {
    echo ""
    echo "=== Validating Track A (Logstash) Config ==="

    if grep -q 'snmpsim' docker-compose.yml && grep -q 'logstash' docker-compose.yml; then
        echo -e "${GREEN}✓${NC} docker-compose defines snmpsim and logstash"
        ((VALIDATION_PASSED++))
    else
        echo -e "${RED}✗${NC} Track A services missing from docker-compose.yml"
        ((VALIDATION_FAILED++))
    fi

    if grep -q 'trap-sender' docker-compose.yml; then
        echo -e "${GREEN}✓${NC} trap-sender service defined"
        ((VALIDATION_PASSED++))
    else
        echo -e "${RED}✗${NC} trap-sender service not found"
        ((VALIDATION_FAILED++))
    fi

    if grep -q 'ifOperStatus\|2.2.1.8' pipeline/snmp.conf; then
        echo -e "${GREEN}✓${NC} pipeline polls ifOperStatus"
        ((VALIDATION_PASSED++))
    else
        echo -e "${RED}✗${NC} pipeline missing ifOperStatus"
        ((VALIDATION_FAILED++))
    fi

    if grep -q 'snmptrap' pipeline/snmp.conf; then
        echo -e "${GREEN}✓${NC} pipeline has snmptrap input"
        ((VALIDATION_PASSED++))
    else
        echo -e "${RED}✗${NC} pipeline missing snmptrap input"
        ((VALIDATION_FAILED++))
    fi

    if grep -q 'metrics-snmp\|data_stream_dataset => "snmp"' pipeline/snmp.conf; then
        echo -e "${GREEN}✓${NC} pipeline outputs snmp data streams"
        ((VALIDATION_PASSED++))
    else
        echo -e "${YELLOW}⚠${NC} pipeline data stream dataset may be misconfigured"
    fi

    if grep -q 'logstash-integration-snmp' Dockerfile.logstash; then
        echo -e "${GREEN}✓${NC} Dockerfile.logstash installs SNMP plugin"
        ((VALIDATION_PASSED++))
    else
        echo -e "${RED}✗${NC} Dockerfile.logstash missing SNMP plugin install"
        ((VALIDATION_FAILED++))
    fi

    if [ -f ".env" ]; then
        echo -e "${GREEN}✓${NC} .env exists"
        ((VALIDATION_PASSED++))
        if grep -q "^ES_CLOUD_ID=.\+" .env 2>/dev/null; then
            echo -e "${GREEN}✓${NC} ES_CLOUD_ID configured"
            ((VALIDATION_PASSED++))
        else
            echo -e "${YELLOW}⚠${NC} ES_CLOUD_ID not set in .env"
        fi
        if grep -q "^ES_API_KEY=.\+" .env 2>/dev/null; then
            echo -e "${GREEN}✓${NC} ES_API_KEY configured"
            ((VALIDATION_PASSED++))
        else
            echo -e "${YELLOW}⚠${NC} ES_API_KEY not set in .env"
        fi
    else
        echo -e "${YELLOW}⚠${NC} .env not found (copy from .env.example)"
    fi
}

check_topology_files() {
    echo ""
    echo "=== Checking Topology Files (Track B) ==="
    check_file "topology/setup-topology.sh"
    check_file "topology/generate_sample_data.mjs"
    check_file "topology/example-queries.esql"

    if [ -f ".env" ] && grep -q "^ELASTICSEARCH_URL=.\+" .env 2>/dev/null; then
        echo -e "${GREEN}✓${NC} ELASTICSEARCH_URL configured in .env"
        ((VALIDATION_PASSED++))
    elif [ $TOPOLOGY_MODE -eq 1 ]; then
        echo -e "${RED}✗${NC} ELASTICSEARCH_URL not configured in .env"
        ((VALIDATION_FAILED++))
    else
        echo -e "${YELLOW}⚠${NC} ELASTICSEARCH_URL not configured in .env"
    fi

    if [ -f ".env" ] && grep -q "^ELASTIC_API_KEY=.\+" .env 2>/dev/null; then
        echo -e "${GREEN}✓${NC} ELASTIC_API_KEY configured in .env"
        ((VALIDATION_PASSED++))
    elif [ $TOPOLOGY_MODE -eq 1 ]; then
        echo -e "${RED}✗${NC} ELASTIC_API_KEY not configured in .env"
        ((VALIDATION_FAILED++))
    else
        echo -e "${YELLOW}⚠${NC} ELASTIC_API_KEY not configured in .env"
    fi
}

main() {
    check_required_files
    check_yaml_syntax
    check_track_a_config
    check_topology_files

    echo ""
    echo "=========================================="
    echo "Validation Summary"
    echo "=========================================="
    echo -e "${GREEN}Checks Passed: $VALIDATION_PASSED${NC}"
    if [ $VALIDATION_FAILED -gt 0 ]; then
        echo -e "${RED}Checks Failed: $VALIDATION_FAILED${NC}"
    else
        echo -e "${GREEN}Checks Failed: $VALIDATION_FAILED${NC}"
    fi
    echo ""

    if [ $VALIDATION_FAILED -eq 0 ]; then
        echo -e "${GREEN}All configuration checks passed! ✓${NC}"
        exit 0
    else
        echo -e "${YELLOW}Some configuration checks failed.${NC}"
        exit 1
    fi
}

main
