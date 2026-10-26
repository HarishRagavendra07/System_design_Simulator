/* Static content: building blocks, practice problems, guided labs and concept notes. */

// 24x24 stroke icons, one per block type.
const ICONS = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  cdn: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18',
  lb: 'M12 3v5M12 8l-7 6M12 8l7 6M12 8v6M3 14h4v6H3zM10 14h4v6h-4zM17 14h4v6h-4z',
  gateway: 'M4 4h16v16H4zM4 9h16M9 9v11',
  ratelimiter: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12h7',
  proxy: 'M3 8h15l-3-3M21 16H6l3 3',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  service: 'M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z',
  websocket: 'M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4',
  worker: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  queue: 'M3 8h4v8H3zM10 8h4v8h-4zM17 8h4v8h-4z',
  cache: 'M13 2L4 14h7l-1 8 9-12h-7z',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  blob: 'M3 5h18v14H3zM3 15l5-5 5 5 3-3 5 5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
};

/* role decides how a block routes traffic in the simulator:
 *   source  - emits the scenario's traffic
 *   router  - splits traffic evenly across its healthy children
 *   compute - handles a request, calls the next tier and its data stores
 *   cache   - answers hits itself, passes misses on
 *   queue   - buffers work and hands it to consumers asynchronously
 *   store   - end of the line (database, index, files, external API) */
const BLOCKS = {
  user: { name: 'Users', group: 'Entry & edge', role: 'source', desc: 'Where traffic comes from. Its volume and mix are set by the scenario.' },
  cdn: { name: 'CDN', group: 'Entry & edge', role: 'router', cost: 50,
    desc: 'Edge servers near users. Answers cacheable reads and media itself and forwards the rest.',
    defaults: { replicas: 1, capacity: 100000, latency: 5, hitRate: 0.8 } },
  ratelimiter: { name: 'Rate Limiter', group: 'Entry & edge', role: 'router', cost: 15,
    desc: 'Lets through at most the allowed requests per second and rejects the rest (HTTP 429).',
    defaults: { replicas: 1, capacity: 100000, latency: 1, limit: 10000 } },
  lb: { name: 'Load Balancer', group: 'Entry & edge', role: 'router', cost: 20,
    desc: 'Spreads requests evenly across the healthy blocks behind it and skips dead ones.',
    defaults: { replicas: 1, capacity: 50000, latency: 1 } },
  gateway: { name: 'API Gateway', group: 'Entry & edge', role: 'router', cost: 30,
    desc: 'Single front door: auth, routing and request shaping in front of your services.',
    defaults: { replicas: 1, capacity: 20000, latency: 3 } },
  proxy: { name: 'Reverse Proxy', group: 'Entry & edge', role: 'router', cost: 15,
    desc: 'Terminates TLS, compresses and forwards requests to the servers behind it.',
    defaults: { replicas: 1, capacity: 30000, latency: 2 } },
  server: { name: 'App Server', group: 'Compute', role: 'compute', cost: 50,
    desc: 'Runs your application code. Calls the next tier and the data stores it is wired to.',
    defaults: { replicas: 1, capacity: 1000, latency: 20 } },
  service: { name: 'Service', group: 'Compute', role: 'compute', cost: 50,
    desc: 'One business capability (search, orders, payments) that can scale on its own.',
    defaults: { replicas: 1, capacity: 1500, latency: 15 } },
  websocket: { name: 'WebSocket Server', group: 'Compute', role: 'compute', cost: 60,
    desc: 'Keeps long-lived two-way connections open for real-time pushes like chat and location.',
    defaults: { replicas: 1, capacity: 5000, latency: 5 } },
  queue: { name: 'Message Queue', group: 'Async', role: 'queue', cost: 40,
    desc: 'Accepts writes instantly and hands them to Workers at the pace they can handle.',
    defaults: { replicas: 1, capacity: 50000, latency: 3 } },
  worker: { name: 'Worker', group: 'Async', role: 'compute', cost: 40,
    desc: 'Pulls jobs from a queue and does the slow work (saving, sending, processing).',
    defaults: { replicas: 1, capacity: 1000, latency: 40 } },
  cache: { name: 'Cache', group: 'Data', role: 'cache', cost: 60,
    desc: 'In-memory key/value store (like Redis). Hits return in ~1 ms; misses fall through to the store behind it.',
    defaults: { replicas: 1, capacity: 50000, latency: 1, hitRate: 0.85 } },
  db: { name: 'Database', group: 'Data', role: 'store', cost: 150,
    desc: 'Source of truth. Copies = 1 primary + read replicas (reads spread out, writes hit every copy). Shards split all load.',
    defaults: { replicas: 1, shards: 1, capacity: 2000, latency: 8 } },
  search: { name: 'Search Index', group: 'Data', role: 'store', cost: 120,
    desc: 'Inverted index (like Elasticsearch) built for full-text and filtered search.',
    defaults: { replicas: 1, capacity: 3000, latency: 15 } },
  blob: { name: 'Blob Storage', group: 'Data', role: 'store', cost: 30,
    desc: 'Object storage (like S3) for images, video and backups. Cheap and huge, but slow per request.',
    defaults: { replicas: 1, capacity: 10000, latency: 40 } },
  external: { name: 'Third-party API', group: 'External', role: 'store', cost: 0, fixed: true,
    desc: 'A provider you call (payments, maps, SMS). You cannot scale it: its capacity is their rate limit.',
    defaults: { capacity: 5000, latency: 150, callShare: 1 } },
};

