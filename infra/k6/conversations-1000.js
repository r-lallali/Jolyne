// Test de charge "1000 conversations en simultané" pour le gateway Jolyne.
//
// Une "conversation" = 2 peers appairés sur /ws/match qui échangent des
// messages. 1000 conversations = 2000 connexions WebSocket vivantes en même
// temps. Les VU pairs parlent fr/veulent en, les impairs parlent en/veulent
// fr — le matcher les appaire (fr<->en).
//
// Métriques collectées (un max d'infos) :
//   - handshake_ok ............ taux d'upgrade WS 101 réussi
//   - time_to_match ........... délai open -> frame "matched" (ms)
//   - msg_rtt ................. latence de relais réelle client->serveur->peer
//                              (timestamp embarqué dans le corps du message)
//   - ws_msgs_sent / received . volume de messages applicatifs
//   - conv_matched ............ nb de conversations effectivement appairées
//   - conv_queue_timeout ...... nb de peers jamais appairés (timeout 30s serveur)
//   - peer_left ............... nb de frames peer_left reçues
//   - ws_errors{code=...} ..... erreurs applicatives ventilées par code
//   - rest_* .................. latence HTTP /healthz et /api/queue-size sous charge
//
// Usage :
//   ulimit -n 20000
//   k6 run -e BASE=wss://api.jolyne.ralys.ovh \
//          -e VUS=2000 -e RAMP=40s -e HOLD=60s -e CONV_SECONDS=45 \
//          infra/k6/conversations-1000.js
//
//   VUS=2000  -> 1000 conversations simultanées au pic.
//   Baisse VUS (ex: 400) pour un essai prudent avant le run plein.

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// ---- Paramètres (overridables via -e) -------------------------------------
const BASE = __ENV.BASE || "wss://api.jolyne.ralys.ovh";
// BASE_HTTP : même host en http(s) pour le scénario REST. Dérivé de BASE.
const BASE_HTTP =
  __ENV.BASE_HTTP || BASE.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
const VUS = parseInt(__ENV.VUS || "2000", 10); // 2000 VU = 1000 conversations
const RAMP = __ENV.RAMP || "40s"; // montée en charge
const HOLD = __ENV.HOLD || "60s"; // palier à pleine charge
const RAMPDOWN = __ENV.RAMPDOWN || "10s";
const CONV_SECONDS = parseInt(__ENV.CONV_SECONDS || "45", 10); // durée d'une conv
const MSG_INTERVAL_MS = parseInt(__ENV.MSG_INTERVAL_MS || "3000", 10);

// ---- Métriques custom ------------------------------------------------------
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
const convDuration = new Trend("conv_duration", true);

const restLatency = new Trend("rest_latency", true);
const restOk = new Rate("rest_ok");

export const options = {
  // Deux scénarios en parallèle : la tempête WS + un sondage REST léger qui
  // mesure la latence HTTP du gateway *pendant* que les WS le saturent.
  scenarios: {
    conversations: {
      executor: "ramping-vus",
      exec: "conversation",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: RAMPDOWN, target: 0 },
      ],
      gracefulRampDown: "10s",
    },
    rest_probe: {
      executor: "constant-vus",
      exec: "restProbe",
      vus: 10,
      duration: addDurations(RAMP, HOLD, RAMPDOWN),
      startTime: "0s",
    },
  },
  summaryTrendStats: ["min", "med", "avg", "p(90)", "p(95)", "p(99)", "max"],
  thresholds: {
    handshake_ok: ["rate>0.95"],
    time_to_match: ["p(95)<5000"],
    msg_rtt: ["p(95)<2000", "p(99)<5000"],
    rest_latency: ["p(95)<1000"],
    // informatif : on ne veut pas que k6 "abort", juste flaguer.
    conv_queue_timeout: ["count<100"],
  },
};

// ---- Scénario WS : une conversation ---------------------------------------
export function conversation() {
  const isLeft = __VU % 2 === 0;
  const speaks = isLeft ? "fr" : "en";
  const wants = isLeft ? "en" : "fr";
  const nick = `vu${__VU}`;
  const fp = `k6-${__VU}-${__ITER}`;
  const url = `${BASE}/ws/match?nick=${nick}&speaks=${speaks}&wants=${wants}&fp=${fp}&age=ok`;

  const startedAt = Date.now();
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
        case "queued":
          break;
        case "matched":
          if (!isMatched) {
            isMatched = true;
            matched.add(1);
            timeToMatch.add(Date.now() - openAt);
            // Boucle d'échange : un message toutes les MSG_INTERVAL_MS, corps
            // = "m <epoch_ms>" pour mesurer la latence de relais côté peer.
            sendTimer = socket.setInterval(() => {
              socket.send(
                JSON.stringify({
                  type: "msg",
                  id: `${__VU}-${sent}`,
                  body: `m ${Date.now()}`,
                }),
              );
              msgsSent.add(1);
              sent += 1;
            }, MSG_INTERVAL_MS);
          }
          break;
        case "msg": {
          // Message relayé depuis le peer : on extrait son timestamp d'envoi
          // pour calculer la latence end-to-end (même horloge, même machine).
          msgsRecv.add(1);
          const parts = String(f.body || "").split(" ");
          const ts = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(ts)) msgRtt.add(Date.now() - ts);
          break;
        }
        case "typing":
          break;
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

    socket.on("error", (e) => {
      // Erreurs réseau/transport (pas les frames applicatives "error").
      wsErrors.add(1, { code: "transport" });
      if (e && e.error && !String(e.error()).includes("close")) {
        // bruit limité : on ne logge pas chaque socket sur 2000 VU
      }
    });

    socket.on("close", () => {
      if (openAt > 0) convDuration.add(Date.now() - openAt);
    });

    // Fin de conversation : on ferme proprement après CONV_SECONDS.
    socket.setTimeout(() => {
      if (sendTimer) socket.clearInterval(sendTimer);
      socket.close();
    }, CONV_SECONDS * 1000);
  });

  handshakeOk.add(res && res.status === 101);
  check(res, { "handshake 101": (r) => r && r.status === 101 });
}

