import { fetchIceServers } from './iceServers';
import { summarizeIceTest, type CandidateLike, type IceTestResult } from './logic';

/** Gathering normally finishes in 1–3 s; a TURN server that never answers is cut off here. */
const GATHER_TIMEOUT_MS = 8000;

/** Gathers candidates on a throwaway connection (no media, no remote peer). */
async function gather(
  iceServers: RTCIceServer[],
  policy: RTCIceTransportPolicy,
): Promise<CandidateLike[]> {
  const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  const out: CandidateLike[] = [];
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const extra = candidate as RTCIceCandidate & { relayProtocol?: string; url?: string };
        out.push({
          candidate: candidate.candidate,
          type: candidate.type,
          relayProtocol: extra.relayProtocol ?? null,
          url: extra.url ?? null,
        });
      };
      // A data channel gives the offer an m-line to gather for, without asking for the mic.
      pc.createDataChannel('probe');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  } finally {
    pc.onicecandidate = null;
    pc.close();
  }
  return out;
}

/**
 * Voice connection self-test: fetches /api/voice/ice and gathers candidates twice in
 * parallel: all candidate types (does STUN find our public address?) and relay-only
 * (does the TURN server hand out relay candidates, and over which transports?).
 */
export async function runIceTest(): Promise<IceTestResult> {
  const started = performance.now();
  const { iceServers, fetched } = await fetchIceServers();
  const [all, relay] = await Promise.all([gather(iceServers, 'all'), gather(iceServers, 'relay')]);
  return summarizeIceTest({
    iceFetched: fetched,
    iceServers,
    candidates: [...all, ...relay],
    ms: performance.now() - started,
  });
}