const BLOCK_GROUPS = ['Entry & edge', 'Compute', 'Async', 'Data', 'External'];

const FIELDS = {
  replicas: { label: 'Copies', min: 1, max: 100, step: 1, help: 'Identical instances. More copies = more capacity and survives one failing.' },
  shards: { label: 'Shards', min: 1, max: 64, step: 1, help: 'Splits the data (and all load) across independent partitions.' },
  capacity: { label: 'Capacity per copy (req/s)', min: 10, max: 10000000, step: 10, help: 'Requests per second one copy can handle before it saturates.' },
  latency: { label: 'Work per request (ms)', min: 0.1, max: 10000, step: 1, help: 'Time to serve one request when idle. Grows sharply as the block gets busy.' },
  hitRate: { label: 'Hit rate', min: 0, max: 0.99, step: 0.01, pct: true, help: 'Share of cacheable requests answered without going further.' },
  limit: { label: 'Allowed req/s', min: 1, max: 10000000, step: 100, help: 'Requests above this rate are rejected.' },
  callShare: { label: 'Writes that call it', min: 0, max: 1, step: 0.05, pct: true, help: 'Share of write requests that need this provider (for example, paying).' },
};

const FIELD_LABELS = { db: { replicas: 'Copies (1 primary + replicas)' }, external: { capacity: 'Provider rate limit (req/s)' } };

const KIND_LABELS = { read: 'Reads', write: 'Writes', search: 'Searches', media: 'Media / files' };

/* Requirement checks a problem can ask for. Each is evaluated on the normal-load run. */
const CHECK_INFO = {
  writesPersist: { label: 'Writes are saved in a database', fix: 'Connect your servers (or the workers behind a queue) to a Database so writes are stored.' },
  searchIndex: { label: 'Searches use a search index, not the database', fix: 'Add a Search Index next to the Database. Full-text search on a database is a slow table scan.' },
  syncWrites: { label: 'Writes go straight to the database (strong consistency)', fix: 'Do not put these writes behind a queue. Lending a book or taking a payment must be confirmed in the database before you answer.' },
  asyncWrites: { label: 'Write bursts are buffered through a queue', fix: 'Send writes to a Message Queue and let Workers save them, so spikes do not hit the database head-on.' },
  usesCDN: { label: 'A CDN serves content at the edge', fix: 'Put a CDN between Users and your load balancer.' },
  blobMedia: { label: 'Media lives in blob storage', fix: 'Add Blob Storage for images and video instead of storing files in the database.' },
  websocket: { label: 'Real-time traffic uses WebSocket servers', fix: 'Route traffic through WebSocket Servers so messages can be pushed instead of polled.' },
  rateLimiter: { label: 'A rate limiter protects the backend', fix: 'Place a Rate Limiter right after Users and set its allowed rate to what your backend can handle.' },
  external: { label: 'Payments go through the third-party provider', fix: 'Connect your checkout servers to the Third-party API so writes (orders) get paid for.' },
};

