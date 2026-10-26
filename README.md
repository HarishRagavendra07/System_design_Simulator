# SysSim: System Design Simulator

Learn system design by building architectures and pushing simulated traffic through them.
Draw a design, press **Run**, watch which block saturates or fails, fix it, then **Submit** for a score.

## Run it

Double-click `index.html`. No install, no server, no build step.

(Optional) serve it locally instead:

```bash
python3 -m http.server 8766
```

then open http://127.0.0.1:8766.

## What's inside

- **Practice**: 6 guided labs (each starts from a broken design) and 8 interview problems
  (URL shortener, library system, news feed, chat, video streaming, public API, ride sharing, flash-sale checkout).
  Each problem has constraints, three test scenarios (normal load, a spike, a component failure) and requirement checks.
- **Learn**: 15 concept notes in roadmap order, each linked to a lab or problem.
- **Sandbox**: set your own traffic volume, mix and latency target.

Progress and designs are saved in your browser (localStorage). Use **Export / Import** on the canvas to keep designs as JSON files.

## Files

| File | What it does |
| --- | --- |
| `js/data.js` | Building blocks, problems, labs and concept text. Add new problems here. |
| `js/sim.js` | Simulation engine: routing, capacity, latency, failures, diagnosis and scoring. |
| `js/canvas.js` | SVG editor: drag, connect, pan/zoom, undo, traffic animation. |
| `js/app.js` | Pages, routing and the workbench UI. |
| `css/style.css` | Styles. |

## How the model works

- Traffic has four kinds: reads, writes, searches, media.
- Routers (load balancer, gateway, proxy, rate limiter, CDN) split traffic evenly across healthy blocks behind them.
- Servers call the next tier plus their data stores: reads hit the cache first (misses go to the database), searches go to a search index,
  media to blob storage, writes to a queue if present, otherwise the database.
- Capacity = copies × capacity per copy; anything above it is dropped. Database copies share reads, but every copy applies every write; shards split everything.
- Latency per block = work ÷ (1 − utilization), summed along the path.
- The failure test kills one copy of each block in turn and grades the worst case.