// ---- Scénario REST : sonde /healthz et /api/queue-size sous charge --------
const LANGS = [
  ["fr", "en"],
  ["en", "fr"],
  ["es", "en"],
  ["de", "en"],
];
export function restProbe() {
  // alterne healthz et queue-size
  const h = http.get(`${BASE_HTTP}/healthz`, { tags: { ep: "healthz" } });
  restLatency.add(h.timings.duration, { ep: "healthz" });
  restOk.add(h.status === 200, { ep: "healthz" });

  const [s, w] = LANGS[Math.floor(Math.random() * LANGS.length)];
  const q = http.get(`${BASE_HTTP}/api/queue-size?speaks=${s}&wants=${w}`, {
    tags: { ep: "queue_size" },
  });
  restLatency.add(q.timings.duration, { ep: "queue_size" });
  restOk.add(q.status === 200, { ep: "queue_size" });

  sleep(1);
}

// ---- Résumé final : JSON + texte lisible ----------------------------------
export function handleSummary(data) {
  const m = data.metrics;
  const get = (name, stat) =>
    m[name] && m[name].values && m[name].values[stat] !== undefined
      ? m[name].values[stat]
      : null;
  const n = (v, d = 0) => (v === null ? "n/a" : v.toFixed(d));

  const lines = [];
  lines.push("");
  lines.push("==================================================================");
  lines.push("  JOLYNE — RAPPORT DE CHARGE  (1000 conversations simultanées)");
  lines.push("==================================================================");
  lines.push(`  Cible            : ${BASE}`);
  lines.push(`  VU max           : ${VUS}  (~${Math.floor(VUS / 2)} conversations au pic)`);
  lines.push(`  Profil           : ramp ${RAMP} / hold ${HOLD} / down ${RAMPDOWN}`);
  lines.push("------------------------------------------------------------------");
  lines.push("  WEBSOCKET / MATCHING");
  lines.push(`    Connexions ouvertes ....... ${n(get("conv_connected", "count"))}`);
  lines.push(`    Handshakes 101 OK ......... ${n(get("handshake_ok", "rate") * 100, 2)} %`);
  lines.push(`    Conversations appairées ... ${n(get("conv_matched", "count"))}`);
  lines.push(`    Queue timeouts (30s) ...... ${n(get("conv_queue_timeout", "count"))}`);
  lines.push(`    peer_left reçus ........... ${n(get("peer_left", "count"))}`);
  lines.push(`    Erreurs WS (toutes) ....... ${n(get("ws_errors", "count"))}`);
  lines.push("");
  lines.push("  TIME TO MATCH (open -> matched), ms");
  lines.push(`    p50 ${n(get("time_to_match", "med"))}  p90 ${n(get("time_to_match", "p(90)"))}  p95 ${n(get("time_to_match", "p(95)"))}  max ${n(get("time_to_match", "max"))}`);
  lines.push("");
  lines.push("  LATENCE MESSAGE (client -> serveur -> peer), ms");
  lines.push(`    msgs envoyés ${n(get("ws_msgs_sent", "count"))}  reçus ${n(get("ws_msgs_received", "count"))}`);
  lines.push(`    p50 ${n(get("msg_rtt", "med"))}  p90 ${n(get("msg_rtt", "p(90)"))}  p95 ${n(get("msg_rtt", "p(95)"))}  p99 ${n(get("msg_rtt", "p(99)"))}  max ${n(get("msg_rtt", "max"))}`);
  lines.push("");
  lines.push("  REST SOUS CHARGE (ms)");
  lines.push(`    rest_ok ................... ${n(get("rest_ok", "rate") * 100, 2)} %`);
  lines.push(`    latence p50 ${n(get("rest_latency", "med"))}  p95 ${n(get("rest_latency", "p(95)"))}  max ${n(get("rest_latency", "max"))}`);
  lines.push("");
  lines.push("  RÉSEAU");
  lines.push(`    data reçue ................ ${(get("data_received", "count") / 1e6).toFixed(2)} MB`);
  lines.push(`    data envoyée .............. ${(get("data_sent", "count") / 1e6).toFixed(2)} MB`);
  lines.push("==================================================================");
  lines.push("");

  const text = lines.join("\n");
  return {
    stdout: text,
    "infra/k6/last-run-summary.json": JSON.stringify(data, null, 2),
    "infra/k6/last-run-summary.txt": text,
  };
}

// ---- util : additionne des durées k6 ("40s","60s","1m") en "Ns" -----------
function addDurations(...ds) {
  let total = 0;
  for (const d of ds) {
    const mm = /^(\d+)m$/.exec(d);
    const ss = /^(\d+)s$/.exec(d);
    if (mm) total += parseInt(mm[1], 10) * 60;
    else if (ss) total += parseInt(ss[1], 10);
  }
  return `${total}s`;
}