const PROBLEMS = [
  {
    id: 'url_shortener', title: 'URL Shortener', difficulty: 'Easy', tags: ['caching', 'read-heavy', 'CDN'],
    summary: 'Turn long links into short codes and redirect millions of clicks fast.',
    description: 'Design a service like bit.ly. People create short links (writes) and, far more often, open them (reads that must redirect instantly).',
    rps: 5000, mix: { read: 0.9, write: 0.1 }, slo: 100,
    constraints: ['Peak 5,000 requests/s', '90% redirects (reads), 10% new links (writes)', 'Mean response under 100 ms', 'Keep working if any one component fails'],
    tests: [
      { name: 'Normal load' },
      { name: 'Viral link (3× redirects)', kindMult: { read: 3 } },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['writesPersist'],
    hints: ['Redirects for the same code never change, so they are perfect for a cache.', 'A CDN can answer redirects before they reach your servers at all.', 'Every block that has only 1 copy is a single point of failure.'],
  },
  {
    id: 'library_management', title: 'Library Management System', difficulty: 'Easy', tags: ['search', 'consistency'],
    summary: 'Catalog search, borrowing, returns and holds for a large library.',
    description: 'Design a library system for 1,500 concurrent users: catalog search over 2 million books, borrowing and returns, holds, and overdue fines. Two people must never borrow the same copy.',
    rps: 1500, mix: { read: 0.45, search: 0.4, write: 0.15 }, slo: 200,
    constraints: ['Peak 1,500 requests/s', '45% reads, 40% catalog searches, 15% borrow/return writes', 'Search and responses under 200 ms on average', 'No double-booking: writes must be strongly consistent', '99.9% availability'],
    tests: [
      { name: 'Normal load' },
      { name: 'Semester start (3× searches)', kindMult: { search: 3 } },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['writesPersist', 'searchIndex', 'syncWrites'],
    hints: ['Searching titles in a database is a full scan. What block is built for search?', 'Borrowing must be confirmed in the database right away, so do not queue it.', 'Size your servers for the search spike, not just normal load.'],
  },
  {
    id: 'news_feed', title: 'Social News Feed', difficulty: 'Medium', tags: ['CDN', 'blob storage', 'caching'],
    summary: 'Home timelines with photos for a fast-growing social app.',
    description: 'Design the feed for a social app. Users scroll their timeline (reads), load photos (media) and publish posts (writes).',
    rps: 20000, mix: { read: 0.8, write: 0.1, media: 0.1 }, slo: 150,
    constraints: ['Peak 20,000 requests/s', '80% feed reads, 10% photo loads, 10% new posts', 'Mean response under 150 ms', 'Photos must not live in the database'],
    tests: [
      { name: 'Normal load' },
      { name: 'Breaking news (3× everything)', mult: 3 },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['writesPersist', 'blobMedia', 'usesCDN'],
    hints: ['Feed pages and photos are the same for many viewers: cache them at the edge.', 'Blob storage is cheap but slow, so put the CDN in front of it.', 'Under 3× load, find which block saturates first and scale only that one.'],
  },
  {
    id: 'chat_app', title: 'Chat Application', difficulty: 'Medium', tags: ['real-time', 'sharding'],
    summary: 'One-to-one and group messaging with instant delivery.',
    description: 'Design a chat app like WhatsApp. Messages are pushed in real time, history is loaded on open, and the write rate is high.',
    rps: 10000, mix: { read: 0.45, write: 0.55 }, slo: 100,
    constraints: ['Peak 10,000 requests/s', '55% sent messages (writes), 45% history loads', 'Mean delivery under 100 ms', 'Messages must be pushed, not polled'],
    tests: [
      { name: 'Normal load' },
      { name: 'New Year\'s Eve (3× messages)', kindMult: { write: 3 } },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['websocket', 'writesPersist'],
    hints: ['Read replicas do not help writes: every copy applies every write.', 'Shards split writes across independent databases.', 'A queue lets you accept a burst of messages and save them at a steady rate.'],
  },
  {
    id: 'video_streaming', title: 'Video Streaming', difficulty: 'Medium', tags: ['CDN', 'blob storage'],
    summary: 'Stream video segments to viewers around the world.',
    description: 'Design a video platform. Most traffic is video segments (media), plus browsing and a small number of uploads and likes.',
    rps: 30000, mix: { read: 0.25, media: 0.7, write: 0.05 }, slo: 250,
    constraints: ['Peak 30,000 requests/s', '70% video segments, 25% browsing, 5% writes', 'Mean response under 250 ms', 'Survive a premiere with 5× video traffic'],
    tests: [
      { name: 'Normal load' },
      { name: 'Season premiere (5× video)', kindMult: { media: 5 } },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['usesCDN', 'blobMedia', 'writesPersist'],
    hints: ['Video must come from the edge: the CDN should absorb most of it.', 'Even a CDN has limits: check its utilization during the premiere.', 'CDN misses land on blob storage, so give it enough copies too.'],
  },
  {
    id: 'public_api', title: 'Public API with Rate Limits', difficulty: 'Medium', tags: ['rate limiting', 'protection'],
    summary: 'Keep a public API alive when one client floods it.',
    description: 'Design the front of a public developer API. Normal traffic is modest, but a single misbehaving client can send 10× the usual load. Real users must keep getting fast answers and the backend must never fall over.',
    rps: 5000, mix: { read: 0.7, write: 0.3 }, slo: 150,
    constraints: ['Normal 5,000 requests/s', 'Flood of 10× traffic from one client', 'Backend must never be overloaded, even during the flood', 'Mean response under 150 ms'],
    tests: [
      { name: 'Normal load' },
      { name: 'Abusive client flood (10×)', mult: 10, noOverload: true, minSuccess: 0.1 },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['rateLimiter', 'writesPersist'],
    hints: ['You cannot scale your way out of a 10× flood cheaply. Reject the excess at the door.', 'Set the limiter a little above normal traffic so real users are never throttled.', 'The rate limiter itself needs a second copy.'],
  },
  {
    id: 'ride_sharing', title: 'Ride Sharing', difficulty: 'Hard', tags: ['write-heavy', 'queues', 'sharding'],
    summary: 'Drivers stream their location every few seconds; riders watch them move.',
    description: 'Design the location backend of a ride-sharing app. Drivers send GPS pings constantly (writes), riders read nearby drivers and trip status.',
    rps: 15000, mix: { read: 0.35, write: 0.65 }, slo: 150,
    constraints: ['Peak 15,000 requests/s', '65% location pings (writes), 35% reads', 'Mean response under 150 ms', 'Pings may be saved a moment later (eventual consistency is fine)', 'Survive rush hour at 2×'],
    tests: [
      { name: 'Normal load' },
      { name: 'Rush hour (2×)', mult: 2 },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['asyncWrites', 'writesPersist'],
    hints: ['Accept pings into a queue and answer immediately; Workers save them later.', 'Workers drain at their total capacity. If the queue grows forever, add Workers.', 'The database still takes every ping, so shard it.'],
  },
  {
    id: 'ecommerce_checkout', title: 'E-commerce Flash Sale', difficulty: 'Hard', tags: ['search', 'payments', 'consistency'],
    summary: 'Product search and checkout that survive a 5× flash sale.',
    description: 'Design an online store: product pages, search, and checkout that charges cards through a payment provider. During a flash sale traffic jumps 5×. Orders must never be lost or double-charged.',
    rps: 4000, mix: { read: 0.6, search: 0.25, write: 0.15 }, slo: 300,
    constraints: ['Normal 4,000 requests/s, 5× during the sale', '60% product views, 25% searches, 15% checkouts', 'Each checkout calls the payment provider (rate limit 5,000 req/s)', 'Orders written synchronously', 'Mean response under 300 ms'],
    tests: [
      { name: 'Normal load' },
      { name: 'Flash sale (5×)', mult: 5 },
      { name: 'Component failure', fail: 'worst' },
    ],
    checks: ['searchIndex', 'syncWrites', 'external', 'writesPersist'],
    hints: ['Product pages are read far more than they change: cache them.', 'Search belongs in a search index.', 'Checkout writes must go to the database synchronously, and every one calls the payment API.'],
  },
];

// Short guided exercises, each starting from a broken design.
const LABS = [
  {
    id: 'lab_scale_out', lab: true, title: 'Lab: Scale out', difficulty: 'Lab', tags: ['horizontal scaling', 'load balancing'],
    summary: 'One server is drowning. Add copies and a load balancer.',
    description: 'A single app server cannot keep up with 3,000 requests/s. Scale it horizontally: run several copies behind a Load Balancer so the work is shared and one crash does not take you down.',
    rps: 3000, mix: { read: 0.9, write: 0.1 }, slo: 150,
    constraints: ['3,000 requests/s', 'Mean response under 150 ms', 'Survive one component failing'],
    tests: [{ name: 'Normal load' }, { name: 'Component failure', fail: 'worst' }],
    checks: [],
    hints: ['Select the server and raise its Copies.', 'Put a Load Balancer between Users and the server, and give the balancer 2 copies.', 'Keep each server below ~70% busy, or latency explodes.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 60, y: 200 },
        { id: 's', type: 'server', x: 320, y: 200 },
        { id: 'd', type: 'db', x: 580, y: 200, cfg: { replicas: 2, capacity: 10000 }, label: 'Managed Database' },
      ],
      edges: [{ id: 'e1', from: 'u', to: 's' }, { id: 'e2', from: 's', to: 'd' }],
    },
  },
  {
    id: 'lab_cache', lab: true, title: 'Lab: Cache it', difficulty: 'Lab', tags: ['caching'],
    summary: 'The database is saturated by repeated reads. Put a cache in front.',
    description: '95% of requests read data that rarely changes, and every one of them hits the database. Add a Cache next to the database so most reads never reach it.',
    rps: 8000, mix: { read: 0.95, write: 0.05 }, slo: 100,
    constraints: ['8,000 requests/s, 95% reads', 'Mean response under 100 ms'],
    tests: [{ name: 'Normal load' }],
    checks: ['writesPersist'],
    hints: ['Drag a Cache onto the canvas and connect the App Server to it.', 'The server checks the cache first; only misses go to the database.', 'Try changing the hit rate and watch the database load move.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 40, y: 200 },
        { id: 'l', type: 'lb', x: 260, y: 200, cfg: { replicas: 2 } },
        { id: 's', type: 'server', x: 480, y: 200, cfg: { replicas: 12 } },
        { id: 'd', type: 'db', x: 720, y: 280, cfg: { replicas: 2 } },
      ],
      edges: [{ id: 'e1', from: 'u', to: 'l' }, { id: 'e2', from: 'l', to: 's' }, { id: 'e3', from: 's', to: 'd' }],
    },
  },
  {
    id: 'lab_spof', lab: true, title: 'Lab: Kill the single point of failure', difficulty: 'Lab', tags: ['redundancy', 'replication'],
    summary: 'Everything works until one box dies. Find it and fix it.',
    description: 'This design handles normal traffic fine, but the failure test kills one instance of each block in turn. Any block with only one copy takes the whole system down with it.',
    rps: 1000, mix: { read: 0.8, write: 0.2 }, slo: 150,
    constraints: ['1,000 requests/s', 'Any single component may fail', 'Mean response under 150 ms'],
    tests: [{ name: 'Normal load' }, { name: 'Component failure', fail: 'worst' }],
    checks: ['writesPersist'],
    hints: ['Press Run, then look for “Single point of failure” in the Results tab.', 'Select a block and tick “Simulate a failure” to see it yourself.', 'A database with 2 copies fails over to its replica.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 40, y: 200 },
        { id: 'l', type: 'lb', x: 260, y: 200 },
        { id: 's', type: 'server', x: 480, y: 200, cfg: { replicas: 3 } },
        { id: 'd', type: 'db', x: 720, y: 200 },
      ],
      edges: [{ id: 'e1', from: 'u', to: 'l' }, { id: 'e2', from: 'l', to: 's' }, { id: 'e3', from: 's', to: 'd' }],
    },
  },
  {
    id: 'lab_queue', lab: true, title: 'Lab: Absorb a write storm', difficulty: 'Lab', tags: ['queues', 'sharding'],
    summary: '80% writes are crushing the database. Queue them and shard.',
    description: 'Writes arrive faster than one database can store them. Buffer them in a Message Queue, drain it with Workers, and split the database into shards so the writes are shared.',
    rps: 6000, mix: { read: 0.2, write: 0.8 }, slo: 150,
    constraints: ['6,000 requests/s, 80% writes', 'Writes may be saved a moment later', 'Queue must not grow forever', 'Mean response under 150 ms'],
    tests: [{ name: 'Normal load' }],
    checks: ['asyncWrites', 'writesPersist'],
    hints: ['Connect App Server → Message Queue → Worker → Database.', 'Total Worker capacity must be at least the write rate, or the backlog grows.', 'Read replicas do not help writes. Shards do.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 40, y: 200 },
        { id: 'l', type: 'lb', x: 260, y: 200, cfg: { replicas: 2 } },
        { id: 's', type: 'server', x: 480, y: 200, cfg: { replicas: 9 } },
        { id: 'd', type: 'db', x: 760, y: 200 },
      ],
      edges: [{ id: 'e1', from: 'u', to: 'l' }, { id: 'e2', from: 'l', to: 's' }, { id: 'e3', from: 's', to: 'd' }],
    },
  },
  {
    id: 'lab_search', lab: true, title: 'Lab: Stop scanning the database', difficulty: 'Lab', tags: ['search'],
    summary: 'Full-text search is melting the database. Add a search index.',
    description: 'Most traffic is search. A database answers a “title contains …” query by scanning rows, which costs about 5× the capacity and 10× the time of a normal read. Add a Search Index built for it.',
    rps: 2000, mix: { search: 0.7, read: 0.3 }, slo: 150,
    constraints: ['2,000 requests/s, 70% searches', 'Mean response under 150 ms'],
    tests: [{ name: 'Normal load' }],
    checks: ['searchIndex'],
    hints: ['Connect the App Server to a Search Index. Searches go there automatically.', 'Plain reads still go to the database.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 40, y: 200 },
        { id: 'l', type: 'lb', x: 260, y: 200, cfg: { replicas: 2 } },
        { id: 's', type: 'server', x: 480, y: 200, cfg: { replicas: 4 } },
        { id: 'd', type: 'db', x: 740, y: 200, cfg: { replicas: 2 } },
      ],
      edges: [{ id: 'e1', from: 'u', to: 'l' }, { id: 'e2', from: 'l', to: 's' }, { id: 'e3', from: 's', to: 'd' }],
    },
  },
  {
    id: 'lab_rate_limit', lab: true, title: 'Lab: Survive a flood', difficulty: 'Lab', tags: ['rate limiting'],
    summary: 'A client sends 10× traffic. Reject the excess before it hurts.',
    description: 'Your backend is sized for about 2,000 requests/s. When a client floods you with 10×, everything collapses. Put a Rate Limiter in front so the backend only ever sees what it can handle.',
    rps: 2000, mix: { read: 0.8, write: 0.2 }, slo: 200,
    constraints: ['2,000 requests/s normally', '10× flood must not overload the backend'],
    tests: [{ name: 'Normal load' }, { name: 'Flood (10×)', mult: 10, noOverload: true, minSuccess: 0.1 }],
    checks: ['rateLimiter'],
    hints: ['Insert a Rate Limiter between Users and the Load Balancer.', 'Set Allowed req/s slightly above normal traffic, like 2,500.'],
    starter: {
      nodes: [
        { id: 'u', type: 'user', x: 40, y: 200 },
        { id: 'l', type: 'lb', x: 300, y: 200, cfg: { replicas: 2 } },
        { id: 's', type: 'server', x: 520, y: 200, cfg: { replicas: 4 } },
        { id: 'd', type: 'db', x: 760, y: 200, cfg: { replicas: 2 } },
      ],
      edges: [{ id: 'e1', from: 'u', to: 'l' }, { id: 'e2', from: 'l', to: 's' }, { id: 'e3', from: 's', to: 'd' }],
    },
  },
];

const SANDBOX = {
  id: 'sandbox', sandbox: true, title: 'Sandbox', difficulty: 'Free play',
  description: 'Build anything. Set your own traffic and target, then press Run and watch what breaks.',
  rps: 2000, mix: { read: 0.7, write: 0.2, search: 0.1, media: 0 }, slo: 200, tests: [], checks: [], hints: [],
};

const PHASES = ['Foundations', 'Scaling out', 'Data', 'Async & real-time', 'Resilience'];

const CONCEPTS = [
  {
    id: 'estimation', phase: 'Foundations', title: 'Back-of-the-envelope estimation',
    summary: 'Turn users into requests per second before you draw anything.',
    points: ['Daily active users × actions per user ÷ 86,400 s ≈ average req/s. Peak is often 2–5× the average.', 'Split traffic into reads and writes. Most products are read-heavy (10:1 or more).', 'Storage = items per day × size × retention. Bandwidth = req/s × response size.', 'Use rough powers of ten. Being within 2× is good enough to choose an architecture.'],
    tradeoffs: ['Designing for 100× growth up front wastes money; designing for today breaks next month. Aim for ~10×.'],
    numbers: ['1 day ≈ 86,400 s ≈ 10⁵ s', 'Memory read ~100 ns, SSD read ~100 µs, same-region network round trip ~0.5 ms, cross-continent ~100 ms', '1M users × 10 requests/day ≈ 115 req/s average'],
    practice: 'sandbox',
  },
  {
    id: 'latency', phase: 'Foundations', title: 'Latency, throughput and utilization',
    summary: 'Why a server at 90% busy is ten times slower than an idle one.',
    points: ['Throughput is how many requests per second you handle. Latency is how long each one takes.', 'Queueing theory: response time ≈ service time ÷ (1 − utilization). At 50% busy a request takes 2×, at 90% it takes 10×.', 'Tail latency (p99) grows even faster than the mean. Users feel the tail.', 'Keep hot paths below ~70% utilization so spikes have headroom.'],
    tradeoffs: ['Running hot saves money but turns every small spike into an outage.', 'Batching raises throughput but adds latency to each item.'],
    numbers: ['This simulator uses: latency = work ÷ (1 − utilization), with a large penalty once a block is over 100%.'],
    practice: 'lab_scale_out',
  },
  {
    id: 'horizontal-scaling', phase: 'Scaling out', title: 'Vertical vs horizontal scaling',
    summary: 'Bigger machine, or more machines?',
    points: ['Vertical scaling: buy a bigger box. Simple, but it has a ceiling and is still one box.', 'Horizontal scaling: run many identical copies behind a load balancer. Nearly unlimited, and survives a copy dying.', 'Horizontal scaling needs stateless servers: keep sessions and data in shared stores (cache, database).', 'In the simulator, “Copies” is horizontal scaling and “Capacity per copy” is vertical.'],
    tradeoffs: ['More copies = more cost and more moving parts to deploy and monitor.', 'Stateful systems (databases) are much harder to scale horizontally than app servers.'],
    practice: 'lab_scale_out',
  },
  {
    id: 'load-balancing', phase: 'Scaling out', title: 'Load balancing',
    summary: 'Spread requests over many servers and route around the dead ones.',
    points: ['Algorithms: round robin, least connections, consistent hashing (sticky keys).', 'Health checks remove failed servers from rotation automatically.', 'Layer 4 balancers route TCP connections; Layer 7 can route by URL, header or cookie.', 'The balancer itself must be redundant (active-passive pair or managed service).'],
    tradeoffs: ['Sticky sessions keep caches warm but make load uneven and failover painful.'],
    practice: 'lab_spof',
  },
  {
    id: 'caching', phase: 'Scaling out', title: 'Caching',
    summary: 'Answer repeated questions from memory instead of the database.',
    points: ['Cache-aside: app reads cache; on a miss reads the DB and fills the cache. Most common.', 'Read-through / write-through: the cache sits in the path and talks to the DB itself.', 'A 90% hit rate means the database sees only 10% of reads.', 'Eviction (LRU/LFU) and TTLs decide what stays. Invalidation on writes keeps data fresh.'],
    tradeoffs: ['Stale data: caches can serve old values until invalidated or expired.', 'If the cache dies, every request hits the database at once (a stampede). Plan capacity for it or use replicas.'],
    numbers: ['Redis: ~100k+ ops/s per node, sub-millisecond latency'],
    practice: 'lab_cache',
  },
  {
    id: 'cdn', phase: 'Scaling out', title: 'Content delivery networks',
    summary: 'Serve static files and media from servers near the user.',
    points: ['A CDN caches responses at hundreds of edge locations worldwide.', 'Great for images, video, JS/CSS and any response that is the same for many users.', 'Cuts latency (shorter distance) and offloads your origin servers.', 'Cache-Control headers and TTLs decide what the edge may keep.'],
    tradeoffs: ['Purging changed content takes time to reach every edge.', 'Personalised, per-user responses usually cannot be cached at the edge.'],
    practice: 'video_streaming',
  },
  {
    id: 'replication', phase: 'Data', title: 'Database replication',
    summary: 'Copies of the data for read scaling and failover.',
    points: ['Leader–follower: one primary takes writes and streams them to read replicas.', 'Replicas spread reads and stand by to take over if the primary dies.', 'Every replica still applies every write, so replication does not scale writes.', 'Asynchronous replication means replicas can lag behind: reads may be stale.'],
    tradeoffs: ['Synchronous replication: no data loss, slower writes. Asynchronous: fast, but may lose the last writes on failover.'],
    practice: 'lab_spof',
  },
  {
    id: 'sharding', phase: 'Data', title: 'Sharding (partitioning)',
    summary: 'Split the data so each database holds and serves only part of it.',
    points: ['Pick a shard key (user id, chat id, region) and route each row to one shard.', 'Each shard takes only its share of reads and writes, so writes finally scale.', 'Hash-based sharding spreads load evenly; range-based keeps related keys together.', 'Consistent hashing lets you add shards without moving most of the data.'],
    tradeoffs: ['Queries across shards (joins, global counts) become hard and slow.', 'A bad key creates hot shards (one celebrity user on one shard).'],
    practice: 'lab_queue',
  },
  {
    id: 'search', phase: 'Data', title: 'Search indexes',
    summary: 'Why “WHERE title LIKE %…%” does not scale, and what to use instead.',
    points: ['An inverted index maps each word to the documents containing it, so search does not scan every row.', 'Supports ranking, typo tolerance, filters and facets.', 'Usually fed from the database asynchronously (change data capture or a queue).', 'The database stays the source of truth; the index is a fast, rebuildable view.'],
    tradeoffs: ['The index lags slightly behind the database (seconds).', 'Another system to run and keep in sync.'],
    practice: 'lab_search',
  },
  {
    id: 'blob-storage', phase: 'Data', title: 'Blob / object storage',
    summary: 'Where images, video and backups belong.',
    points: ['Object stores (like S3) hold huge files cheaply with very high durability.', 'Store the file in the blob store and only its URL and metadata in the database.', 'Per-request latency is high, so put a CDN in front for anything users download.', 'Uploads can go straight from the client to the store with signed URLs.'],
    tradeoffs: ['Cheap storage, but no queries: you can only fetch by key.'],
    practice: 'video_streaming',
  },
  {
    id: 'consistency', phase: 'Data', title: 'Consistency and the CAP theorem',
    summary: 'When must everyone see the same data at the same moment?',
    points: ['During a network partition a distributed system must choose: Consistency or Availability.', 'Strong consistency: every read sees the latest write (bank balances, inventory, bookings).', 'Eventual consistency: replicas converge later (likes, feeds, location pings).', 'Use transactions or row locks where double-booking or double-charging must be impossible.'],
    tradeoffs: ['Strong consistency costs latency and availability. Eventual consistency is fast but can show stale or conflicting data.'],
    practice: 'library_management',
  },
  {
    id: 'queues', phase: 'Async & real-time', title: 'Message queues',
    summary: 'Accept work now, do it later at a steady pace.',
    points: ['Producers put messages on a queue and return immediately; consumers (workers) process them.', 'Absorbs bursts: a spike becomes a longer queue instead of an outage.', 'Decouples services: a slow consumer does not slow down the producer.', 'If consumers are slower than producers for long, the backlog grows without bound.'],
    tradeoffs: ['The user gets “accepted”, not “done”: the result is eventually consistent.', 'You must handle retries, duplicates (idempotency) and poison messages.'],
    numbers: ['Kafka: millions of messages/s per cluster. SQS / RabbitMQ: thousands to tens of thousands per queue.'],
    practice: 'lab_queue',
  },
  {
    id: 'realtime', phase: 'Async & real-time', title: 'Real-time: polling vs WebSockets',
    summary: 'How chat, live location and notifications reach users instantly.',
    points: ['Short polling: client asks “anything new?” every few seconds. Simple, wasteful.', 'Long polling: the server holds the request until there is news.', 'WebSockets: one persistent two-way connection; the server pushes instantly.', 'Connection servers need a pub/sub layer so a message reaches whichever server holds the recipient.'],
    tradeoffs: ['Persistent connections use memory per user and complicate load balancing and deploys.'],
    practice: 'chat_app',
  },
  {
    id: 'rate-limiting', phase: 'Resilience', title: 'Rate limiting',
    summary: 'Protect your system from floods, abuse and runaway clients.',
    points: ['Token bucket: tokens refill at a fixed rate; each request spends one. Allows short bursts.', 'Sliding window counts requests in the last N seconds per client or API key.', 'Reject with HTTP 429 and a Retry-After header.', 'Limit at the edge, before expensive work happens.'],
    tradeoffs: ['Too strict blocks real users; too loose lets a flood through.'],
    practice: 'lab_rate_limit',
  },
  {
    id: 'spof', phase: 'Resilience', title: 'Single points of failure and redundancy',
    summary: 'If one box dies, does everything die?',
    points: ['A single point of failure (SPOF) is any component with no backup.', 'Run at least two copies of everything on the critical path, across availability zones.', 'Plan N+1 capacity: after losing one copy, the rest must still carry peak load.', 'Test it: kill components on purpose (chaos engineering).'],
    tradeoffs: ['Redundancy roughly doubles cost for the components you duplicate.'],
    numbers: ['99.9% = 8.8 hours of downtime a year. 99.99% = 53 minutes.'],
    practice: 'lab_spof',
  },
];

const ALL_PROBLEMS = [...PROBLEMS, ...LABS];

function findProblem(id) {
  if (id === 'sandbox') return SANDBOX;
  return ALL_PROBLEMS.find(p => p.id === id) || null;
}
