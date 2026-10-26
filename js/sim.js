/* Traffic simulation engine.
 *
 * A design is { nodes: [{ id, type, x, y, cfg, label, failed }], edges: [{ id, from, to }] }.
 * Traffic is { rps, mix: { read, write, search, media }, mult, kindMult }.
 *
 * simulate() pushes the traffic through the graph in topological order. Each block
 * serves what fits in its capacity and drops the rest; then latency and failure
 * probability are worked out per request kind, walking back up from the leaves. */

const KINDS = ['read', 'write', 'search', 'media'];
const CACHEABLE = { read: true, search: true };
// A database doing work it is not built for: capacity cost and latency multipliers.
const DB_LOAD_COST = { search: 5, media: 5 };
const DB_LATENCY_COST = { search: 10, media: 5 };
const SPOF_THRESHOLD = 0.95;

const sumKinds = o => KINDS.reduce((a, k) => a + (o[k] || 0), 0);
const zeroKinds = () => ({ read: 0, write: 0, search: 0, media: 0 });
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

function blockCfg(node) { return Object.assign({}, BLOCKS[node.type].defaults || {}, node.cfg || {}); }
function roleOf(node) { return BLOCKS[node.type].role; }
function labelOf(node) { return node.label || BLOCKS[node.type].name; }
function totalCopies(node, cfg) {
  if (node.type === 'user' || BLOCKS[node.type].fixed) return 1;
  return Math.max(1, Math.round(cfg.replicas || 1));
}

