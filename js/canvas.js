/* SVG design canvas: drop blocks, wire them up, select, pan/zoom, undo, and animate traffic. */

const NODE_W = 168, NODE_H = 62;
const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function newId(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }

function nodeStatus(result, id) {
  if (!result || !result.st[id]) return 'idle';
  const s = result.st[id], alive = result.g.alive[id];
  if (alive <= 0) return 'down';
  const total = s.arrival.read + s.arrival.write + s.arrival.search + s.arrival.media;
  if (total <= 0) return 'idle';
  if (s.util > 1) return 'over';
  if (s.util > 0.7) return 'hot';
  return 'ok';
}

class Editor {
  constructor(svg, hooks) {
    this.svg = svg;
    this.hooks = hooks || {};
    this.view = { x: 30, y: 30, k: 1 };
    this.design = { nodes: [], edges: [] };
    this.sel = null;
    this.result = null;
    this.snapshots = [];
    this.at = -1;
    this.particles = [];

    const defs = svgEl('defs', {}, svg);
    ['idle', 'ok', 'hot', 'over', 'down'].forEach(s => {
      const m = svgEl('marker', { id: 'arrow-' + s, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'arrowhead st-' + s }, m);
    });
    this.root = svgEl('g', {}, svg);
    this.edgeLayer = svgEl('g', {}, this.root);
    this.dotLayer = svgEl('g', {}, this.root);
    this.nodeLayer = svgEl('g', {}, this.root);
    this.temp = svgEl('path', { class: 'edge-temp', d: '' }, this.root);

    this._down = e => this.onDown(e);
    this._move = e => this.onMove(e);
    this._up = e => this.onUp(e);
    this._wheel = e => this.onWheel(e);
    this._key = e => this.onKey(e);
    this._over = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    this._drop = e => this.onDrop(e);
    svg.addEventListener('pointerdown', this._down);
    svg.addEventListener('pointermove', this._move);
    svg.addEventListener('pointerup', this._up);
    svg.addEventListener('pointercancel', this._up);
    svg.addEventListener('wheel', this._wheel, { passive: false });
    svg.addEventListener('dragover', this._over);
    svg.addEventListener('drop', this._drop);
    document.addEventListener('keydown', this._key);

    this.running = true;
    const tick = t => { if (!this.running) return; this.animate(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    this.applyView();
  }

  destroy() {
    this.running = false;
    document.removeEventListener('keydown', this._key);
  }

  /* ---------- model ---------- */

  load(design) {
    this.design = JSON.parse(JSON.stringify(design));
    this.snapshots = [JSON.stringify(this.design)];
    this.at = 0;
    this.sel = null;
    this.render();
    this.fit();
  }

  getDesign() { return this.design; }

  commit() {
    const snap = JSON.stringify(this.design);
    if (snap === this.snapshots[this.at]) return;
    this.snapshots = this.snapshots.slice(0, this.at + 1);
    this.snapshots.push(snap);
    if (this.snapshots.length > 150) this.snapshots.shift();
    this.at = this.snapshots.length - 1;
    this.changed();
  }

  changed() {
    this.render();
    if (this.hooks.onChange) this.hooks.onChange(this.design);
  }

  restore(i) {
    if (i < 0 || i >= this.snapshots.length) return;
    this.at = i;
    this.design = JSON.parse(this.snapshots[i]);
    if (this.sel && !this.findSel()) this.select(null);
    this.changed();
  }
  undo() { this.restore(this.at - 1); }
  redo() { this.restore(this.at + 1); }

  node(id) { return this.design.nodes.find(n => n.id === id); }

  findSel() {
    if (!this.sel) return null;
    return this.sel.kind === 'node' ? this.node(this.sel.id) : this.design.edges.find(e => e.id === this.sel.id);
  }

  addNode(type, x, y) {
    if (x === undefined) {
      const r = this.svg.getBoundingClientRect();
      x = (r.width / 2 - this.view.x) / this.view.k - NODE_W / 2;
      y = (r.height / 2 - this.view.y) / this.view.k - NODE_H / 2;
      // Step down (then right) until the spot is clear of other blocks.
      const clash = (px, py) => this.design.nodes.some(n => Math.abs(n.x - px) < NODE_W + 20 && Math.abs(n.y - py) < NODE_H + 40);
      for (let i = 0; i < 40 && clash(x, y); i++) {
        y += NODE_H + 50;
        if (i % 4 === 3) { y -= 4 * (NODE_H + 50); x += NODE_W + 40; }
      }
    }
    const same = this.design.nodes.filter(n => n.type === type).length;
    const n = { id: newId('n'), type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, cfg: {} };
    if (same) n.label = `${BLOCKS[type].name} ${same + 1}`;
    this.design.nodes.push(n);
    this.select({ kind: 'node', id: n.id });
    this.commit();
    return n;
  }

  connect(from, to) {
    if (from === to || this.design.edges.some(e => (e.from === from && e.to === to))) return;
    if (this.node(to).type === 'user') return;
    // Wiring B→A when A→B exists flips the arrow instead of making a loop.
    this.design.edges = this.design.edges.filter(e => !(e.from === to && e.to === from));
    this.design.edges.push({ id: newId('e'), from, to });
    this.commit();
  }

  updateNode(id, patch) {
    const n = this.node(id);
    if (!n) return;
    if (patch.cfg) n.cfg = Object.assign({}, n.cfg, patch.cfg);
    if ('label' in patch) n.label = patch.label || undefined;
    if ('failed' in patch) n.failed = patch.failed || undefined;
    this.commit();
  }

  deleteSelection() {
    if (!this.sel) return;
    if (this.sel.kind === 'node') {
      const id = this.sel.id;
      this.design.nodes = this.design.nodes.filter(n => n.id !== id);
      this.design.edges = this.design.edges.filter(e => e.from !== id && e.to !== id);
    } else {
      this.design.edges = this.design.edges.filter(e => e.id !== this.sel.id);
    }
    this.select(null);
    this.commit();
  }

  select(sel) {
    this.sel = sel;
    this.render();
    if (this.hooks.onSelect) this.hooks.onSelect(sel);
  }

  setResult(result) {
    this.result = result;
    this.render();
  }

  /* ---------- view ---------- */

  applyView() {
    const { x, y, k } = this.view;
    this.root.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    this.svg.style.backgroundSize = `${22 * k}px ${22 * k}px`;
    this.svg.style.backgroundPosition = `${x}px ${y}px`;
    if (this.hooks.onZoom) this.hooks.onZoom(k);
  }

  zoomBy(f, cx, cy) {
    const r = this.svg.getBoundingClientRect();
    if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
    const k = Math.min(2.5, Math.max(0.25, this.view.k * f));
    this.view.x = cx - (cx - this.view.x) * (k / this.view.k);
    this.view.y = cy - (cy - this.view.y) * (k / this.view.k);
    this.view.k = k;
    this.applyView();
  }

  fit() {
    const r = this.svg.getBoundingClientRect();
    if (!this.design.nodes.length || !r.width) { this.view = { x: 30, y: 30, k: 1 }; this.applyView(); return; }
    const xs = this.design.nodes.map(n => n.x), ys = this.design.nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H + 24;
    const k = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY))));
    this.view = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k };
    this.applyView();
  }

  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k };
  }

  /* ---------- input ---------- */

  onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const port = e.target.closest('[data-port]');
    const nodeEl = e.target.closest('[data-node]');
    const edgeEl = e.target.closest('[data-edge]');
    const p = this.toWorld(e);
    if (port) {
      this.drag = { mode: 'link', from: port.dataset.port };
    } else if (nodeEl) {
      const n = this.node(nodeEl.dataset.node);
      if (!this.sel || this.sel.id !== n.id) this.select({ kind: 'node', id: n.id });
      this.drag = { mode: 'move', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
    } else if (edgeEl) {
      this.select({ kind: 'edge', id: edgeEl.dataset.edge });
      return;
    } else {
      if (this.sel) this.select(null);
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
      this.svg.classList.add('panning');
    }
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const p = this.toWorld(e);
    if (d.mode === 'link') {
      const a = this.node(d.from);
      this.temp.setAttribute('d', edgePath(a.x + NODE_W, a.y + NODE_H / 2, p.x, p.y));
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const target = over && over.closest('[data-node]');
      this.nodeLayer.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      if (target && target.dataset.node !== d.from) target.classList.add('drop-target');
    } else if (d.mode === 'move') {
      const n = this.node(d.id);
      const nx = Math.round((p.x - d.dx) / 10) * 10, ny = Math.round((p.y - d.dy) / 10) * 10;
      if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; d.moved = true; this.render(); }
    } else if (d.mode === 'pan') {
      this.view.x = d.vx + e.clientX - d.sx;
      this.view.y = d.vy + e.clientY - d.sy;
      this.applyView();
    }
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    this.svg.classList.remove('panning');
    if (!d) return;
    if (d.mode === 'link') {
      this.temp.setAttribute('d', '');
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const target = over && over.closest('[data-node]');
      if (target) this.connect(d.from, target.dataset.node);
      else this.render();
    } else if (d.mode === 'move' && d.moved) {
      this.commit();
    }
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.svg.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      this.zoomBy(Math.exp(-e.deltaY * 0.01), cx, cy);
    } else if (e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))) {
      // Mouse wheel notches zoom; trackpad two-finger scrolls pan.
      this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
    } else {
      this.view.x -= e.deltaX;
      this.view.y -= e.deltaY;
      this.applyView();
    }
  }

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSelection(); }
    else if (e.key === 'Escape' && this.sel) this.select(null);
  }

  onDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain');
    if (!BLOCKS[type]) return;
    const p = this.toWorld(e);
    this.addNode(type, p.x - NODE_W / 2, p.y - NODE_H / 2);
  }

  /* ---------- drawing ---------- */

  render() {
    const r = this.result, flows = r ? r.edgeFlow : {};
    this.edgeLayer.textContent = '';
    this.nodeLayer.textContent = '';
    this.dotLayer.textContent = '';
    this.particles = [];
    const maxFlow = Math.max(1, ...Object.values(flows));

    this.design.edges.forEach(e => {
      const a = this.node(e.from), b = this.node(e.to);
      if (!a || !b) return;
      const d = edgePath(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2);
      const flow = flows[e.from + '>' + e.to] || 0;
      const status = flow > 0 ? nodeStatus(r, e.to) : 'idle';
      const g = svgEl('g', { 'data-edge': e.id, class: 'edge' + (this.sel && this.sel.id === e.id ? ' selected' : '') }, this.edgeLayer);
      svgEl('path', { d, class: 'edge-hit' }, g);
      const width = flow > 0 ? 1.5 + 3 * Math.log10(1 + 9 * flow / maxFlow) : 1.5;
      const path = svgEl('path', { d, class: 'edge-line st-' + status, 'stroke-width': width, 'marker-end': `url(#arrow-${status})` }, g);
      if (flow > 0) {
        const len = path.getTotalLength();
        const mid = path.getPointAtLength(len / 2);
        const t = svgEl('text', { x: mid.x, y: mid.y - 7, class: 'edge-label' }, g);
        t.textContent = fmtRps(flow) + '/s';
        const count = Math.max(1, Math.min(7, Math.round(Math.log10(flow + 1) * 1.8)));
        const speed = 50 + 25 * Math.log10(flow + 1);
        for (let i = 0; i < count; i++) {
          const dot = svgEl('circle', { r: 3, class: 'dot st-' + status }, this.dotLayer);
          this.particles.push({ dot, path, len, offset: i / count, speed });
        }
      }
    });

    this.design.nodes.forEach(n => {
      const b = BLOCKS[n.type], cfg = blockCfg(n);
      const status = nodeStatus(r, n.id);
      const isSel = this.sel && this.sel.kind === 'node' && this.sel.id === n.id;
      const g = svgEl('g', { 'data-node': n.id, transform: `translate(${n.x} ${n.y})`, class: `node st-${status}${isSel ? ' selected' : ''}${n.failed ? ' failed' : ''}` }, this.nodeLayer);
      svgEl('rect', { width: NODE_W, height: NODE_H, rx: 12, class: 'node-box' }, g);
      svgEl('rect', { x: 10, y: 13, width: 36, height: 36, rx: 9, class: 'node-icon-bg' }, g);
      svgEl('path', { d: ICONS[n.type], transform: 'translate(16 19)', class: 'node-icon' }, g);
      const title = svgEl('text', { x: 56, y: 27, class: 'node-title' }, g);
      title.textContent = clip(labelOf(n), 15);
      const sub = svgEl('text', { x: 56, y: 45, class: 'node-sub' }, g);
      sub.textContent = nodeSubtitle(n, cfg, r);
      if (n.failed) {
        const tag = svgEl('g', { transform: `translate(${NODE_W - 48} -9)` }, g);
        svgEl('rect', { width: 46, height: 18, rx: 9, class: 'fail-tag' }, tag);
        const ft = svgEl('text', { x: 23, y: 13, class: 'fail-tag-text' }, tag);
        ft.textContent = '1 DOWN';
      }
      if (r && r.st[n.id] && n.type !== 'user') {
        const s = r.st[n.id];
        const total = s.arrival.read + s.arrival.write + s.arrival.search + s.arrival.media;
        const u = isFinite(s.util) ? s.util : 1;
        svgEl('rect', { x: 0, y: NODE_H + 6, width: NODE_W, height: 4, rx: 2, class: 'util-track' }, g);
        svgEl('rect', { x: 0, y: NODE_H + 6, width: NODE_W * Math.min(1, u), height: 4, rx: 2, class: 'util-bar st-' + status }, g);
        const st = svgEl('text', { x: 0, y: NODE_H + 24, class: 'node-stat st-' + status }, g);
        st.textContent = status === 'down' ? 'DOWN: all copies failed'
          : total > 0 ? `${fmtRps(total)} req/s · ${fmtPct(s.util)} busy` : 'no traffic';
      }
      svgEl('circle', { cx: NODE_W, cy: NODE_H / 2, r: 7, class: 'port', 'data-port': n.id }, g);
    });
  }

  animate(t) {
    for (const p of this.particles) {
      const pos = ((t / 1000) * p.speed + p.offset * p.len) % p.len;
      const pt = p.path.getPointAtLength(pos);
      p.dot.setAttribute('cx', pt.x);
      p.dot.setAttribute('cy', pt.y);
    }
  }
}

function edgePath(x1, y1, x2, y2) {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2 - 4} ${y2}`;
}

function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function nodeSubtitle(n, cfg, result) {
  if (n.type === 'user') return result ? `${fmtRps(result.metrics.demand)} req/s` : 'traffic source';
  if (n.type === 'external') return `limit ${fmtRps(cfg.capacity)}/s`;
  const copies = `×${Math.max(1, Math.round(cfg.replicas || 1))}`;
  if (n.type === 'cache' || n.type === 'cdn') return `${copies} · ${Math.round(cfg.hitRate * 100)}% hits`;
  if (n.type === 'ratelimiter') return `${copies} · allow ${fmtRps(cfg.limit)}/s`;
  if (n.type === 'db' && cfg.shards > 1) return `${copies} · ${cfg.shards} shards`;
  return `${copies} · ${fmtRps(cfg.capacity)}/s each`;
}
