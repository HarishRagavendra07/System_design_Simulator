/* App shell: hash routing, pages, and the simulation workbench. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (type, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${ICONS[type]}"/></svg>`;

const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('syssim:' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem('syssim:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  del(key) { try { localStorage.removeItem('syssim:' + key); } catch { /* storage unavailable */ } },
};

function progress() { return Store.get('progress', {}); }
function recordResult(id, score, solved) {
  const p = progress();
  const prev = p[id] || { best: 0, solved: false, attempts: 0 };
  p[id] = { best: Math.max(prev.best, score), solved: prev.solved || solved, attempts: prev.attempts + 1, last: score };
  Store.set('progress', p);
  updateProgressPill();
}
function updateProgressPill() {
  const p = progress();
  const solved = ALL_PROBLEMS.filter(x => p[x.id] && p[x.id].solved).length;
  $('#progressPill').textContent = `${solved} / ${ALL_PROBLEMS.length} solved`;
}

/* ---------- routing ---------- */

let current = null;
function route() {
  if (current && current.destroy) current.destroy();
  current = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = parts[0] || 'home';
  const app = $('#app');
  app.innerHTML = '';
  app.className = '';
  document.body.classList.toggle('full', page === 'sim' || page === 'sandbox');
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (page === 'sim' ? 'problems' : page)));
  if (page === 'problems') renderProblems(app);
  else if (page === 'learn') parts[1] ? renderConcept(app, parts[1]) : renderLearn(app);
  else if (page === 'sim') {
    const p = findProblem(parts[1]);
    if (p) current = new Workbench(app, p); else renderNotFound(app);
  } else if (page === 'sandbox') current = new Workbench(app, SANDBOX);
  else renderHome(app);
  updateProgressPill();
  window.scrollTo(0, 0);
}

function renderNotFound(app) {
  app.innerHTML = `<section class="page narrow"><h1>Not found</h1><p class="muted">That page does not exist.</p><a class="btn" href="#/problems">Back to practice</a></section>`;
}

/* ---------- home ---------- */

const FAILURE_MODES = [
  ['Single point of failure', 'One box dies and takes everything with it.', 'spof'],
  ['Database saturation', 'More queries than the database can answer; requests drop.', 'replication'],
  ['Queue backlog', 'Workers slower than producers; the queue grows forever.', 'queues'],
  ['Latency blow-up', 'A block at 90% busy is 10× slower than idle.', 'latency'],
  ['Search table scans', 'Full-text search on a database costs 5× and runs 10× slower.', 'search'],
  ['Replica lag', 'Heavy writes leave read replicas behind.', 'replication'],
  ['Cache stampede', 'Cache dies and every read lands on the database.', 'caching'],
  ['Floods & abuse', 'Without a rate limiter one client can sink you.', 'rate-limiting'],
];

function renderHome(app) {
  const p = progress();
  const next = ALL_PROBLEMS.find(x => !(p[x.id] && p[x.id].solved)) || PROBLEMS[0];
  app.innerHTML = `
  <section class="hero">
    <div class="hero-text">
      <span class="eyebrow">System design, by simulation</span>
      <h1>Learn system design by <em>breaking things</em>.</h1>
      <p class="lead">Draw an architecture, push real traffic through it and watch where it fails. Fix the weak spot, run it again, and get a score on the things interviewers care about.</p>
      <div class="cta">
        <a class="btn primary lg" href="#/sim/${next.id}">${p[next.id] ? 'Continue' : 'Start'}: ${esc(next.title)}</a>
        <a class="btn lg" href="#/learn">Learn the concepts</a>
      </div>
    </div>
    <div class="hero-demo" id="heroDemo"></div>
  </section>

  <section class="page">
    <h2 class="section-title">How it works</h2>
    <div class="steps">
      <div class="step"><span class="step-n">1</span><h3>Design</h3><p>Drag 16 kinds of blocks onto the canvas (load balancers, caches, queues, shards) and wire them together.</p></div>
      <div class="step"><span class="step-n">2</span><h3>Simulate</h3><p>Send traffic through it. Watch requests flow, see which block saturates, and kill components on purpose.</p></div>
      <div class="step"><span class="step-n">3</span><h3>Score</h3><p>Submit to run the test scenarios (normal load, spikes, failures) and get a score with concrete fixes.</p></div>
    </div>

    <h2 class="section-title">What the simulator catches</h2>
    <div class="modes">
      ${FAILURE_MODES.map(([t, d, c]) => `<a class="mode" href="#/learn/${c}"><strong>${t}</strong><span>${d}</span></a>`).join('')}
    </div>

    <h2 class="section-title">Pick a path</h2>
    <div class="paths">
      <a class="path-card" href="#/problems"><h3>Guided labs</h3><p>${LABS.length} short exercises. Each starts from a broken design and teaches one idea.</p><span class="link">Open labs →</span></a>
      <a class="path-card" href="#/problems"><h3>Interview problems</h3><p>${PROBLEMS.length} classic questions with real constraints, spikes and failure tests.</p><span class="link">Practice →</span></a>
      <a class="path-card" href="#/sandbox"><h3>Sandbox</h3><p>Your own traffic, your own target. Try any idea and see what happens.</p><span class="link">Open sandbox →</span></a>
    </div>
  </section>`;
  mountHeroDemo($('#heroDemo'));
}

