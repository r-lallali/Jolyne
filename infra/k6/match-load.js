// Test de charge minimal pour /ws/match.
//
// Usage local (avec backend + redis up dans le compose dev) :
//   docker run --rm -i --network host grafana/k6 run - <infra/k6/match-load.js
//   ou
//   k6 run -e JOLYNE_WS=ws://localhost:8080 infra/k6/match-load.js
//
// Usage contre la prod :
//   k6 run -e JOLYNE_WS=wss://api.jolyne.ralys.ovh infra/k6/match-load.js
//
// VUs pairs → speaks=fr,wants=en. Impairs → speaks=en,wants=fr.
// Chaque VU se connecte, attend le match, échange 3 messages, ferme.
// Mesure : taux de handshake 101, durée pour atteindre "matched", erreurs.

import ws from "k6/ws";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    matched_count: ["count>50"],
    time_to_match: ["p(95)<3000"],
  },
};

const BASE = __ENV.JOLYNE_WS || "wss://api.jolyne.ralys.ovh";

const matched = new Counter("matched_count");
const queueTimeouts = new Counter("queue_timeouts");
const timeToMatch = new Trend("time_to_match", true);

export default function () {
  const isLeft = __VU % 2 === 0;
  const speaks = isLeft ? "fr" : "en";
  const wants = isLeft ? "en" : "fr";
  const nick = `vu${__VU}`;
  const fp = `k6-fp-${__VU}`;
  const url = `${BASE}/ws/match?nick=${nick}&speaks=${speaks}&wants=${wants}&fp=${fp}&age=ok`;

  const res = ws.connect(url, null, (socket) => {
    let openAt = Date.now();
    let messagesSent = 0;
    let sendInterval = null;

    socket.on("open", () => {
      openAt = Date.now();
    });

    socket.on("message", (data) => {
      let frame;
      try {
        frame = JSON.parse(data);
      } catch (_) {
        return;
      }
      switch (frame.type) {
        case "matched":
          matched.add(1);
          timeToMatch.add(Date.now() - openAt);
          sendInterval = socket.setInterval(() => {
            if (messagesSent >= 3) {
              if (sendInterval) socket.clearInterval(sendInterval);
              socket.close();
              return;
            }
            socket.send(
              JSON.stringify({
                type: "msg",
                body: `msg ${messagesSent} from vu${__VU}`,
              }),
            );
            messagesSent += 1;
          }, 800);
          break;
        case "error":
          if (frame.code === "queue_timeout") queueTimeouts.add(1);
          socket.close();
          break;
      }
    });

    socket.on("error", (e) => {
      console.error(`vu${__VU}: ${e.error ? e.error() : e}`);
    });

    socket.setTimeout(() => {
      if (sendInterval) socket.clearInterval(sendInterval);
      socket.close();
    }, 15000);
  });

  check(res, { "handshake 101": (r) => r && r.status === 101 });
}
