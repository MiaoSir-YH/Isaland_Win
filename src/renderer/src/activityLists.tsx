import { Circle } from 'lucide-react';
import type { AgentSession, NormalizedEvent } from '@shared/types';
import { formatTime } from './formatters';
import { agentLabels } from './i18n';

export function SessionStrip({
  sessions,
  onJump
}: {
  sessions: AgentSession[];
  onJump: (target?: string | { sessionId?: string; workspace?: string }) => void;
}): JSX.Element {
  if (sessions.length === 0) return <div className="empty-state">暂无活动会话</div>;
  return (
    <section className="session-strip" aria-label="会话列表">
      {sessions.slice(0, 2).map((session) => (
        <button
          className="session-chip"
          type="button"
          key={session.id}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onJump({ sessionId: session.id, workspace: session.workspace });
          }}
        >
          <span className={`agent-dot ${session.agent}`} />
          <span>{agentLabels[session.agent]}</span>
          <strong>{session.title}</strong>
        </button>
      ))}
    </section>
  );
}

export function EventList({ events }: { events: NormalizedEvent[] }): JSX.Element {
  if (events.length === 0) return <div className="empty-state">暂无事件</div>;
  return (
    <section className="event-list" aria-label="最近事件">
      {events.map((event) => (
        <article className={`event-row severity-${event.severity}`} key={event.id}>
          <Circle size={8} fill="currentColor" />
          <div>
            <strong>{event.title}</strong>
            <span>{event.message ?? formatTime(event.timestamp)}</span>
          </div>
        </article>
      ))}
    </section>
  );
}