// A small live design on the home page, cycling between calm and overloaded.
function mountHeroDemo(host) {
  host.innerHTML = '<svg class="canvas demo"></svg><div class="demo-caption" id="demoCaption"></div>';
  const ed = new Editor($('svg', host), {});
  ed.svg.style.pointerEvents = 'none';
  const design = {
    nodes: [
      { id: 'u', type: 'user', x: 0, y: 120 },
      { id: 'l', type: 'lb', x: 230, y: 120, cfg: { replicas: 2 } },
      { id: 's', type: 'server', x: 460, y: 40, cfg: { replicas: 3 } },
      { id: 'c', type: 'cache', x: 700, y: 0 },
      { id: 'd', type: 'db', x: 700, y: 200, cfg: { replicas: 2 } },
    ],
    edges: [{ id: 'a', from: 'u', to: 'l' }, { id: 'b', from: 'l', to: 's' }, { id: 'c1', from: 's', to: 'c' }, { id: 'd1', from: 's', to: 'd' }],
  };
  ed.load(design);
  const states = [{ mult: 1, cap: 'Normal load: everything green.' }, { mult: 1.4, cap: 'Traffic grows: servers running hot.' }, { mult: 1.9, cap: 'Spike: servers overloaded, requests dropped.' }];
  let i = 0;
  const step = () => {
    const s = states[i % states.length];
    ed.setResult(simulate(design, { rps: 2000, mix: { read: 0.85, write: 0.15 }, mult: s.mult }, { quiet: true }));
    const cap = $('#demoCaption');
    if (cap) cap.textContent = s.cap;
    i++;
  };
  step();
  const timer = setInterval(step, 2600);
  const onResize = () => ed.fit();
  window.addEventListener('resize', onResize);
  current = { destroy() { clearInterval(timer); ed.destroy(); window.removeEventListener('resize', onResize); } };
}

/* ---------- problem list ---------- */

function problemCard(pb) {
  const pr = progress()[pb.id];
  const status = pr ? (pr.solved ? `<span class="badge solved">Solved · ${pr.best}</span>` : `<span class="badge tried">Best ${pr.best}</span>`) : '';
  return `<a class="card problem" href="#/sim/${pb.id}">
    <div class="card-top"><span class="diff diff-${pb.difficulty.toLowerCase()}">${pb.difficulty}</span>${status}</div>
    <h3>${esc(pb.title.replace(/^Lab: /, ''))}</h3>
    <p>${esc(pb.summary)}</p>
    <div class="card-foot">
      <span class="tags">${pb.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>
      <span class="rps">${fmtRps(pb.rps)} req/s</span>
    </div>
  </a>`;
}

function renderProblems(app) {
  app.innerHTML = `<section class="page">
    <h1>Practice</h1>
    <p class="lead muted">Start with the labs if you are new: each one fixes a single broken design. Then take on the interview problems.</p>
    <h2 class="section-title">Guided labs</h2>
    <div class="grid">${LABS.map(problemCard).join('')}</div>
    <h2 class="section-title">Interview problems</h2>
    <div class="grid">${PROBLEMS.map(problemCard).join('')}</div>
  </section>`;
}

/* ---------- learn ---------- */

function practiceLink(id) {
  if (id === 'sandbox') return { href: '#/sandbox', label: 'Open the sandbox' };
  const p = findProblem(id);
  return p ? { href: `#/sim/${p.id}`, label: p.lab ? `Try it: ${p.title.replace(/^Lab: /, '')}` : `Practice: ${p.title}` } : null;
}

