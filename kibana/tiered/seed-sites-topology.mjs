#!/usr/bin/env node
/**
 * Seed snmp-sites (geo + health) and snmp-topology (nodes/edges) for the
 * tiered SNMP dashboards. Health metrics are computed from
 * logs-snmp.topology-default so Tier 0 map borders reflect demo faults.
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ES = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const API_KEY = process.env.ELASTIC_API_KEY || process.env.ES_API_KEY || '';
const USER = process.env.ELASTIC_USER || 'elastic';
const PASS = process.env.ELASTIC_PASSWORD || 'changeme';

function authHeaders() {
  if (API_KEY) return { Authorization: `ApiKey ${API_KEY}` };
  return { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` };
}

async function es(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${ES}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 500)}`);
  return json;
}

const SITES = [
  {
    site: 'HQ-DC1',
    city: 'Austin, TX',
    location: { lat: 30.2672, lon: -97.7431 },
    device_count: 14,
    switch_count: 6,
  },
  {
    site: 'Branch-NYC',
    city: 'New York, NY',
    location: { lat: 40.7128, lon: -74.006 },
    device_count: 8,
    switch_count: 3,
  },
  {
    site: 'Branch-CHI',
    city: 'Chicago, IL',
    location: { lat: 41.8781, lon: -87.6298 },
    device_count: 6,
    switch_count: 2,
  },
];

// Manual layouts for Tier 1 topology Vega (x/y in 0–100 space)
const TOPOLOGY = {
  'HQ-DC1': {
    nodes: [
      { id: 'hq-core-rtr-01', type: 'router', role: 'core', x: 20, y: 10 },
      { id: 'hq-core-rtr-02', type: 'router', role: 'core', x: 50, y: 10 },
      { id: 'hq-fw-01', type: 'firewall', role: 'core', x: 35, y: 28 },
      { id: 'hq-dist-sw-01', type: 'switch', role: 'distribution', x: 20, y: 46 },
      { id: 'hq-dist-sw-02', type: 'switch', role: 'distribution', x: 50, y: 46 },
      { id: 'hq-access-sw-01', type: 'switch', role: 'access', x: 8, y: 66 },
      { id: 'hq-access-sw-02', type: 'switch', role: 'access', x: 28, y: 66 },
      { id: 'hq-access-sw-03', type: 'switch', role: 'access', x: 48, y: 66 },
      { id: 'hq-access-sw-04', type: 'switch', role: 'access', x: 68, y: 66 },
      { id: 'hq-srv-esxi-01', type: 'server', role: 'server', x: 5, y: 88 },
      { id: 'hq-srv-esxi-02', type: 'server', role: 'server', x: 25, y: 88 },
      { id: 'hq-srv-db-01', type: 'server', role: 'server', x: 48, y: 88 },
      { id: 'hq-ap-01', type: 'ap', role: 'access', x: 70, y: 88 },
      { id: 'hq-ap-02', type: 'ap', role: 'access', x: 88, y: 88 },
    ],
    edges: [
      ['hq-core-rtr-01', 'hq-core-rtr-02'],
      ['hq-core-rtr-01', 'hq-fw-01'],
      ['hq-core-rtr-02', 'hq-fw-01'],
      ['hq-fw-01', 'hq-dist-sw-01'],
      ['hq-fw-01', 'hq-dist-sw-02'],
      ['hq-dist-sw-01', 'hq-dist-sw-02'],
      ['hq-dist-sw-01', 'hq-access-sw-01'],
      ['hq-dist-sw-01', 'hq-access-sw-02'],
      ['hq-dist-sw-02', 'hq-access-sw-03'],
      ['hq-dist-sw-02', 'hq-access-sw-04'],
      ['hq-access-sw-01', 'hq-srv-esxi-01'],
      ['hq-access-sw-01', 'hq-ap-01'],
      ['hq-access-sw-02', 'hq-srv-esxi-02'],
      ['hq-access-sw-03', 'hq-srv-db-01'],
      ['hq-access-sw-04', 'hq-ap-02'],
    ],
  },
  'Branch-NYC': {
    nodes: [
      { id: 'nyc-rtr-01', type: 'router', role: 'core', x: 50, y: 12 },
      { id: 'nyc-fw-01', type: 'firewall', role: 'core', x: 50, y: 32 },
      { id: 'nyc-sw-01', type: 'switch', role: 'distribution', x: 50, y: 52 },
      { id: 'nyc-sw-02', type: 'switch', role: 'access', x: 28, y: 72 },
      { id: 'nyc-sw-03', type: 'switch', role: 'access', x: 72, y: 72 },
      { id: 'nyc-srv-01', type: 'server', role: 'server', x: 28, y: 92 },
      { id: 'nyc-ap-01', type: 'ap', role: 'access', x: 62, y: 92 },
      { id: 'nyc-ap-02', type: 'ap', role: 'access', x: 82, y: 92 },
    ],
    edges: [
      ['nyc-rtr-01', 'nyc-fw-01'],
      ['nyc-fw-01', 'nyc-sw-01'],
      ['nyc-sw-01', 'nyc-sw-02'],
      ['nyc-sw-01', 'nyc-sw-03'],
      ['nyc-sw-02', 'nyc-srv-01'],
      ['nyc-sw-03', 'nyc-ap-01'],
      ['nyc-sw-03', 'nyc-ap-02'],
    ],
  },
  'Branch-CHI': {
    nodes: [
      { id: 'chi-rtr-01', type: 'router', role: 'core', x: 50, y: 15 },
      { id: 'chi-fw-01', type: 'firewall', role: 'core', x: 50, y: 38 },
      { id: 'chi-sw-01', type: 'switch', role: 'distribution', x: 50, y: 58 },
      { id: 'chi-sw-02', type: 'switch', role: 'access', x: 50, y: 78 },
      { id: 'chi-srv-01', type: 'server', role: 'server', x: 30, y: 95 },
      { id: 'chi-ap-01', type: 'ap', role: 'access', x: 70, y: 95 },
    ],
    edges: [
      ['chi-rtr-01', 'chi-fw-01'],
      ['chi-fw-01', 'chi-sw-01'],
      ['chi-sw-01', 'chi-sw-02'],
      ['chi-sw-02', 'chi-srv-01'],
      ['chi-sw-02', 'chi-ap-01'],
    ],
  },
};

// Link-correlated faults from generate_sample_data.mjs PORT_FAULTS
const FAULTED_LINKS = new Set([
  'hq-dist-sw-01|hq-access-sw-01',
  'hq-access-sw-01|hq-dist-sw-01',
  'nyc-sw-01|nyc-sw-03',
  'nyc-sw-03|nyc-sw-01',
  'chi-sw-01|chi-sw-02',
  'chi-sw-02|chi-sw-01',
]);

async function ensureIndex(name, mappings) {
  const exists = await fetch(`${ES}/${name}`, { headers: authHeaders() });
  if (exists.status === 200) return;
  await es(`/${name}`, { method: 'PUT', body: { mappings } });
}

async function ensureIndices() {
  await ensureIndex('snmp-sites', {
    properties: {
      site: { type: 'keyword' },
      city: { type: 'keyword' },
      location: { type: 'geo_point' },
      lat: { type: 'float' },
      lon: { type: 'float' },
      device_count: { type: 'integer' },
      switch_count: { type: 'integer' },
      ports_down: { type: 'integer' },
      error_count: { type: 'long' },
      health_score: { type: 'integer' },
      status: { type: 'keyword' },
      '@timestamp': { type: 'date' },
    },
  });

  await ensureIndex('snmp-topology', {
    properties: {
      '@timestamp': { type: 'date' },
      doc_type: { type: 'keyword' },
      site: { type: 'keyword' },
      node_id: { type: 'keyword' },
      host: {
        properties: {
          name: { type: 'keyword' },
          type: { type: 'keyword' },
        },
      },
      network: {
        properties: {
          role: { type: 'keyword' },
          site: { type: 'keyword' },
        },
      },
      layout: {
        properties: {
          x: { type: 'float' },
          y: { type: 'float' },
        },
      },
      ports_down: { type: 'integer' },
      oper_status: { type: 'keyword' },
      source: { type: 'keyword' },
      target: { type: 'keyword' },
      link_status: { type: 'keyword' },
    },
  });
}

function rowsToObjects(q) {
  const cols = (q.columns || []).map((c) => c.name);
  return (q.values || []).map((row) => {
    const obj = {};
    cols.forEach((name, i) => {
      obj[name] = row[i];
    });
    return obj;
  });
}

async function siteHealth() {
  const q = await es('/_query', {
    method: 'POST',
    body: {
      query:
        'FROM logs-snmp.topology-default\n' +
        '| WHERE host.type == "switch" AND interface.name IS NOT NULL AND STARTS_WITH(interface.name, "Eth")\n' +
        '| EVAL port_key = CONCAT(host.name, ":", interface.name)\n' +
        '| STATS oper = LAST(interface.status.oper, @timestamp),\n' +
        '        err_in = LAST(`interface.errors.in`, @timestamp),\n' +
        '        err_out = LAST(`interface.errors.out`, @timestamp)\n' +
        '  BY network.site, port_key\n' +
        '| EVAL errs = COALESCE(err_in, 0) + COALESCE(err_out, 0)\n' +
        '| STATS ports_down = COUNT(CASE(oper == "down", 1, null)),\n' +
        '        error_count = SUM(errs)\n' +
        '  BY network.site',
    },
  });
  const map = new Map();
  for (const obj of rowsToObjects(q)) {
    map.set(obj['network.site'], {
      ports_down: obj.ports_down || 0,
      error_count: obj.error_count || 0,
    });
  }
  return map;
}

async function devicePortDown() {
  const q = await es('/_query', {
    method: 'POST',
    body: {
      query: `FROM logs-snmp.topology-default
| WHERE interface.name IS NOT NULL AND STARTS_WITH(interface.name, "Eth")
| EVAL port_key = CONCAT(host.name, ":", interface.name)
| STATS oper = LAST(interface.status.oper, @timestamp) BY host.name, host.type, network.site, port_key
| STATS ports_down = COUNT(CASE(oper == "down", 1, null)) BY host.name, host.type, network.site`,
    },
  });
  const map = new Map();
  for (const obj of rowsToObjects(q)) {
    map.set(obj['host.name'], obj);
  }
  return map;
}

async function seedSites(health) {
  await es('/snmp-sites/_delete_by_query', {
    method: 'POST',
    body: { query: { match_all: {} } },
  }).catch(() => {});

  const now = new Date().toISOString();
  const docs = SITES.map((s) => {
    const h = health.get(s.site) || { ports_down: 0, error_count: 0 };
    const portsDown = h.ports_down || 0;
    // Border styling follows design: 0 green, 1–5 amber, >5 red (ports_down driven)
    let status = 'healthy';
    if (portsDown > 5) status = 'critical';
    else if (portsDown >= 1) status = 'warning';
    return {
      ...s,
      lat: s.location.lat,
      lon: s.location.lon,
      ports_down: portsDown,
      error_count: h.error_count || 0,
      health_score: portsDown,
      status,
      '@timestamp': now,
    };
  });

  const body = docs.flatMap((d) => [{ index: { _index: 'snmp-sites', _id: d.site } }, d]);
  const r = await fetch(`${ES}/_bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson', ...authHeaders() },
    body: body.map((l) => JSON.stringify(l)).join('\n') + '\n',
  });
  const j = await r.json();
  if (j.errors) throw new Error(`snmp-sites bulk errors: ${JSON.stringify(j.items?.find((i) => i.index?.error))}`);
  console.log(`  snmp-sites: ${docs.length} docs`);
  for (const d of docs) {
    console.log(`    ${d.site}: ports_down=${d.ports_down} errors=${d.error_count} status=${d.status}`);
  }
}

async function seedTopology(deviceHealth) {
  await es('/snmp-topology/_delete_by_query', {
    method: 'POST',
    body: { query: { match_all: {} } },
  }).catch(() => {});

  const now = new Date().toISOString();
  const docs = [];
  for (const [site, topo] of Object.entries(TOPOLOGY)) {
    for (const n of topo.nodes) {
      const h = deviceHealth.get(n.id) || {};
      const portsDown = h.ports_down || 0;
      docs.push({
        '@timestamp': now,
        doc_type: 'node',
        site,
        node_id: n.id,
        host: { name: n.id, type: n.type },
        network: { site, role: n.role },
        layout: { x: n.x, y: n.y },
        ports_down: portsDown,
        oper_status: portsDown > 0 ? 'degraded' : 'up',
      });
    }
    for (const [source, target] of topo.edges) {
      const key = `${source}|${target}`;
      const down = FAULTED_LINKS.has(key);
      docs.push({
        '@timestamp': now,
        doc_type: 'edge',
        site,
        source,
        target,
        link_status: down ? 'down' : 'up',
        network: { site },
      });
    }
  }

  const body = docs.flatMap((d) => [{ index: { _index: 'snmp-topology' } }, d]);
  for (let i = 0; i < body.length; i += 200) {
    const chunk = body.slice(i, i + 200);
    const r = await fetch(`${ES}/_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson', ...authHeaders() },
      body: chunk.map((l) => JSON.stringify(l)).join('\n') + '\n',
    });
    const j = await r.json();
    if (j.errors) throw new Error(`snmp-topology bulk errors`);
  }
  console.log(`  snmp-topology: ${docs.length} docs (nodes+edges)`);
}

async function main() {
  console.log(`=== Seeding tiered dashboard indices → ${ES} ===`);
  await ensureIndices();
  console.log('[1/3] Computing site/device health from topology data…');
  const health = await siteHealth();
  const devices = await devicePortDown();
  console.log('[2/3] Writing snmp-sites…');
  await seedSites(health);
  console.log('[3/3] Writing snmp-topology…');
  await seedTopology(devices);
  console.log('=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
