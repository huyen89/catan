import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emitAck } from '../net/socket';
import { request } from '../net/session';
import { useRoomStore } from '../store/room';
import { useSession } from '../store/session';

const MAX_LEN = 500;

export function ChatPanel({ disabled = false }: { disabled?: boolean }) {
  const chat = useRoomStore((s) => s.chat);
  const seats = useRoomStore((s) => s.room?.seats);
  const myId = useSession((s) => s.user?.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const colorFor = (userId: string) => seats?.find((s) => s.userId === userId)?.color;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const res = await request(emitAck('chat:send', { text: t }));
    setSending(false);
    if (res.ok) setText('');
  };

  return (
    <section className="panel chat" aria-label="Chat">
      <h2>Chat</h2>
      <ol ref={ref} data-testid="chat-log" aria-live="polite">
        {chat.length === 0 && <li className="muted">Say hi!</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.userId === myId ? 'chat-line mine' : 'chat-line'}>
            <span className="chat-name" style={{ color: colorFor(m.userId) }}>
              {m.name}
            </span>{' '}
            <span className="chat-text">{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={submit}>
        <input
          data-testid="chat-input"
          aria-label="Chat message"
          placeholder="Message"
          maxLength={MAX_LEN}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={disabled || sending || !text.trim()}
          aria-label="Send chat message"
        >
          Send
        </button>
      </form>
    </section>
  );
}