function renderLearn(app) {
  app.innerHTML = `<section class="page">
    <h1>Learn</h1>
    <p class="lead muted">${CONCEPTS.length} core ideas in roadmap order. Read one, then try it on the canvas straight away.</p>
    ${PHASES.map((ph, i) => `
      <h2 class="section-title"><span class="phase-n">${i + 1}</span>${ph}</h2>
      <div class="grid">${CONCEPTS.filter(c => c.phase === ph).map(c => `
        <a class="card concept" href="#/learn/${c.id}"><h3>${esc(c.title)}</h3><p>${esc(c.summary)}</p><span class="link">Read →</span></a>`).join('')}
      </div>`).join('')}
    <h2 class="section-title">How the simulator models your design</h2>
    <div class="model card static">
      <ul>
        <li><b>Traffic</b> has four kinds: reads, writes, searches and media. Each problem sets the volume and the mix.</li>
        <li><b>Routers</b> (load balancer, gateway, proxy, rate limiter, CDN) split traffic evenly across the healthy blocks behind them. A CDN answers its hit rate of reads and media itself.</li>
        <li><b>Servers and services</b> call the next tier, plus every data block wired to them: reads go to the cache first and only misses reach the database; searches go to a search index if there is one; media to blob storage; writes to a queue if there is one, otherwise the database; writes also call any third-party API.</li>
        <li><b>Capacity</b> = copies × capacity per copy. Over capacity, the excess is dropped. A database's copies share reads, but every copy applies every write; shards split everything.</li>
        <li><b>Latency</b> = work ÷ (1 − utilization), added up along the path. Busy blocks get slow long before they fail.</li>
        <li><b>Queues</b> answer instantly and pass work to Workers at their total capacity. Anything beyond that is backlog.</li>
        <li><b>Failure tests</b> kill one copy of each block in turn. A block with one copy goes fully down.</li>
      </ul>
      <p class="muted small">It is a teaching model, not a benchmark. The numbers are realistic in shape and order of magnitude.</p>
    </div>
  </section>`;
}

