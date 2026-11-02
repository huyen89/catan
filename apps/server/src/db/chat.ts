import type Database from 'better-sqlite3';
import type { ChatMessage } from '@hexhaven/shared';

export interface ChatRepo {
  add(m: Omit<ChatMessage, 'id'>): ChatMessage;
  /** Most recent `limit` messages of a room, oldest first. */
  recent(roomId: string, limit: number): ChatMessage[];
}

interface RawChat {
  id: number;
  room_id: string;
  user_id: string;
  name: string;
  text: string;
  ts: number;
}

export function createChatRepo(db: Database.Database): ChatRepo {
  const insert = db.prepare(
    'INSERT INTO chat_messages (room_id, user_id, name, text, ts) VALUES (?, ?, ?, ?, ?)',
  );
  const recent = db.prepare<[string, number], RawChat>(
    'SELECT * FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?',
  );
  return {
    add(m) {
      const id = Number(insert.run(m.roomId, m.userId, m.name, m.text, m.ts).lastInsertRowid);
      return { id, ...m };
    },
    recent: (roomId, limit) =>
      recent
        .all(roomId, limit)
        .reverse()
        .map((r) => ({
          id: r.id,
          roomId: r.room_id,
          userId: r.user_id,
          name: r.name,
          text: r.text,
          ts: r.ts,
        })),
  };
}
