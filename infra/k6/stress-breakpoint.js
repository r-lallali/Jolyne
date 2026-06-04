// Stress test "point de rupture" pour le gateway Jolyne.
//
// Monte en paliers 2000 -> 4000 -> 6000 -> 8000 VU. Chaque VU garde UNE
// seule WebSocket ouverte pour toute la durée du test (CONV_SECONDS très
// long) : la concurrence = le nombre de VU du palier, sans churn de
// reconnexion (donc pas d'épuisement de ports éphémères côté client).
//
// On cherche le premier signe de dégradation côté serveur :
//   - handshake_ok < 100%        -> upgrades WS refusés (accept queue / FD / Traefik)
//   - conv_queue_timeout > 0      -> le matcher décroche
//   - ws_connecting p95 qui grimpe -> TLS/accept saturé
//   - msg_rtt p95 qui grimpe       -> relais Redis / CPU saturé
//   - rest_latency qui grimpe      -> CPU gateway saturé
//
// Usage :
//   ulimit -n 200000
//   k6 run --out json=infra/k6/stress-timeseries.json \
//          -e BASE=wss://api.jolyne.ralys.ovh infra/k6/stress-breakpoint.js

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE || "wss://api.jolyne.ralys.ovh";
const BASE_HTTP =
  __ENV.BASE_HTTP || BASE.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
const CONV_SECONDS = parseInt(__ENV.CONV_SECONDS || "600", 10); // > durée totale
const MSG_INTERVAL_MS = parseInt(__ENV.MSG_INTERVAL_MS || "5000", 10);

const handshakeOk = new Rate("handshake_ok");
const connected = new Counter("conv_connected");
const matched = new Counter("conv_matched");
const queueTimeouts = new Counter("conv_queue_timeout");
const peerLeft = new Counter("peer_left");
const msgsSent = new Counter("ws_msgs_sent");
const msgsRecv = new Counter("ws_msgs_received");
const wsErrors = new Counter("ws_errors");
const timeToMatch = new Trend("time_to_match", true);
const msgRtt = new Trend("msg_rtt", true);
const restLatency = new Trend("rest_latency", true);
const restOk = new Rate("rest_ok");

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      exec: "conversation",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 2000 }, // palier 1 : 2000 (~1000 conv)
        { duration: "30s", target: 2000 },
        { duration: "25s", target: 4000 }, // palier 2 : 4000 (~2000 conv)
        { duration: "35s", target: 4000 },
        { duration: "25s", target: 6000 }, // palier 3 : 6000 (~3000 conv)
        { duration: "35s", target: 6000 },
        { duration: "25s", target: 8000 }, // palier 4 : 8000 (~4000 conv)
        { duration: "40s", target: 8000 },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
    rest_probe: {
      executor: "constant-vus",
      exec: "restProbe",
      vus: 5,
      duration: "260s",
    },
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    // informatif : on veut le rapport complet même si ça casse, pas d'abort.
    handshake_ok: ["rate>0.90"],
    conv_queue_timeout: ["count<500"],
  },
};

export function conversation() {
  const isLeft = __VU % 2 === 0;
  const speaks = isLeft ? "fr" : "en";
  const wants = isLeft ? "en" : "fr";
  const url = `${BASE}/ws/match?nick=vu${__VU}&speaks=${speaks}&wants=${wants}&fp=k6-${__VU}-${__ITER}&age=ok`;

  let openAt = 0;
  let isMatched = false;
  let sent = 0;
  let sendTimer = null;

  const res = ws.connect(url, null, (socket) => {
    socket.on("open", () => {
      openAt = Date.now();
      connected.add(1);
    });
    socket.on("message", (data) => {
      let f;
      try {
        f = JSON.parse(data);
      } catch (_) {
        return;
      }
      switch (f.type) {
        case "matched":
          if (!isMatched) {
            isMatched = true;
            matched.add(1);
            timeToMatch.add(Date.now() - openAt);
            sendTimer = socket.setInterval(() => {
              socket.send(
                JSON.stringify({ type: "msg", id: `${__VU}-${sent}`, body: `m ${Date.now()}` }),
              );
              msgsSent.add(1);
              sent += 1;
            }, MSG_INTERVAL_MS);
          }
          break;
        case "msg": {
          msgsRecv.add(1);
          const parts = String(f.body || "").split(" ");
          const ts = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(ts)) msgRtt.add(Date.now() - ts);
          break;
        }
        case "peer_left":
          peerLeft.add(1);
          break;
        case "error":
          wsErrors.add(1, { code: f.code || "unknown" });
          if (f.code === "queue_timeout") queueTimeouts.add(1);
          socket.close();
          break;
      }
    });
    socket.on("error", () => {
      wsErrors.add(1, { code: "transport" });
    });
    socket.setTimeout(() => {
      if (sendTimer) socket.clearInterval(sendTimer);
      socket.close();
    }, CONV_SECONDS * 1000);
  });

  handshakeOk.add(res && res.status === 101);
  check(res, { "handshake 101": (r) => r && r.status === 101 });
}

