#!/usr/bin/env node
/**
 * Deploy tiered SNMP dashboards + Kibana Map + Vega assets.
 *
 * Usage (from repo root otel-snmp-o11y/):
 *   node kibana/tiered/deploy.mjs
 *
 * Requires .env: ELASTICSEARCH_URL, ELASTIC_API_KEY (or ES_API_KEY),
 * and KIBANA_URL (defaults from Cloud kb hostname).
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const KD =
  process.env.KIBANA_DASHBOARDS_JS ||
  join(
    process.env.HOME,
    '.cursor/plugins/cache/cursor-public/elastic/f25405c0b7b808fcf320c97889d905ae26152f07/skills/kibana/kibana-dashboards/scripts/kibana-dashboards.js'
  );

if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const ES = process.env.ELASTICSEARCH_URL;
const API_KEY = process.env.ELASTIC_API_KEY || process.env.ES_API_KEY;
const KB =
  process.env.KIBANA_URL ||
  (ES ? ES.replace('.es.', '.kb.').replace(/:443$/, '') : null);

if (!ES || !API_KEY || !KB) {
  console.error('Need ELASTICSEARCH_URL, ELASTIC_API_KEY/ES_API_KEY, and KIBANA_URL');
  process.exit(1);
}

process.env.KIBANA_URL = KB;
process.env.KIBANA_API_KEY = API_KEY;

const IDS = {
  tier0: 'snmp-tier0-us-map',
  tier1: 'snmp-tier1-site-detail',
  tier2: 'snmp-tier2-device-faceplate',
  sitesDv: 'snmp-sites-dataview',
  topoDv: 'snmp-topology-dataview',
  map: 'snmp-sites-health-map',
  vegaTopo: 'snmp-vega-site-topology',
  vegaFace: 'snmp-vega-device-faceplate',
};

function authHeaders() {
  return { Authorization: `ApiKey ${API_KEY}`, 'kbn-xsrf': 'true', 'Content-Type': 'application/json' };
}

async function kb(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${KB}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 800)}`);
  return json;
}

async function es(path, opts = {}) {
  const r = await fetch(`${ES}${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `ApiKey ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(`ES ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function runSeed() {
  console.log('\n=== [1/5] Seed snmp-sites + snmp-topology ===');
  const r = spawnSync(process.execPath, [join(__dirname, 'seed-sites-topology.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

async function upsertDataView(id, title, pattern, timeField = '@timestamp') {
  const body = {
    attributes: {
      title: pattern,
      name: title,
      timeFieldName: timeField,
      allowNoIndex: true,
    },
  };
  try {
    await kb(`/api/data_views/data_view/${id}`, { method: 'POST', body: { data_view: { id, ...body.attributes }, override: true } });
  } catch {
    try {
      await kb(`/api/saved_objects/index-pattern/${id}`, {
        method: 'PUT',
        body: { attributes: { title: pattern, timeFieldName: timeField } },
      });
    } catch {
      await kb(`/api/saved_objects/index-pattern/${id}`, {
        method: 'POST',
        body: { attributes: { title: pattern, timeFieldName: timeField } },
      });
    }
  }
  console.log(`  data view ${id} → ${pattern}`);
}

async function upsertMap() {
  console.log('\n=== [2/5] Create Kibana Map: SNMP Site Health ===');
  const layerList = [
    {
      locale: 'autoselect',
      sourceDescriptor: {
        type: 'EMS_TMS',
        isAutoSelect: true,
        lightModeDefault: 'road_map_desaturated',
      },
      id: 'basemap',
      label: null,
      minZoom: 0,
      maxZoom: 24,
      alpha: 1,
      visible: true,
      style: { type: 'EMS_VECTOR_TILE', color: '' },
      includeInFitToBounds: true,
      type: 'EMS_VECTOR_TILE',
    },
    {
      sourceDescriptor: {
        geoField: 'location',
        scalingType: 'LIMIT',
        id: 'sites-src',
        type: 'ES_SEARCH',
        applyGlobalQuery: true,
        applyGlobalTime: false,
        applyForceRefresh: true,
        filterByMapBounds: false,
        tooltipProperties: [
          'site',
          'city',
          'device_count',
          'switch_count',
          'ports_down',
          'error_count',
          'status',
        ],
        sortField: 'ports_down',
        sortOrder: 'desc',
        topHitsGroupByTimeseries: false,
        topHitsSplitField: '',
        topHitsSize: 1,
        indexPatternRefName: 'layer_1_source_index_pattern',
      },
      id: 'sites-layer',
      label: 'SNMP Sites',
      minZoom: 0,
      maxZoom: 24,
      alpha: 1,
      visible: true,
      style: {
        type: 'VECTOR',
        properties: {
          symbolizeAs: { options: { value: 'circle' } },
          fillColor: {
            type: 'STATIC',
            options: { color: '#0077CC' },
          },
          lineColor: {
            type: 'DYNAMIC',
            options: {
              color: 'Red to Green',
              colorCategory: 'palette_0',
              field: { name: 'ports_down', origin: 'source' },
              fieldMetaOptions: { isEnabled: true, sigma: 3 },
              type: 'ORDINAL',
              useCustomColorRamp: true,
              customColorRamp: [
                { stop: 0, color: '#00A65A' },
                { stop: 1, color: '#F0AD4E' },
                { stop: 5, color: '#D9534F' },
              ],
            },
          },
          lineWidth: {
            type: 'DYNAMIC',
            options: {
              minSize: 2,
              maxSize: 6,
              field: { name: 'ports_down', origin: 'source' },
              fieldMetaOptions: { isEnabled: true, sigma: 3 },
            },
          },
          iconSize: {
            type: 'STATIC',
            options: { size: 30 },
          },
          labelText: {
            type: 'DYNAMIC',
            options: { field: { name: 'site', origin: 'source' } },
          },
          labelColor: { type: 'STATIC', options: { color: '#1a1a1a' } },
          labelSize: { type: 'STATIC', options: { size: 14 } },
          labelBorderColor: { type: 'STATIC', options: { color: '#FFFFFF' } },
          labelBorderSize: { options: { size: 'SMALL' } },
          labelPosition: { options: { position: 'BOTTOM' } },
          labelZoomRange: { options: { useLayerZoomRange: true, minZoom: 0, maxZoom: 24 } },
          iconOrientation: { type: 'STATIC', options: { orientation: 0 } },
          icon: { type: 'STATIC', options: { value: 'marker' } },
        },
        isTimeAware: false,
      },
      includeInFitToBounds: true,
      type: 'VECTOR',
      joins: [],
      disableTooltips: false,
    },
  ];

  const mapState = {
    zoom: 3.8,
    center: { lon: -92.5, lat: 37.5 },
    timeFilters: { from: 'now-15m', to: 'now' },
    refreshConfig: { isPaused: true, interval: 60000 },
    query: { query: '', language: 'kuery' },
    filters: [],
    settings: {
      autoFitToDataBounds: false,
      initialLocation: 'LAST_SAVED_LOCATION',
      maxZoom: 24,
      minZoom: 0,
      showScaleControl: true,
      showSpatialFilters: true,
    },
  };

  const attributes = {
    title: 'SNMP Site Health',
    description: 'Tier 0 map — site markers sized/bordered by ports_down from snmp-sites',
    layerListJSON: JSON.stringify(layerList),
    mapStateJSON: JSON.stringify(mapState),
    uiStateJSON: JSON.stringify({ isLayerTOCOpen: true, openTOCDetails: ['sites-layer'] }),
  };

  const references = [
    { id: IDS.sitesDv, name: 'layer_1_source_index_pattern', type: 'index-pattern' },
  ];

  try {
    await kb(`/api/saved_objects/map/${IDS.map}`, {
      method: 'PUT',
      body: { attributes, references },
    });
  } catch {
    await kb(`/api/saved_objects/map/${IDS.map}`, {
      method: 'POST',
      body: { attributes, references },
    });
  }
  console.log(`  map ${IDS.map}`);
}

function faceplateVegaSpec() {
  return JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    title: {
      text: 'Switch port faceplate',
      subtitle: 'Uses dashboard filters on host.name · green=up · red=oper-down · gray=admin-down',
    },
    autosize: { type: 'fit', contains: 'padding' },
    config: {
      axis: { domainColor: '#444', tickColor: '#444', labelColor: '#aaa', grid: false },
      view: { stroke: null },
      legend: { labelColor: '#aaa', titleColor: '#aaa' },
    },
    data: {
      url: {
        '%type%': 'esql',
        '%context%': true,
        '%timefield%': '@timestamp',
        query:
          'FROM logs-snmp.topology-default | WHERE STARTS_WITH(interface.name, "Eth1/") AND @timestamp <= ?_tend AND @timestamp > ?_tstart | STATS admin = LAST(interface.status.admin, @timestamp), oper = LAST(interface.status.oper, @timestamp) BY host.name, interface.name | EVAL port_num = TO_INTEGER(REPLACE(interface.name, "Eth1/", "")) | EVAL row = CASE(port_num <= 12, 1, 2) | EVAL col = CASE(port_num <= 12, port_num, port_num - 12) | EVAL status_code = CASE(admin == "down", 0, oper == "down", 1, 2) | EVAL status_label = CASE(status_code == 0, "admin-down", status_code == 1, "oper-down", "up") | RENAME interface.name AS port | KEEP host.name, port, port_num, row, col, status_code, status_label, admin, oper | SORT row, col',
      },
    },
    layer: [
      {
        mark: { type: 'rect', stroke: '#1f2937', strokeWidth: 2, cornerRadius: 3 },
        encoding: {
          x: {
            field: 'col',
            type: 'ordinal',
            scale: { domain: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
            axis: { title: null, labelAngle: 0 },
          },
          y: {
            field: 'row',
            type: 'ordinal',
            scale: { domain: [1, 2] },
            sort: [1, 2],
            axis: { title: null, labelExpr: "'R' + datum.value" },
          },
          color: {
            field: 'status_code',
            type: 'ordinal',
            scale: { domain: [0, 1, 2], range: ['#6B7280', '#DC2626', '#16A34A'] },
            legend: {
              title: 'Status',
              labelExpr: "datum.value == 0 ? 'admin-down' : datum.value == 1 ? 'oper-down' : 'up'",
            },
          },
          tooltip: [
            { field: 'host.name', type: 'nominal', title: 'Device' },
            { field: 'port', type: 'nominal', title: 'Port' },
            { field: 'admin', type: 'nominal', title: 'Admin' },
            { field: 'oper', type: 'nominal', title: 'Oper' },
            { field: 'status_label', type: 'nominal', title: 'Status' },
          ],
        },
      },
      {
        mark: { type: 'text', fontSize: 11, fontWeight: 'bold', color: '#ffffff' },
        encoding: {
          x: {
            field: 'col',
            type: 'ordinal',
            scale: { domain: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
          },
          y: { field: 'row', type: 'ordinal', scale: { domain: [1, 2] }, sort: [1, 2] },
          text: { field: 'port_num', type: 'quantitative' },
        },
      },
    ],
  });
}

function topologyVegaSpec() {
  // Vega (not lite) with force-ish manual layout from snmp-topology
  return JSON.stringify({
    $schema: 'https://vega.github.io/schema/vega/v5.json',
    description: 'Site topology from snmp-topology; filter by site via dashboard KQL',
    padding: 10,
    autosize: { type: 'fit', contains: 'padding' },
    data: [
      {
        name: 'nodes',
        url: {
          '%type%': 'elasticsearch',
          index: 'snmp-topology',
          '%context%': true,
          body: {
            size: 100,
            query: { bool: { filter: [{ term: { doc_type: 'node' } }] } },
          },
        },
        format: { property: 'hits.hits' },
        transform: [
          { type: 'formula', as: 'id', expr: "datum._source.host.name" },
          { type: 'formula', as: 'x', expr: 'datum._source.layout.x' },
          { type: 'formula', as: 'y', expr: 'datum._source.layout.y' },
          { type: 'formula', as: 'ports_down', expr: 'datum._source.ports_down' },
          { type: 'formula', as: 'type', expr: 'datum._source.host.type' },
          { type: 'formula', as: 'status', expr: 'datum._source.oper_status' },
        ],
      },
      {
        name: 'edges',
        url: {
          '%type%': 'elasticsearch',
          index: 'snmp-topology',
          '%context%': true,
          body: {
            size: 200,
            query: { bool: { filter: [{ term: { doc_type: 'edge' } }] } },
          },
        },
        format: { property: 'hits.hits' },
        transform: [
          { type: 'formula', as: 'source', expr: 'datum._source.source' },
          { type: 'formula', as: 'target', expr: 'datum._source.target' },
          { type: 'formula', as: 'link_status', expr: 'datum._source.link_status' },
          {
            type: 'lookup',
            from: 'nodes',
            key: 'id',
            fields: ['source'],
            values: ['x', 'y'],
            as: ['sx', 'sy'],
          },
          {
            type: 'lookup',
            from: 'nodes',
            key: 'id',
            fields: ['target'],
            values: ['x', 'y'],
            as: ['tx', 'ty'],
          },
        ],
      },
    ],
    scales: [
      { name: 'x', type: 'linear', domain: [0, 100], range: 'width' },
      { name: 'y', type: 'linear', domain: [0, 100], range: 'height' },
      {
        name: 'nodeColor',
        type: 'ordinal',
        domain: ['up', 'degraded'],
        range: ['#16A34A', '#DC2626'],
      },
      {
        name: 'edgeColor',
        type: 'ordinal',
        domain: ['up', 'down'],
        range: ['#94a3b8', '#DC2626'],
      },
    ],
    marks: [
      {
        type: 'rule',
        from: { data: 'edges' },
        encode: {
          enter: {
            x: { scale: 'x', field: 'sx' },
            y: { scale: 'y', field: 'sy' },
            x2: { scale: 'x', field: 'tx' },
            y2: { scale: 'y', field: 'ty' },
            stroke: { scale: 'edgeColor', field: 'link_status' },
            strokeWidth: { signal: "datum.link_status === 'down' ? 3 : 1.5" },
            strokeDash: { signal: "datum.link_status === 'down' ? [6,4] : [0]" },
          },
        },
      },
      {
        type: 'symbol',
        from: { data: 'nodes' },
        encode: {
          enter: {
            x: { scale: 'x', field: 'x' },
            y: { scale: 'y', field: 'y' },
            size: { value: 350 },
            fill: { scale: 'nodeColor', field: 'status' },
            stroke: { value: '#1f2937' },
            strokeWidth: { value: 1.5 },
            tooltip: {
              signal:
                "{Device: datum.id, Type: datum.type, Status: datum.status, PortsDown: datum.ports_down}",
            },
          },
        },
      },
      {
        type: 'text',
        from: { data: 'nodes' },
        encode: {
          enter: {
            x: { scale: 'x', field: 'x' },
            y: { scale: 'y', field: 'y' },
            dy: { value: -18 },
            align: { value: 'center' },
            text: { field: 'id' },
            fontSize: { value: 10 },
            fill: { value: '#111827' },
          },
        },
      },
    ],
  });
}

async function upsertVega(id, title, spec) {
  const visState = JSON.stringify({
    title,
    type: 'vega',
    aggs: [],
    params: { spec },
  });
  const attributes = {
    title,
    visState,
    uiStateJSON: '{}',
    description: '',
    version: 1,
    kibanaSavedObjectMeta: { searchSourceJSON: '{"query":{"query":"","language":"kuery"},"filter":[]}' },
  };
  try {
    await kb(`/api/saved_objects/visualization/${id}`, {
      method: 'PUT',
      body: { attributes, references: [] },
    });
  } catch {
    await kb(`/api/saved_objects/visualization/${id}`, {
      method: 'POST',
      body: { attributes, references: [] },
    });
  }
  console.log(`  vega ${id}`);
}

function upsertDashboard(id, file) {
  console.log(`  upsert dashboard ${id}`);
  const r = spawnSync(process.execPath, [KD, 'dashboard', 'upsert', id, file], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) throw new Error(`dashboard upsert failed: ${id}`);
}

async function injectMapAndVegaIntoDashboards() {
  console.log('\n=== [4/5] Inject Map + Vega panels into dashboards (saved objects) ===');

  // Tier 0: add map panel
  const d0 = await kb(`/api/saved_objects/dashboard/${IDS.tier0}`);
  const panels0 = JSON.parse(d0.attributes.panelsJSON || '[]');
  const refs0 = [...(d0.references || [])];
  const mapPanelId = 'tier0-map-panel';
  if (!panels0.some((p) => p.panelIndex === mapPanelId || p.id === mapPanelId)) {
    // shift existing panels down
    for (const p of panels0) {
      if (p.gridData) p.gridData.y = (p.gridData.y || 0) + 18;
    }
    panels0.unshift({
      type: 'map',
      panelIndex: mapPanelId,
      gridData: { x: 0, y: 0, w: 48, h: 18, i: mapPanelId },
      embeddableConfig: {
        enhancements: { dynamicActions: { events: [] } },
        hidePanelTitles: false,
        title: 'US sites — border color by ports down',
        mapCenter: { lon: -92.5, lat: 37.5, zoom: 3.8 },
        isLayerTOCOpen: false,
        hiddenLayers: [],
        openTOCDetails: [],
      },
    });
    refs0.push({ name: `${mapPanelId}:savedObjectRef`, type: 'map', id: IDS.map });
  }

  // Fix markdown nav links to absolute
  for (const p of panels0) {
    const cfg = p.embeddableConfig;
    if (p.type === 'markdown' && cfg?.content) {
      cfg.content = cfg.content
        .replace(
          /#\/view\/snmp-tier1-site-detail/g,
          `${KB}/app/dashboards#/view/${IDS.tier1}`
        )
        .replace(/#\/view\/snmp-tier0-us-map/g, `${KB}/app/dashboards#/view/${IDS.tier0}`)
        .replace(
          /#\/view\/snmp-tier2-device-faceplate/g,
          `${KB}/app/dashboards#/view/${IDS.tier2}`
        );
    }
  }

  await kb(`/api/saved_objects/dashboard/${IDS.tier0}`, {
    method: 'PUT',
    body: {
      attributes: {
        ...d0.attributes,
        panelsJSON: JSON.stringify(panels0),
      },
      references: refs0,
    },
  });
  console.log('  Tier 0: map panel injected');

  // Tier 1: inject topology Vega
  const d1 = await kb(`/api/saved_objects/dashboard/${IDS.tier1}`);
  const panels1 = JSON.parse(d1.attributes.panelsJSON || '[]');
  const refs1 = [...(d1.references || [])];
  const topoPanelId = 'tier1-vega-topo';
  if (!panels1.some((p) => p.panelIndex === topoPanelId)) {
    for (const p of panels1) {
      if (p.gridData && (p.gridData.y || 0) >= 5) p.gridData.y += 16;
    }
    panels1.push({
      type: 'visualization',
      panelIndex: topoPanelId,
      gridData: { x: 0, y: 5, w: 24, h: 16, i: topoPanelId },
      embeddableConfig: {
        enhancements: { dynamicActions: { events: [] } },
        title: 'Site topology (Vega)',
        hidePanelTitles: false,
      },
    });
    refs1.push({
      name: `${topoPanelId}:savedObjectRef`,
      type: 'visualization',
      id: IDS.vegaTopo,
    });
  }
  for (const p of panels1) {
    const cfg = p.embeddableConfig;
    if (p.type === 'markdown' && cfg?.content) {
      cfg.content = cfg.content
        .replace(
          /#\/view\/snmp-tier1-site-detail/g,
          `${KB}/app/dashboards#/view/${IDS.tier1}`
        )
        .replace(/#\/view\/snmp-tier0-us-map/g, `${KB}/app/dashboards#/view/${IDS.tier0}`)
        .replace(
          /#\/view\/snmp-tier2-device-faceplate/g,
          `${KB}/app/dashboards#/view/${IDS.tier2}`
        );
    }
  }
  await kb(`/api/saved_objects/dashboard/${IDS.tier1}`, {
    method: 'PUT',
    body: {
      attributes: { ...d1.attributes, panelsJSON: JSON.stringify(panels1) },
      references: refs1,
    },
  });
  console.log('  Tier 1: topology Vega injected');

  // Tier 2: inject context-aware Vega faceplate above heatmap
  const d2 = await kb(`/api/saved_objects/dashboard/${IDS.tier2}`);
  const panels2 = JSON.parse(d2.attributes.panelsJSON || '[]');
  const refs2 = [...(d2.references || [])];
  const facePanelId = 'tier2-vega-face';
  if (!panels2.some((p) => p.panelIndex === facePanelId)) {
    for (const p of panels2) {
      if (p.gridData && (p.gridData.y || 0) >= 5) p.gridData.y += 14;
    }
    panels2.push({
      type: 'visualization',
      panelIndex: facePanelId,
      gridData: { x: 0, y: 5, w: 48, h: 14, i: facePanelId },
      embeddableConfig: {
        enhancements: { dynamicActions: { events: [] } },
        title: 'Port faceplate (Vega · filter host.name)',
        hidePanelTitles: false,
      },
    });
    refs2.push({
      name: `${facePanelId}:savedObjectRef`,
      type: 'visualization',
      id: IDS.vegaFace,
    });
  }
  for (const p of panels2) {
    const cfg = p.embeddableConfig;
    if (p.type === 'markdown' && cfg?.content) {
      cfg.content = cfg.content
        .replace(
          /#\/view\/snmp-tier1-site-detail/g,
          `${KB}/app/dashboards#/view/${IDS.tier1}`
        )
        .replace(/#\/view\/snmp-tier0-us-map/g, `${KB}/app/dashboards#/view/${IDS.tier0}`)
        .replace(
          /#\/view\/snmp-tier2-device-faceplate/g,
          `${KB}/app/dashboards#/view/${IDS.tier2}`
        );
    }
  }
  await kb(`/api/saved_objects/dashboard/${IDS.tier2}`, {
    method: 'PUT',
    body: {
      attributes: { ...d2.attributes, panelsJSON: JSON.stringify(panels2) },
      references: refs2,
    },
  });
  console.log('  Tier 2: faceplate Vega injected');
}

async function main() {
  if (!existsSync(KD)) {
    console.error(`kibana-dashboards.js not found at ${KD}`);
    process.exit(1);
  }

  runSeed();

  console.log('\n=== [2/5] Data views ===');
  await upsertDataView(IDS.sitesDv, 'SNMP Sites', 'snmp-sites');
  await upsertDataView(IDS.topoDv, 'SNMP Topology', 'snmp-topology');

  await upsertMap();

  console.log('\n=== [3/5] Vega visualizations ===');
  writeFileSync(join(__dirname, '../vega/switch-faceplate-context.json'), faceplateVegaSpec());
  writeFileSync(join(__dirname, '../vega/site-topology.json'), topologyVegaSpec());
  await upsertVega(IDS.vegaFace, 'SNMP Device Faceplate (Vega)', faceplateVegaSpec());
  await upsertVega(IDS.vegaTopo, 'SNMP Site Topology (Vega)', topologyVegaSpec());

  console.log('\n=== [3b/5] Upsert dashboards via Dashboards API ===');
  upsertDashboard(IDS.tier0, join(__dirname, 'snmp-tier0-us-map.json'));
  upsertDashboard(IDS.tier1, join(__dirname, 'snmp-tier1-site-detail.json'));
  upsertDashboard(IDS.tier2, join(__dirname, 'snmp-tier2-device-faceplate.json'));

  await injectMapAndVegaIntoDashboards();

  console.log('\n=== [5/5] Done ===');
  console.log(`
Tier 0 (map):     ${KB}/app/dashboards#/view/${IDS.tier0}
Tier 1 (site):    ${KB}/app/dashboards#/view/${IDS.tier1}
Tier 2 (device):  ${KB}/app/dashboards#/view/${IDS.tier2}
Map library:      ${KB}/app/maps#/map/${IDS.map}

Demo path: Tier 0 → set Site=Branch-NYC → Site Detail → Device=nyc-sw-02 or hq-access-sw-03 faceplate
`);
  writeFileSync(
    join(__dirname, 'DEPLOYED_URLS.md'),
    `# Deployed tiered SNMP dashboards

| Tier | Title | URL |
|------|-------|-----|
| 0 | SNMP — US Sites Overview | ${KB}/app/dashboards#/view/${IDS.tier0} |
| 1 | SNMP — Site Detail | ${KB}/app/dashboards#/view/${IDS.tier1} |
| 2 | SNMP — Device Faceplate | ${KB}/app/dashboards#/view/${IDS.tier2} |
| Map | SNMP Site Health | ${KB}/app/maps#/map/${IDS.map} |

Re-seed health metrics after regenerating Track B data:

\`\`\`bash
node kibana/tiered/seed-sites-topology.mjs
\`\`\`

Redeploy:

\`\`\`bash
node kibana/tiered/deploy.mjs
\`\`\`
`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