function renderConcept(app, id) {
  const c = CONCEPTS.find(x => x.id === id);
  if (!c) return renderNotFound(app);
  const idx = CONCEPTS.indexOf(c);
  const prev = CONCEPTS[idx - 1], next = CONCEPTS[idx + 1];
  const link = practiceLink(c.practice);
  app.innerHTML = `<article class="page narrow concept-page">
    <a class="back" href="#/learn">← All concepts</a>
    <span class="eyebrow">${c.phase}</span>
    <h1>${esc(c.title)}</h1>
    <p class="lead">${esc(c.summary)}</p>
    <h2>Key ideas</h2>
    <ul class="points">${c.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    <h2>Trade-offs</h2>
    <ul class="points trade">${c.tradeoffs.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
    ${c.numbers ? `<h2>Numbers worth knowing</h2><ul class="points nums">${c.numbers.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${link ? `<div class="try"><div><strong>Now build it</strong><p class="muted">Reading is not practising. Put this idea on the canvas and break it.</p></div><a class="btn primary" href="${link.href}">${esc(link.label)}</a></div>` : ''}
    <nav class="pager">
      ${prev ? `<a href="#/learn/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="#/learn/${next.id}">${esc(next.title)} →</a>` : '<span></span>'}
    </nav>
  </article>`;
}

/* ---------- workbench ---------- */

function defaultDesign() {
  return { nodes: [{ id: 'users', type: 'user', x: 60, y: 200 }], edges: [] };
}

class Workbench {
  constructor(root, problem) {
    this.p = problem;
    this.sandbox = !!problem.sandbox;
    if (this.sandbox) this.p = Object.assign({}, problem, Store.get('sandbox-traffic', {}));
    this.tab = 'brief';
    this.live = false;
    this.lastRun = null;
    this.lastEval = null;
    this.sel = null;
    root.className = 'wb';
    root.innerHTML = this.template();
    this.root = root;
    this.editor = new Editor($('.canvas', root), {
      onSelect: s => { this.sel = s; if (s) this.showTab('inspect'); else if (this.tab === 'inspect') this.renderPanel(); },
      onChange: d => this.onChange(d),
      onZoom: k => { const z = $('#zoomLabel', root); if (z) z.textContent = Math.round(k * 100) + '%'; },
    });
    this.editor.load(Store.get('design:' + problem.id, null) || problem.starter || defaultDesign());
    this.bind();
    this.renderPanel();
    this.updateEmptyHint();
    this._resize = () => this.editor.applyView();
    window.addEventListener('resize', this._resize);
  }

  destroy() {
    this.editor.destroy();
    clearTimeout(this.timer);
    window.removeEventListener('resize', this._resize);
  }

  scenarios() {
    if (this.sandbox) return [{ name: 'Normal load', mult: 1 }, { name: '2× traffic', mult: 2 }, { name: '5× traffic', mult: 5 }, { name: '10× traffic', mult: 10 }];
    const list = this.p.tests.filter(t => !t.fail);
    return list.length ? list : [{ name: 'Normal load' }];
  }

  traffic() {
    const s = this.scenarios()[+$('#scenario', this.root).value || 0];
    return { rps: this.p.rps, mix: this.p.mix, mult: s.mult || 1, kindMult: s.kindMult };
  }

  template() {
    const p = this.p;
    const groups = BLOCK_GROUPS.map(g => `
      <div class="pal-group"><div class="pal-title">${g}</div>
        ${Object.entries(BLOCKS).filter(([, b]) => b.group === g).map(([t, b]) => `
          <div class="pal-item" draggable="true" data-type="${t}" title="${esc(b.desc)}">
            <span class="pal-icon">${icon(t, 18)}</span>
            <span><b>${b.name}</b><small>${esc(b.desc.split('.')[0])}</small></span>
          </div>`).join('')}
      </div>`).join('');
    return `
    <div class="wb-top">
      <a class="btn ghost sm" href="${this.sandbox ? '#/' : '#/problems'}">←</a>
      <div class="wb-title"><b>${esc(p.title)}</b><span class="diff diff-${p.difficulty.toLowerCase().replace(/\s/g, '-')}">${p.difficulty}</span></div>
      <div class="wb-actions">
        <label class="scenario-label">Scenario
          <select id="scenario">${this.scenarios().map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select>
        </label>
        <button class="btn primary" id="runBtn" title="Send traffic through the design">▶ Run</button>
        ${this.sandbox ? '' : '<button class="btn accent" id="submitBtn" title="Run every test and get a score">Submit</button>'}
      </div>
    </div>
    <div class="wb-body">
      <aside class="palette">
        <input id="palSearch" class="search" placeholder="Search blocks" autocomplete="off">
        <div class="pal-list">${groups}</div>
        <p class="pal-help">Drag a block onto the canvas (or click it). Drag from the <span class="dot-sample"></span> on a block's right edge to connect it.</p>
      </aside>
      <div class="stage">
        <div class="toolbar">
          <button data-act="undo" title="Undo (⌘Z)">↶</button>
          <button data-act="redo" title="Redo (⇧⌘Z)">↷</button>
          <span class="sep"></span>
          <button data-act="zoomOut" title="Zoom out">−</button>
          <span id="zoomLabel">100%</span>
          <button data-act="zoomIn" title="Zoom in">+</button>
          <button data-act="fit" title="Fit to screen">⤢</button>
          <span class="sep"></span>
          <button data-act="export" title="Download design as JSON">Export</button>
          <button data-act="import" title="Load a design JSON">Import</button>
          <button data-act="reset" title="${p.starter ? 'Back to the starting design' : 'Clear the canvas'}">Reset</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </div>
        <svg class="canvas"></svg>
        <div class="empty-hint" id="emptyHint">
          <b>Start with the traffic path</b>
          <span>Users → Load Balancer → App Server → Database. Then press Run.</span>
        </div>
        <div class="metrics-strip" id="metricsStrip" hidden></div>
        <div class="legend"><span class="swatch st-ok"></span>healthy <span class="swatch st-hot"></span>hot &gt;70% <span class="swatch st-over"></span>overloaded <span class="swatch st-down"></span>down</div>
      </div>
      <aside class="panel">
        <div class="tabs">
          <button data-tab="brief">${this.sandbox ? 'Traffic' : 'Problem'}</button>
          <button data-tab="inspect">Inspect</button>
          <button data-tab="results">Results</button>
        </div>
        <div class="panel-body" id="panelBody"></div>
      </aside>
    </div>`;
  }

  bind() {
    const root = this.root;
    $$('.pal-item', root).forEach(item => {
      item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', item.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
      item.addEventListener('click', () => this.editor.addNode(item.dataset.type));
    });
    $('#palSearch', root).addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      $$('.pal-item', root).forEach(i => {
        const b = BLOCKS[i.dataset.type];
        i.hidden = q && !(b.name + ' ' + b.desc).toLowerCase().includes(q);
      });
      $$('.pal-group', root).forEach(g => { g.hidden = !$$('.pal-item', g).some(i => !i.hidden); });
    });
    $$('.tabs button', root).forEach(b => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    $('#runBtn', root).addEventListener('click', () => this.run());
    const sub = $('#submitBtn', root);
    if (sub) sub.addEventListener('click', () => this.submit());
    $('#scenario', root).addEventListener('change', () => { if (this.live) this.run(true); });
    $('#importFile', root).addEventListener('change', e => this.importFile(e.target.files[0]));
    $$('.toolbar [data-act]', root).forEach(b => b.addEventListener('click', () => this.toolbar(b.dataset.act)));
  }

  toolbar(act) {
    const ed = this.editor;
    if (act === 'undo') ed.undo();
    else if (act === 'redo') ed.redo();
    else if (act === 'zoomIn') ed.zoomBy(1.2);
    else if (act === 'zoomOut') ed.zoomBy(1 / 1.2);
    else if (act === 'fit') ed.fit();
    else if (act === 'import') $('#importFile', this.root).click();
    else if (act === 'export') {
      const blob = new Blob([JSON.stringify({ problem: this.p.id, design: ed.getDesign() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `syssim-${this.p.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (act === 'reset') {
      if (!confirm(this.p.starter ? 'Reset to the starting design? Your changes will be lost.' : 'Clear the canvas?')) return;
      Store.del('design:' + this.p.id);
      ed.load(this.p.starter || defaultDesign());
      ed.setResult(null);
      this.live = false; this.lastRun = null; this.lastEval = null;
      $('#metricsStrip', this.root).hidden = true;
      this.updateEmptyHint();
      this.renderPanel();
    }
  }

  importFile(file) {
    if (!file) return;
    file.text().then(text => {
      const data = JSON.parse(text);
      const d = data.design || data;
      if (!Array.isArray(d.nodes) || !Array.isArray(d.edges) || d.nodes.some(n => !BLOCKS[n.type])) throw new Error('bad design');
      this.editor.load(d);
      this.onChange(this.editor.getDesign());
    }).catch(() => alert('That file is not a SysSim design.'));
    $('#importFile', this.root).value = '';
  }

  onChange(design) {
    Store.set('design:' + this.p.id, design);
    this.updateEmptyHint();
    if (this.tab === 'inspect') this.refreshInspect();
    if (this.live) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(true), 120);
    }
  }

  updateEmptyHint() {
    $('#emptyHint', this.root).hidden = this.editor.getDesign().nodes.length > 1;
  }

  run(quiet) {
    const result = runScenario(this.editor.getDesign(), this.traffic(), this.p.slo);
    this.live = true;
    this.lastRun = result;
    this.lastEval = null;
    this.editor.setResult(result);
    this.renderMetrics(result);
    if (!quiet || this.tab === 'results') this.showTab('results');
    else if (this.tab === 'inspect') this.refreshInspect();
  }

  // Re-render the inspector unless the user is typing in it (that would steal focus).
  refreshInspect() {
    const body = $('#panelBody', this.root);
    if (!body.contains(document.activeElement) || document.activeElement === body) this.renderPanel();
  }

  submit() {
    const ev = evaluate(this.editor.getDesign(), this.p);
    $('#scenario', this.root).value = 0;
    this.live = true;
    this.lastRun = ev.normal;
    this.lastEval = ev;
    this.editor.setResult(ev.normal);
    this.renderMetrics(ev.normal);
    recordResult(this.p.id, ev.score, ev.solved);
    this.showTab('results');
  }

  renderMetrics(r) {
    const m = r.metrics, strip = $('#metricsStrip', this.root);
    const ok = (good, warn) => good ? 'good' : warn ? 'warn' : 'bad';
    strip.hidden = false;
    strip.innerHTML = [
      ['Traffic', fmtRps(m.demand) + '/s', ''],
      ['Success', fmtPct(m.success), ok(m.success >= 0.99, m.success >= 0.95)],
      ['Mean latency', fmtMs(m.latency), ok(m.latency <= this.p.slo, m.latency <= this.p.slo * 1.5)],
      ['p99 latency', fmtMs(m.p99), ''],
      ['Cost', '$' + m.cost.toLocaleString() + '/mo', ''],
    ].map(([k, v, c]) => `<div class="metric ${c}"><span>${k}</span><b>${v}</b></div>`).join('');
  }

  showTab(tab) {
    this.tab = tab;
    $$('.tabs button', this.root).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.renderPanel();
  }

  renderPanel() {
    $$('.tabs button', this.root).forEach(b => b.classList.toggle('active', b.dataset.tab === this.tab));
    const body = $('#panelBody', this.root);
    if (this.tab === 'brief') body.innerHTML = this.sandbox ? this.trafficHtml() : this.briefHtml();
    else if (this.tab === 'inspect') body.innerHTML = this.inspectHtml();
    else body.innerHTML = this.resultsHtml();
    this.bindPanel(body);
  }

  briefHtml() {
    const p = this.p;
    const mix = Object.entries(p.mix).filter(([, v]) => v > 0).map(([k, v]) => `<span class="mix-chip">${KIND_LABELS[k]} ${Math.round(v * 100)}%</span>`).join('');
    return `
      <p>${esc(p.description)}</p>
      <div class="mix">${mix}</div>
      <h4>Constraints</h4>
      <ul class="list">${p.constraints.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      <h4>Test scenarios</h4>
      <ul class="list tests">${p.tests.map(t => `<li><b>${esc(t.name)}</b><span class="muted">${testDesc(t, p)}</span></li>`).join('')}</ul>
      ${p.checks.length ? `<h4>Requirements</h4><ul class="list">${p.checks.map(id => `<li>${esc(CHECK_INFO[id].label)}</li>`).join('')}</ul>` : ''}
      <h4>Hints</h4>
      ${p.hints.map((h, i) => `<details class="hint"><summary>Hint ${i + 1}</summary><p>${esc(h)}</p></details>`).join('')}
      <div class="panel-cta"><button class="btn primary block" data-do="run">▶ Run normal load</button></div>`;
  }

  trafficHtml() {
    const p = this.p;
    return `
      <p class="muted">${esc(p.description)}</p>
      <label class="field"><span>Requests per second</span><input type="number" min="1" step="100" data-traffic="rps" value="${p.rps}"></label>
      <label class="field"><span>Latency target, mean (ms)</span><input type="number" min="1" step="10" data-traffic="slo" value="${p.slo}"></label>
      <h4>Traffic mix</h4>
      ${Object.keys(KIND_LABELS).map(k => `
        <label class="field range"><span>${KIND_LABELS[k]} <b id="mix-${k}">${Math.round((p.mix[k] || 0) * 100)}%</b></span>
          <input type="range" min="0" max="100" step="5" data-mix="${k}" value="${Math.round((p.mix[k] || 0) * 100)}"></label>`).join('')}
      <p class="muted small">The mix is normalised to 100%.</p>
      <div class="panel-cta"><button class="btn primary block" data-do="run">▶ Run</button></div>`;
  }

  inspectHtml() {
    const sel = this.sel && this.editor.findSel();
    if (!sel) {
      return `<div class="empty">
        <p><b>Nothing selected.</b> Click a block or an arrow on the canvas.</p>
        <ul class="list small">
          <li>Drag from the dot on a block's right edge to connect it to another block.</li>
          <li>Press Delete to remove the selection, ⌘Z to undo.</li>
          <li>Drag the background to pan. Scroll or pinch to zoom.</li>
        </ul></div>`;
    }
    if (this.sel.kind === 'edge') {
      const a = this.editor.node(sel.from), b = this.editor.node(sel.to);
      const flow = this.lastRun ? this.lastRun.edgeFlow[sel.from + '>' + sel.to] || 0 : null;
      return `<h3 class="insp-title">Connection</h3>
        <p>${esc(labelOf(a))} → ${esc(labelOf(b))}</p>
        ${flow !== null ? `<p class="muted">Carrying ${fmtRps(flow)} req/s in the last run.</p>` : ''}
        <button class="btn danger block" data-do="delete">Delete connection</button>`;
    }
    const n = sel, b = BLOCKS[n.type], cfg = blockCfg(n);
    const fields = Object.keys(b.defaults || {}).map(f => {
      const meta = FIELDS[f], label = (FIELD_LABELS[n.type] || {})[f] || meta.label;
      const val = meta.pct ? Math.round(cfg[f] * 100) : cfg[f];
      return `<label class="field"><span>${label}${meta.pct ? ' (%)' : ''}</span>
        <input type="number" data-field="${f}" min="${meta.pct ? 0 : meta.min}" max="${meta.pct ? meta.max * 100 : meta.max}" step="${meta.pct ? 1 : meta.step}" value="${val}">
        <small>${esc(meta.help)}</small></label>`;
    }).join('');
    const r = this.lastRun, s = r && r.st[n.id];
    let stats = '';
    if (s && n.type !== 'user') {
      const total = s.arrival.read + s.arrival.write + s.arrival.search + s.arrival.media;
      const kinds = Object.keys(KIND_LABELS).filter(k => s.arrival[k] > 0.5).map(k => `${KIND_LABELS[k]} ${fmtRps(s.arrival[k])}/s`).join(' · ');
      stats = `<div class="insp-stats">
        <div><span>Incoming</span><b>${fmtRps(total)}/s</b></div>
        <div><span>Busy</span><b class="st-${nodeStatus(r, n.id)}">${fmtPct(s.util)}</b></div>
        <div><span>Dropped</span><b>${fmtPct(s.drop)}</b></div>
        ${n.type === 'queue' ? `<div><span>Backlog</span><b>${fmtRps(s.backlog)}/s</b></div>` : ''}
      </div>${kinds ? `<p class="muted small">${kinds}</p>` : ''}`;
    }
    return `
      <div class="insp-head"><span class="pal-icon">${icon(n.type, 20)}</span><div><h3 class="insp-title">${esc(b.name)}</h3><small class="muted">${b.group}</small></div></div>
      <p class="muted small">${esc(b.desc)}</p>
      ${stats}
      <label class="field"><span>Name</span><input type="text" data-label value="${esc(n.label || '')}" placeholder="${esc(b.name)}"></label>
      ${fields}
      ${n.type !== 'user' ? `<label class="check"><input type="checkbox" data-failed ${n.failed ? 'checked' : ''}> Simulate a failure (one copy goes down)</label>` : ''}
      ${n.type !== 'user' && b.cost ? `<p class="muted small">Cost: $${b.cost}/mo per copy${n.type === 'db' ? ' per shard' : ''}.</p>` : ''}
      <button class="btn danger block" data-do="delete">Delete block</button>`;
  }

  resultsHtml() {
    if (this.lastEval) return this.evalHtml(this.lastEval) + '<h4>Normal-load run</h4>' + this.runHtml(this.lastEval.normal, true);
    if (this.lastRun) return this.runHtml(this.lastRun);
    return `<div class="empty"><p><b>No results yet.</b></p><p class="muted">Press <b>Run</b> to send traffic through your design${this.sandbox ? '' : ', or <b>Submit</b> to run every test and get a score'}.</p></div>`;
  }

  runHtml(r, compact) {
    const w = r.warnings || [];
    const icons = { error: '✕', warn: '!', info: 'i' };
    const issues = w.length ? w.map((x, i) => `
      <div class="issue ${x.level}" ${x.nodeId ? `data-node="${x.nodeId}"` : ''} data-i="${i}">
        <span class="issue-ico">${icons[x.level]}</span>
        <div><b>${esc(x.title)}</b><p>${esc(x.msg)}</p>${x.fix ? `<p class="fix">Fix: ${esc(x.fix)}</p>` : ''}</div>
      </div>`).join('') : '<div class="issue ok"><span class="issue-ico">✓</span><div><b>No problems found</b><p>Every block has headroom and nothing is a single point of failure.</p></div></div>';
    const rows = r.g.nodes.filter(n => n.type !== 'user').map(n => {
      const s = r.st[n.id], total = s.arrival.read + s.arrival.write + s.arrival.search + s.arrival.media;
      return { n, s, total };
    }).sort((a, b) => (isFinite(b.s.util) ? b.s.util : 1e9) - (isFinite(a.s.util) ? a.s.util : 1e9));
    const table = `<table class="ntable"><thead><tr><th>Block</th><th>req/s</th><th>Busy</th></tr></thead><tbody>
      ${rows.map(({ n, s, total }) => `<tr data-node="${n.id}"><td>${esc(labelOf(n))}</td><td>${fmtRps(total)}</td><td class="st-${nodeStatus(r, n.id)}">${total > 0 || r.g.alive[n.id] <= 0 ? fmtPct(s.util) : '–'}</td></tr>`).join('')}
    </tbody></table>`;
    const m = r.metrics;
    const kinds = Object.entries(m.byKind).map(([k, v]) => `<tr><td>${KIND_LABELS[k]}</td><td>${fmtRps(v.demand)}</td><td>${fmtPct(v.success)}</td><td>${fmtMs(v.latency)}</td></tr>`).join('');
    return `
      ${compact ? '' : `<div class="run-head">Scenario: <b>${esc(this.scenarios()[+$('#scenario', this.root).value || 0].name)}</b>${this.live ? '<span class="live">live</span>' : ''}</div>`}
      <h4>Issues (${w.filter(x => x.level !== 'info').length})</h4>
      <div class="issues">${issues}</div>
      ${kinds ? `<h4>By request kind</h4><table class="ntable"><thead><tr><th>Kind</th><th>req/s</th><th>OK</th><th>Mean</th></tr></thead><tbody>${kinds}</tbody></table>` : ''}
      <h4>Blocks, busiest first</h4>${table}`;
  }

  evalHtml(ev) {
    const grade = ev.solved ? ['Interview ready', 'good'] : ev.score >= 65 ? ['Getting there', 'warn'] : ['Keep iterating', 'bad'];
    const deg = Math.round(ev.score * 3.6);
    return `
      <div class="score-card ${grade[1]}">
        <div class="ring" style="--deg:${deg}deg"><span>${ev.score}</span></div>
        <div><b>${grade[0]}</b><p class="muted small">${ev.solved ? 'All tests and requirements pass.' : 'Fix the failing items below and submit again.'}</p>
          <div class="breakdown">
            <span>Tests <b>${ev.breakdown.tests}/75</b></span>
            <span>Requirements <b>${ev.breakdown.requirements}/15</b></span>
            <span>Efficiency <b>${ev.breakdown.efficiency}/10</b></span>
          </div></div>
      </div>
      <h4>Tests</h4>
      ${ev.tests.map(t => `
        <div class="test ${t.pass ? 'pass' : 'fail'}">
          <div class="test-head"><span>${t.pass ? '✓' : '✕'}</span><b>${esc(t.test.name)}</b></div>
          <div class="test-metrics">${fmtRps(t.res.metrics.demand)}/s · ${fmtPct(t.res.metrics.success)} OK · ${fmtMs(t.res.metrics.latency)} mean${t.failedNode ? ` · killed one copy of <b>${esc(labelOf(t.failedNode))}</b>` : ''}</div>
          ${t.reasons.map(x => `<div class="reason">${esc(x)}</div>`).join('')}
        </div>`).join('')}
      ${ev.checks.length ? `<h4>Requirements</h4>${ev.checks.map(c => `<div class="test ${c.pass ? 'pass' : 'fail'}"><div class="test-head"><span>${c.pass ? '✓' : '✕'}</span><b>${esc(c.label)}</b></div></div>`).join('')}` : ''}
      ${ev.feedback.length ? `<h4>What to fix</h4><ol class="feedback">${ev.feedback.map(f => `<li ${f.nodeId ? `data-node="${f.nodeId}"` : ''}><b>${esc(f.title)}</b><span>${esc(f.fix)}</span></li>`).join('')}</ol>` : ''}`;
  }

  bindPanel(body) {
    $$('[data-do="run"]', body).forEach(b => b.addEventListener('click', () => this.run()));
    $$('[data-do="delete"]', body).forEach(b => b.addEventListener('click', () => this.editor.deleteSelection()));
    $$('[data-node]', body).forEach(el => el.addEventListener('click', () => {
      if (this.editor.node(el.dataset.node)) this.editor.select({ kind: 'node', id: el.dataset.node });
    }));
    const id = this.sel && this.sel.kind === 'node' ? this.sel.id : null;
    $$('[data-field]', body).forEach(inp => inp.addEventListener('change', () => {
      const f = inp.dataset.field, meta = FIELDS[f];
      let v = parseFloat(inp.value);
      if (!isFinite(v)) return;
      if (meta.pct) v = v / 100;
      v = Math.min(meta.max, Math.max(meta.pct ? 0 : meta.min, v));
      if (f === 'replicas' || f === 'shards') v = Math.round(v);
      this.editor.updateNode(id, { cfg: { [f]: v } });
    }));
    const label = $('[data-label]', body);
    if (label) label.addEventListener('change', () => this.editor.updateNode(id, { label: label.value.trim() }));
    const failed = $('[data-failed]', body);
    if (failed) failed.addEventListener('change', () => {
      this.editor.updateNode(id, { failed: failed.checked });
      if (!this.live) this.run(true);
    });
    $$('[data-traffic]', body).forEach(inp => inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (isFinite(v) && v > 0) this.p[inp.dataset.traffic] = v;
      this.saveTraffic();
    }));
    $$('[data-mix]', body).forEach(inp => inp.addEventListener('input', () => {
      $('#mix-' + inp.dataset.mix, body).textContent = inp.value + '%';
      const raw = {};
      $$('[data-mix]', body).forEach(x => { raw[x.dataset.mix] = +x.value; });
      const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
      Object.keys(raw).forEach(k => { raw[k] /= total; });
      this.p.mix = raw;
      this.saveTraffic();
    }));
  }

  saveTraffic() {
    Store.set('sandbox-traffic', { rps: this.p.rps, slo: this.p.slo, mix: this.p.mix });
    if (this.live) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(true), 150); }
  }
}

function testDesc(t, p) {
  if (t.fail) return 'One copy of each block is killed in turn; the worst case must still pass.';
  const parts = [];
  if (t.mult && t.mult !== 1) parts.push(`${t.mult}× all traffic`);
  if (t.kindMult) Object.entries(t.kindMult).forEach(([k, v]) => parts.push(`${v}× ${KIND_LABELS[k].toLowerCase()}`));
  if (t.noOverload) parts.push('no backend block may be overloaded');
  const minS = t.minSuccess ?? 0.99;
  return `${parts.length ? parts.join(', ') + '. ' : ''}Needs ≥${fmtPct(minS)} success and mean latency ≤ ${p.slo} ms.`;
}

window.addEventListener('hashchange', route);
route();
