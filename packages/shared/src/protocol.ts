import { z } from 'zod';
import type { GameEvent, PlayerView } from '@hexhaven/engine';
import { actionSchema } from './actions';
import { botDifficultySchema, roomSettingsSchema, type ChatMessage, type RoomInfo } from './room';

// ---------------------------------------------------------------- ack envelope

export type AckError = { code: string; message: string };
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: AckError };
export type AckFn<T = undefined> = (res: Ack<T>) => void;

// ---------------------------------------------------------------- client → server payload schemas

export const C2S = {
  'room:create': z.strictObject({ settings: roomSettingsSchema.partial().optional() }),
  'room:join': z.strictObject({ code: z.string().trim().toUpperCase().length(6) }),
  'room:leave': z.strictObject({}),
  'room:sit': z.strictObject({ seat: z.number().int().min(0).max(5) }),
  'room:stand': z.strictObject({}),
  'room:ready': z.strictObject({ ready: z.boolean() }),
  'room:addBot': z.strictObject({
    seat: z.number().int().min(0).max(5),
    difficulty: botDifficultySchema,
  }),
  'room:removeBot': z.strictObject({ seat: z.number().int().min(0).max(5) }),
  'room:kick': z.strictObject({ userId: z.string().min(1).max(64) }),
  'room:settings': z.strictObject({ settings: roomSettingsSchema.partial() }),
  'room:start': z.strictObject({}),
  /** Host only, room status 'finished': back to the lobby with the same seats (humans un-ready). */
  'room:rematch': z.strictObject({}),
  'game:action': z.strictObject({ expectedVersion: z.number().int().min(0), action: actionSchema }),
  'game:sync': z.strictObject({}),
  'chat:send': z.strictObject({ text: z.string().trim().min(1).max(500) }),
  'voice:join': z.strictObject({}),
  'voice:leave': z.strictObject({}),
  'voice:signal': z.strictObject({
    to: z.string().min(1).max(64),
    data: z.union([
      z.strictObject({
        description: z.strictObject({
          type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
          sdp: z.string().max(20000).optional(),
        }),
      }),
      z.strictObject({
        candidate: z
          .strictObject({
            candidate: z.string().max(2000),
            sdpMid: z.string().max(64).nullable().optional(),
            sdpMLineIndex: z.number().int().nullable().optional(),
            usernameFragment: z.string().max(256).nullable().optional(),
          })
          .nullable(),
      }),
    ]),
  }),
  'voice:state': z.strictObject({ muted: z.boolean() }),
} as const;

export type C2SEvent = keyof typeof C2S;
export type C2SPayload<E extends C2SEvent> = z.infer<(typeof C2S)[E]>;

/** Ack data type per client event. */
export interface C2SAckData {
  'room:create': RoomInfo;
  'room:join': RoomInfo;
  'room:leave': undefined;
  'room:sit': undefined;
  'room:stand': undefined;
  'room:ready': undefined;
  'room:addBot': undefined;
  'room:removeBot': undefined;
  'room:kick': undefined;
  'room:settings': undefined;
  'room:start': undefined;
  'room:rematch': undefined;
  'game:action': { version: number };
  'game:sync': GameStatePayload;
  'chat:send': undefined;
  'voice:join': { peers: VoicePeer[] };
  'voice:leave': undefined;
  'voice:signal': undefined;
  'voice:state': undefined;
}

/** Socket.IO typed map for the client→server direction. */
export type ClientToServerEvents = {
  [E in C2SEvent]: (payload: C2SPayload<E>, ack: AckFn<C2SAckData[E]>) => void;
};

// ---------------------------------------------------------------- server → client

export interface GameStatePayload {
  roomId: string;
  gameId: string;
  version: number;
  view: PlayerView;
  /** Events produced by the action that led to this state, redacted for the receiver. */
  events: GameEvent[];
  /** Epoch ms when the current decision times out (null = no timer). */
  deadline: number | null;
  /** Server clock at send time, for client skew correction. */
  serverNow: number;
}

/** A user already in the voice channel when you join, with their current mic state. */
export interface VoicePeer {
  userId: string;
  muted: boolean;
}

export type VoiceSignalData = C2SPayload<'voice:signal'>['data'];

export interface ServerToClientEvents {
  'room:state': (room: RoomInfo) => void;
  'room:closed': (p: { reason: string }) => void;
  'game:state': (p: GameStatePayload) => void;
  'chat:message': (m: ChatMessage) => void;
  'chat:history': (m: ChatMessage[]) => void;
  'voice:peerJoined': (p: { userId: string }) => void;
  'voice:peerLeft': (p: { userId: string }) => void;
  'voice:signal': (p: { from: string; data: VoiceSignalData }) => void;
  'voice:state': (p: { userId: string; muted: boolean; inVoice: boolean }) => void;
  'server:error': (e: AckError) => void;
}