function fmtRps(n) {
  if (!isFinite(n)) return '∞';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return n >= 10 ? Math.round(n).toString() : n.toFixed(n >= 1 ? 1 : 2);
}
function fmtMs(n) {
  if (!isFinite(n)) return '∞';
  return n >= 1000 ? (n / 1000).toFixed(1) + ' s' : (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ms';
}
function fmtPct(x) {
  if (!isFinite(x)) return '∞';
  const p = x * 100;
  if (p >= 99.95 && p < 100) return '99.9%';
  if (p > 0 && p < 0.1) return '<0.1%';
  return (p >= 90 && p < 100 ? p.toFixed(1) : p >= 10 ? Math.round(p) : p.toFixed(1)) + '%';
}

function buildGraph(design, failIds) {
  const byId = {}, out = {}, inn = {}, cfg = {}, alive = {}, copies = {};
  design.nodes.forEach(n => { byId[n.id] = n; out[n.id] = []; inn[n.id] = []; });
  design.edges.forEach(e => {
    if (!byId[e.from] || !byId[e.to] || e.from === e.to || out[e.from].includes(e.to)) return;
    out[e.from].push(e.to);
    inn[e.to].push(e.from);
  });
  design.nodes.forEach(n => {
    cfg[n.id] = blockCfg(n);
    copies[n.id] = totalCopies(n, cfg[n.id]);
    alive[n.id] = n.type !== 'user' && failIds.has(n.id) ? copies[n.id] - 1 : copies[n.id];
  });
  return { nodes: design.nodes, byId, out, inn, cfg, alive, copies };
}

function topoOrder(g) {
  const indeg = {};
  g.nodes.forEach(n => { indeg[n.id] = g.inn[n.id].length; });
  const queue = g.nodes.filter(n => indeg[n.id] === 0).map(n => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    g.out[id].forEach(c => { if (--indeg[c] === 0) queue.push(c); });
  }
  const seen = new Set(order);
  return { order, cyclic: g.nodes.filter(n => !seen.has(n.id)).map(n => n.id) };
}

/* ---------- routing ---------- */

// Split evenly over the healthy targets (health checks); if none are healthy, the requests go to the dead ones and fail.
function spread(g, list, frac, async) {
  if (!list.length || frac <= 0) return [];
  const live = list.filter(n => g.alive[n.id] > 0);
  const targets = live.length ? live : list;
  return targets.map(n => ({ to: n.id, frac: frac / targets.length, async: !!async }));
}

// Which data store answers a request kind, among a set of sibling blocks.
function storesFor(kids, k) {
  const of = t => kids.filter(n => n.type === t);
  if (k === 'write') return of('queue').length ? of('queue') : of('db');
  if (k === 'search') return of('search').length ? of('search') : of('db');
  if (k === 'media') return of('blob').length ? of('blob') : of('db');
  return of('db');
}

// Calls a compute block (or a cache, for its misses) makes to the data blocks wired to it.
function dataCalls(g, kids, k, frac) {
  const calls = [];
  if (frac <= 0) return calls;
  if (k === 'write') {
    kids.filter(n => n.type === 'external').forEach(n => calls.push({ to: n.id, frac: frac * g.cfg[n.id].callShare }));
  }
  const caches = kids.filter(n => n.type === 'cache');
  const liveCaches = caches.filter(n => g.alive[n.id] > 0);
  let direct = storesFor(kids, k);
  if (!direct.length && caches.length && !liveCaches.length) {
    // Every cache is down: the app falls back to whatever sat behind them.
    const behind = [];
    caches.forEach(c => g.out[c.id].forEach(id => behind.push(g.byId[id])));
    direct = storesFor(behind, k);
  }
  const readThrough = liveCaches.some(c => g.out[c.id].length);
  if (liveCaches.length && (CACHEABLE[k] || (!direct.length && readThrough))) {
    calls.push(...spread(g, liveCaches, frac));
    if (CACHEABLE[k] && !readThrough) {
      const h = avg(liveCaches.map(c => g.cfg[c.id].hitRate));
      calls.push(...spread(g, direct, frac * (1 - h)));
    }
  } else {
    calls.push(...spread(g, direct, frac));
  }
  return calls;
}

function routeCalls(g, id, k) {
  const n = g.byId[id], c = g.cfg[id];
  const kids = g.out[id].map(x => g.byId[x]);
  if (!kids.length) return [];
  switch (roleOf(n)) {
    case 'source':
      return spread(g, kids, 1);
    case 'router':
      if (n.type === 'cdn' && (k === 'read' || k === 'media')) return spread(g, kids, 1 - c.hitRate);
      return spread(g, kids, 1);
    case 'queue':
      return spread(g, kids.filter(x => roleOf(x) === 'compute'), 1, true);
    case 'cache':
      return dataCalls(g, kids, k, CACHEABLE[k] ? 1 - c.hitRate : 1);
    case 'store':
      return [];
    default: { // compute
      const flow = kids.filter(x => roleOf(x) === 'router' || roleOf(x) === 'compute');
      const data = kids.filter(x => roleOf(x) !== 'router' && roleOf(x) !== 'compute');
      return spread(g, flow, 1).concat(dataCalls(g, data, k, 1));
    }
  }
}

/* ---------- simulation ---------- */

function demandOf(traffic) {
  const d = zeroKinds();
  KINDS.forEach(k => {
    d[k] = (traffic.rps || 0) * ((traffic.mix || {})[k] || 0) * (traffic.mult || 1) * ((traffic.kindMult || {})[k] || 1);
  });
  return d;
}

function simulate(design, traffic, opts = {}) {
  const failIds = new Set(opts.failIds || []);
  if (!opts.ignoreManual) design.nodes.forEach(n => { if (n.failed) failIds.add(n.id); });
  const g = buildGraph(design, failIds);
  const { order, cyclic } = topoOrder(g);
  const demand = demandOf(traffic);
  const st = {};
  g.nodes.forEach(n => {
    st[n.id] = { arrival: zeroKinds(), served: zeroKinds(), calls: {}, load: 0, cap: 0, util: 0, drop: 0, throttled: 0, backlog: 0, drain: 0 };
  });
  const users = g.nodes.filter(n => n.type === 'user');
  users.forEach(u => KINDS.forEach(k => { st[u.id].arrival[k] = demand[k] / users.length; }));

  const edgeFlow = {};
  order.forEach(id => {
    const n = g.byId[id], s = st[id], c = g.cfg[id];
    const total = sumKinds(s.arrival);
    let pass = 1;
    if (n.type !== 'user') {
      const alive = g.alive[id];
      if (n.type === 'db') {
        const a = s.arrival;
        const reads = a.read + DB_LOAD_COST.search * a.search + DB_LOAD_COST.media * a.media;
        // Reads spread over every copy; each copy also applies every write. Shards split both.
        s.load = alive > 0 ? (reads / alive + a.write) / (c.shards || 1) : total;
        s.cap = alive > 0 ? c.capacity : 0;
      } else {
        s.load = total;
        s.cap = alive * c.capacity;
      }
      s.util = s.cap > 0 ? s.load / s.cap : (total > 0 ? Infinity : 0);
      pass = s.util <= 1 ? 1 : (s.cap > 0 ? 1 / s.util : 0);
      if (n.type === 'ratelimiter' && total * pass > c.limit) {
        const allowed = c.limit / (total * pass);
        s.throttled = total * pass * (1 - allowed);
        pass *= allowed;
      }
    }
    s.drop = 1 - pass;
    KINDS.forEach(k => { s.served[k] = s.arrival[k] * pass; });

    // A queue only hands consumers what they can process; the rest piles up.
    let fwd = 1;
    if (n.type === 'queue') {
      const consumers = g.out[id].map(x => g.byId[x]).filter(x => roleOf(x) === 'compute' && g.alive[x.id] > 0);
      s.drain = consumers.reduce((a, x) => a + g.alive[x.id] * g.cfg[x.id].capacity, 0);
      s.consumers = consumers.length;
      const inflow = sumKinds(s.served);
      if (inflow > s.drain) { s.backlog = inflow - s.drain; fwd = inflow > 0 ? s.drain / inflow : 0; }
    }

    KINDS.forEach(k => {
      s.calls[k] = routeCalls(g, id, k);
      s.calls[k].forEach(call => {
        const amount = s.served[k] * call.frac * fwd;
        st[call.to].arrival[k] += amount;
        const key = id + '>' + call.to;
        edgeFlow[key] = (edgeFlow[key] || 0) + amount;
      });
    });
  });
  // Blocks caught in a loop never get processed: treat them as broken.
  cyclic.forEach(id => { st[id].drop = 1; st[id].util = sumKinds(st[id].arrival) > 0 ? Infinity : 0; });

  // Expected latency (mean or p99-ish) and failure probability of a kind-k request entering a block.
  const memo = {};
  function ownLatency(id, k, tail) {
    const n = g.byId[id], s = st[id];
    if (n.type === 'user') return 0;
    const L = g.cfg[id].latency * (n.type === 'db' ? (DB_LATENCY_COST[k] || 1) : 1);
    const u = Math.min(isFinite(s.util) ? s.util : 1, 0.95);
    const q = u / (1 - u);
    let v = tail ? L * (1 + 4.6 * q) : L * (1 + q);
    if (s.util > 1) v += L * (tail ? 40 : 20);
    return v;
  }
  function latency(id, k, tail) {
    const key = (tail ? 't' : 'm') + id + k;
    if (memo[key] !== undefined) return memo[key];
    memo[key] = 0; // guards against cycles
    let v = ownLatency(id, k, tail);
    (st[id].calls[k] || []).forEach(c => { if (!c.async) v += c.frac * latency(c.to, k, tail); });
    return (memo[key] = v);
  }
  function failure(id, k) {
    const key = 'f' + id + k;
    if (memo[key] !== undefined) return memo[key];
    memo[key] = 1;
    const s = st[id], calls = st[id].calls[k] || [];
    if (g.byId[id].type === 'user' && !calls.length) return (memo[key] = 1);
    let down = 0;
    calls.forEach(c => { if (!c.async) down += c.frac * failure(c.to, k); });
    return (memo[key] = s.drop + (1 - s.drop) * Math.min(1, down));
  }

  const totalDemand = sumKinds(demand);
  let failed = 0, latSum = 0, p99 = 0;
  const byKind = {};
  KINDS.forEach(k => {
    if (!demand[k] || !users.length) return;
    const f = avg(users.map(u => failure(u.id, k)));
    const l = avg(users.map(u => latency(u.id, k, false)));
    const t = avg(users.map(u => latency(u.id, k, true)));
    byKind[k] = { demand: demand[k], success: 1 - f, latency: l, p99: t };
    failed += demand[k] * f;
    latSum += demand[k] * l;
    p99 = Math.max(p99, t);
  });
  const success = users.length && totalDemand ? 1 - failed / totalDemand : 0;
  const cost = g.nodes.reduce((a, n) => {
    if (n.type === 'user') return a;
    return a + (BLOCKS[n.type].cost || 0) * g.copies[n.id] * (n.type === 'db' ? (g.cfg[n.id].shards || 1) : 1);
  }, 0);

  const result = {
    g, st, edgeFlow, demand, cyclic, traffic,
    metrics: { demand: totalDemand, success, throughput: totalDemand * success, latency: totalDemand ? latSum / totalDemand : 0, p99, cost, byKind },
  };
  if (!opts.quiet) result.warnings = diagnose(result, opts);
  return result;
}

/* ---------- diagnosis ---------- */

const OVERLOAD_TITLES = { db: 'Database saturated', cache: 'Cache overloaded', queue: 'Queue overloaded', cdn: 'CDN at its limit', search: 'Search index overloaded', blob: 'Blob storage overloaded', external: 'Third-party rate limit hit' };
const OVERLOAD_FIX = {
  db: 'Add a cache for reads, read replicas (more copies) to spread reads, or shards to split writes.',
  cache: 'Give the cache more copies (a cluster) or more capacity.',
  search: 'Add copies to the search index, or cache popular searches.',
  blob: 'Put a CDN in front of blob storage, or add copies.',
  external: 'You cannot scale a provider. Call it less: cache its answers, or buffer calls through a queue.',
  queue: 'Add copies (partitions) to the queue.',
  compute: 'Add copies behind a load balancer, or take work off it with a cache.',
  router: 'Give it another copy, or raise its capacity.',
};

function fixFor(node) {
  return OVERLOAD_FIX[node.type] || OVERLOAD_FIX[roleOf(node)] || OVERLOAD_FIX.router;
}

function diagnose(r, opts) {
  const { g, st } = r, out = [];
  const add = (level, title, msg, node, fix) => out.push({ level, title, msg, nodeId: node ? node.id : null, fix });
  const users = g.nodes.filter(n => n.type === 'user');
  if (!users.length) add('error', 'No traffic source', 'Add a Users block. That is where the traffic comes from.', null, 'Drag “Users” from the palette onto the canvas.');
  users.forEach(u => { if (!g.out[u.id].length) add('error', 'Users are not connected', 'Traffic has nowhere to go.', u, 'Drag from the dot on the right of Users to your first block.'); });
  r.cyclic.forEach(id => add('error', 'Loop in the design', `${labelOf(g.byId[id])} is part of a cycle. Requests would go round forever.`, g.byId[id], 'Remove one of the arrows that forms the loop.'));

  g.nodes.forEach(n => {
    if (n.type === 'user') return;
    const s = st[n.id], total = sumKinds(s.arrival), name = labelOf(n);
    if (g.alive[n.id] <= 0) {
      if (total > 0) add('error', `${name} is down`, `It receives ${fmtRps(total)} req/s and every one fails.`, n, 'Give it a second copy so the other one takes over.');
      return;
    }
    if (total <= 0) {
      if (!g.inn[n.id].length && !r.cyclic.includes(n.id)) add('info', `${name} is not connected`, 'Nothing sends traffic to it.', n, 'Connect it, or delete it.');
      return;
    }
    if (s.util > 1) {
      add('error', OVERLOAD_TITLES[n.type] || `${name} overloaded`,
        `${name} gets ${fmtRps(s.load)} req/s of work but can handle ${fmtRps(s.cap)}. It drops ${fmtPct(s.drop)} of requests.`, n, fixFor(n));
    } else if (s.util > 0.8) {
      add('warn', `${name} is running hot`, `${fmtPct(s.util)} busy, so requests queue up and latency climbs. A small spike will tip it over.`, n, fixFor(n));
    }
    if (n.type === 'ratelimiter' && s.throttled > 0) {
      add('info', 'Rate limiter is rejecting requests', `${fmtRps(s.throttled)} req/s rejected with 429 to protect the backend.`, n, 'Expected during a flood. If it happens at normal load, raise the allowed rate.');
    }
    if (n.type === 'db' && s.arrival.search > 0) {
      add('warn', 'Searches are scanning the database', `${fmtRps(s.arrival.search)} searches/s hit ${name}. Each costs ~5× a normal read and is 10× slower.`, n, 'Add a Search Index next to the database.');
    }
    if (n.type === 'db' && s.arrival.media > 0) {
      add('warn', 'Files stored in the database', `${fmtRps(s.arrival.media)} media requests/s are served from ${name}.`, n, 'Store media in Blob Storage, behind a CDN.');
    }
    if (n.type === 'db' && g.copies[n.id] > 1 && s.arrival.write / (s.cap * (g.cfg[n.id].shards || 1)) > 0.5) {
      add('warn', 'Replica lag risk', `Writes use over half of every copy's capacity, so replicas fall behind the primary and readers see stale data.`, n, 'Shard the database to split the write load.');
    }
    if (n.type === 'queue') {
      if (!s.consumers) add('error', 'Queue has no consumers', `${name} receives messages but no Worker reads them.`, n, 'Connect the queue to one or more Workers.');
      else if (s.backlog > 0) add('error', 'Queue backlog growing', `Workers drain ${fmtRps(s.drain)} msg/s but ${fmtRps(s.backlog + s.drain)} arrive. The queue grows by ${fmtRps(s.backlog)} every second.`, n, 'Add Worker copies until their total capacity covers the inflow.');
    }
    if (roleOf(n) === 'compute' && g.copies[n.id] >= 3 && s.util < 0.1) {
      add('info', `${name} is over-provisioned`, `Only ${fmtPct(s.util)} busy across ${g.copies[n.id]} copies.`, n, 'Remove a few copies to save cost (keep at least 2).');
    }
  });

  if (opts.slo && r.metrics.latency > opts.slo) {
    add('error', 'Too slow for the target', `Mean latency is ${fmtMs(r.metrics.latency)}, above the ${opts.slo} ms target.`, null, 'Find the slowest busy block on the path. Busy blocks get slow, so add copies or a cache.');
  }
  return out;
}

/* ---------- failure sweep, scenario runs and grading ---------- */

// Kill one copy of each block in turn and see how the system copes.
function failureSweep(design, traffic) {
  return design.nodes
    .filter(n => n.type !== 'user' && n.type !== 'external')
    .map(n => {
      const result = simulate(design, traffic, { failIds: [n.id], ignoreManual: true, quiet: true });
      return { id: n.id, success: result.metrics.success, latency: result.metrics.latency, result };
    })
    .sort((a, b) => a.success - b.success || b.latency - a.latency);
}

// What the Run button does: simulate, then flag single points of failure.
function runScenario(design, traffic, slo) {
  const result = simulate(design, traffic, { slo });
  const baseline = simulate(design, traffic, { ignoreManual: true, quiet: true }).metrics.success;
  if (baseline > 0.5) {
    failureSweep(design, traffic).forEach(f => {
      if (f.success < SPOF_THRESHOLD) {
        const n = design.nodes.find(x => x.id === f.id);
        result.warnings.push({
          level: 'error', title: 'Single point of failure', nodeId: n.id,
          msg: `If one copy of ${labelOf(n)} dies, only ${fmtPct(f.success)} of requests succeed.`,
          fix: (BLOCKS[n.type].fixed ? 'Plan a fallback.' : 'Run at least 2 copies, sized so the rest can carry the load.'),
        });
      }
    });
  }
  const order = { error: 0, warn: 1, info: 2 };
  result.warnings.sort((a, b) => order[a.level] - order[b.level]);
  return result;
}

const typeArrival = (r, type, kind) => r.g.nodes.filter(n => n.type === type).reduce((a, n) => a + (kind ? r.st[n.id].arrival[kind] : sumKinds(r.st[n.id].arrival)), 0);

const CHECKS = {
  writesPersist: r => r.demand.write <= 0 || typeArrival(r, 'db', 'write') > 0,
  searchIndex: r => typeArrival(r, 'search', 'search') > 0 && typeArrival(r, 'db', 'search') < 1,
  syncWrites: r => typeArrival(r, 'db', 'write') > 0 && typeArrival(r, 'queue', 'write') < 1,
  asyncWrites: r => typeArrival(r, 'queue', 'write') > 0,
  usesCDN: r => typeArrival(r, 'cdn') > 0,
  blobMedia: r => typeArrival(r, 'blob', 'media') > 0 && typeArrival(r, 'db', 'media') < 1,
  websocket: r => typeArrival(r, 'websocket') > 0,
  rateLimiter: r => typeArrival(r, 'ratelimiter') > 0,
  external: r => typeArrival(r, 'external', 'write') > 0,
};

const clamp01 = x => Math.max(0, Math.min(1, x));

function evaluate(design, problem) {
  const base = { rps: problem.rps, mix: problem.mix };
  const normal = runScenario(design, base, problem.slo);
  const tests = problem.tests.map(t => {
    const traffic = Object.assign({}, base, { mult: t.mult || 1, kindMult: t.kindMult });
    let res, failedNode = null;
    if (t.fail === 'worst') {
      const sweep = failureSweep(design, traffic).map(f => Object.assign(f, { verdict: judge(f.result, t, problem) }));
      // The worst case is the failure that breaks the most criteria, then the lowest success.
      sweep.sort((a, b) => b.verdict.reasons.length - a.verdict.reasons.length || a.success - b.success || b.latency - a.latency);
      if (sweep.length) { res = sweep[0].result; failedNode = design.nodes.find(n => n.id === sweep[0].id); }
    }
    if (!res) res = simulate(design, traffic, { ignoreManual: true, quiet: true });
    const verdict = judge(res, t, problem);
    return Object.assign({ test: t, res, failedNode }, verdict);
  });

  const checks = (problem.checks || []).map(id => ({ id, label: CHECK_INFO[id].label, fix: CHECK_INFO[id].fix, pass: !!CHECKS[id](normal) }));

  // Score: 75 for tests, 15 for requirements, 10 for efficiency.
  const testPts = tests.length ? tests.reduce((a, t) => a + t.score, 0) / tests.length * 75 : 75;
  const checkPts = checks.length ? checks.filter(c => c.pass).length / checks.length * 15 : 15;
  let eff = 10;
  normal.warnings.forEach(w => { if (w.level === 'warn') eff -= 2; });
  const computeUtils = normal.g.nodes.filter(n => roleOf(n) === 'compute' && sumKinds(normal.st[n.id].arrival) > 0).map(n => normal.st[n.id].util);
  const u = avg(computeUtils);
  if (computeUtils.length && u < 0.05) eff -= 6; else if (computeUtils.length && u < 0.15) eff -= 3;
  eff = Math.max(0, eff);
  const score = Math.round(testPts + checkPts + eff);
  const solved = tests.every(t => t.pass) && checks.every(c => c.pass);

  const feedback = [];
  const seen = new Set();
  const push = (title, fix, nodeId) => { const key = title + fix; if (!seen.has(key)) { seen.add(key); feedback.push({ title, fix, nodeId }); } };
  checks.filter(c => !c.pass).forEach(c => push(c.label, c.fix));
  tests.filter(t => !t.pass && t.failedNode).forEach(t => push(`Losing one copy of ${labelOf(t.failedNode)} breaks the system`, BLOCKS[t.failedNode.type].fixed ? 'Plan a fallback for this provider.' : 'Give it at least 2 copies, sized so the survivors can carry the full load.', t.failedNode.id));
  tests.filter(t => !t.pass && !t.failedNode).forEach(t => {
    const r = simulate(design, t.res.traffic, { ignoreManual: true });
    r.warnings.filter(w => w.level === 'error').forEach(w => push(`${t.test.name}: ${w.title}`, w.fix, w.nodeId));
  });
  normal.warnings.filter(w => w.level !== 'info').forEach(w => push(w.title, w.fix, w.nodeId));

  return {
    normal, tests, checks, score, solved, feedback,
    breakdown: { tests: Math.round(testPts), requirements: Math.round(checkPts), efficiency: eff },
  };
}

function judge(res, t, problem) {
  const m = res.metrics, minS = t.minSuccess ?? 0.99, reasons = [];
  if (!m.demand) reasons.push('No traffic reached the system');
  if (m.success < minS) reasons.push(`${fmtPct(m.success)} of requests succeeded (need ${fmtPct(minS)})`);
  if (m.latency > problem.slo) reasons.push(`Mean latency ${fmtMs(m.latency)} is above the ${problem.slo} ms target`);
  const backlog = res.g.nodes.filter(n => n.type === 'queue' && (res.st[n.id].backlog > 0 || (sumKinds(res.st[n.id].arrival) > 0 && !res.st[n.id].consumers)));
  if (backlog.length) reasons.push(`Queue backlog grows without limit at ${backlog.map(labelOf).join(', ')}`);
  if (t.noOverload) {
    const over = res.g.nodes.filter(n => n.type !== 'ratelimiter' && n.type !== 'user' && res.st[n.id].util > 1);
    if (over.length) reasons.push(`Backend overloaded: ${over.map(labelOf).join(', ')}`);
  }
  const pass = !reasons.length;
  let score = 1;
  if (!pass) {
    const s = clamp01((m.success - 0.5) / Math.max(0.01, minS - 0.5));
    const l = m.latency > 0 ? clamp01(problem.slo / m.latency) : 0;
    score = (0.6 * s + 0.4 * l) * 0.8 * (reasons.length > 1 ? 0.75 : 1);
  }
  return { pass, reasons, score };
}