const LANGS = [["fr", "en"], ["en", "fr"], ["es", "en"], ["de", "en"]];
export function restProbe() {
  const h = http.get(`${BASE_HTTP}/healthz`, { tags: { ep: "healthz" } });
  restLatency.add(h.timings.duration, { ep: "healthz" });
  restOk.add(h.status === 200, { ep: "healthz" });
  const [s, w] = LANGS[Math.floor(Math.random() * LANGS.length)];
  const q = http.get(`${BASE_HTTP}/api/queue-size?speaks=${s}&wants=${w}`, { tags: { ep: "queue_size" } });
  restLatency.add(q.timings.duration, { ep: "queue_size" });
  restOk.add(q.status === 200, { ep: "queue_size" });
  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: textReport(data),
    "infra/k6/stress-summary.json": JSON.stringify(data, null, 2),
  };
}

function textReport(data) {
  const m = data.metrics;
  const g = (n, s) => (m[n] && m[n].values && m[n].values[s] !== undefined ? m[n].values[s] : null);
  const f = (v, d = 0) => (v === null ? "n/a" : v.toFixed(d));
  const L = [];
  L.push("\n==================================================================");
  L.push("  JOLYNE — STRESS / POINT DE RUPTURE");
  L.push("==================================================================");
  L.push(`  Cible : ${BASE}   paliers 2000 -> 4000 -> 6000 -> 8000 VU`);
  L.push("------------------------------------------------------------------");
  L.push(`  Connexions ouvertes ....... ${f(g("conv_connected", "count"))}`);
  L.push(`  Handshakes 101 OK ......... ${f(g("handshake_ok", "rate") * 100, 2)} %`);
  L.push(`  Conversations appairées ... ${f(g("conv_matched", "count"))}`);
  L.push(`  Queue timeouts ............ ${f(g("conv_queue_timeout", "count"))}`);
  L.push(`  Erreurs WS ................ ${f(g("ws_errors", "count"))}  (peer_left ${f(g("peer_left", "count"))})`);
  L.push(`  ws_connecting (ms) ........ avg ${f(g("ws_connecting", "avg"))}  p95 ${f(g("ws_connecting", "p(95)"))}  max ${f(g("ws_connecting", "max"))}`);
  L.push(`  time_to_match (ms) ........ p50 ${f(g("time_to_match", "med"))}  p95 ${f(g("time_to_match", "p(95)"))}  max ${f(g("time_to_match", "max"))}`);
  L.push(`  msg_rtt (ms) .............. p50 ${f(g("msg_rtt", "med"))}  p95 ${f(g("msg_rtt", "p(95)"))}  max ${f(g("msg_rtt", "max"))}`);
  L.push(`  rest_latency (ms) ......... p50 ${f(g("rest_latency", "med"))}  p95 ${f(g("rest_latency", "p(95)"))}  max ${f(g("rest_latency", "max"))}  ok ${f(g("rest_ok", "rate") * 100, 2)}%`);
  L.push(`  data rx/tx ................ ${(g("data_received", "count") / 1e6).toFixed(1)} / ${(g("data_sent", "count") / 1e6).toFixed(1)} MB`);
  L.push("==================================================================\n");
  return L.join("\n");
}
