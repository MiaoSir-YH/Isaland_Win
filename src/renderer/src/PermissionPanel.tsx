import { useEffect, useState } from 'react';
import { MessageCircle, ShieldAlert } from 'lucide-react';
import type { PermissionDecision, PermissionRequest } from '@shared/types';
import { getPermissionNoticeTimeoutMs } from '@shared/permission';
import { agentLabels } from './i18n';

export function PermissionPanel({
  request,
  compact = false
}: {
  request: PermissionRequest;
  compact?: boolean;
}): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [busyDecision, setBusyDecision] = useState<PermissionDecision | null>(null);
  const kindLabel = getActionableKindLabel(request);
  const canSendTypedAnswer = request.kind === 'question' && answer.trim().length > 0;

  useEffect(() => {
    setAnswer('');
    setBusyDecision(null);
  }, [request.id]);

  async function respond(decision: PermissionDecision, selectedAnswer?: string): Promise<void> {
    setBusyDecision(decision);
    try {
      await window.vibeIsland.respondPermission({
        id: request.id,
        decision,
        decidedAt: new Date().toISOString(),
        answer: selectedAnswer?.trim() || (decision === 'answer' ? answer.trim() : undefined),
        scope: decision === 'denyForSession' ? 'session' : 'request'
      });
    } finally {
      setBusyDecision(null);
    }
  }

  return (
    <section className={`permission-panel risk-${request.risk} kind-${request.kind}`} aria-label={kindLabel}>
      <div>
        <div className="section-kicker">{agentLabels[request.agent]} {kindLabel}</div>
        <h2>{request.action}</h2>
        {request.prompt ? <p>{request.prompt}</p> : null}
        {request.command ? <code>{request.command}</code> : null}
      </div>
      <div className="permission-meta">
        {request.kind === 'question' ? <MessageCircle size={15} /> : <ShieldAlert size={15} />}
        <span>{formatActionableMeta(request)}</span>
        <strong>{formatRisk(request.risk)}</strong>
      </div>
      <InlinePermissionActions
        request={request}
        compact={compact}
        answer={answer}
        busyDecision={busyDecision}
        canSendTypedAnswer={canSendTypedAnswer}
        onAnswerChange={setAnswer}
        onRespond={respond}
      />
    </section>
  );
}

export function InlinePermissionActions({
  request,
  compact = false,
  answer,
  busyDecision,
  canSendTypedAnswer,
  onAnswerChange,
  onRespond
}: {
  request: PermissionRequest;
  compact?: boolean;
  answer: string;
  busyDecision: PermissionDecision | null;
  canSendTypedAnswer: boolean;
  onAnswerChange: (value: string) => void;
  onRespond: (decision: PermissionDecision, selectedAnswer?: string) => Promise<void>;
}): JSX.Element {
  const hasChoiceAnswers = request.kind === 'question' && Boolean(request.choices?.length);
  const needsTypedAnswer = request.kind === 'question' && !hasChoiceAnswers;

  return (
    <>
      {request.kind === 'question' ? (
        <div className={`answer-box ${compact ? 'compact' : ''}`}>
          {request.choices?.length ? (
            <div className="answer-choices">
              {request.choices.map((choice) => (
                <button
                  className="decision answer"
                  type="button"
                  key={choice}
                  onClick={() => void onRespond('answer', choice)}
                  disabled={Boolean(busyDecision)}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {needsTypedAnswer ? (
            <label>
              <span>回答</span>
              <textarea
                value={answer}
                rows={compact ? 2 : 3}
                onChange={(event) => onAnswerChange(event.currentTarget.value)}
                placeholder="输入要发送给 Agent 的回复"
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className={`permission-actions ${compact ? 'compact' : ''}`}>
        {request.kind === 'permission' ? (
          <>
            <button className="decision allow" type="button" onClick={() => void onRespond('allow')} disabled={Boolean(busyDecision)}>
              允许
            </button>
            <button className="decision deny" type="button" onClick={() => void onRespond('deny')} disabled={Boolean(busyDecision)}>
              拒绝
            </button>
            <button
              className="decision muted"
              type="button"
              onClick={() => void onRespond('denyForSession')}
              disabled={Boolean(busyDecision)}
            >
              本会话拒绝
            </button>
          </>
        ) : (
          <>
            {needsTypedAnswer ? (
              <button
                className="decision allow"
                type="button"
                onClick={() => void onRespond('answer')}
                disabled={Boolean(busyDecision) || !canSendTypedAnswer}
              >
                发送回答
              </button>
            ) : null}
            <button className="decision muted" type="button" onClick={() => void onRespond('deny')} disabled={Boolean(busyDecision)}>
              跳过
            </button>
          </>
        )}
      </div>
    </>
  );
}

export function getActionableKindLabel(request: PermissionRequest): string {
  return request.kind === 'question' ? '需要回答' : '需要权限';
}

export function formatActionableMeta(request: PermissionRequest): string {
  const timeoutSeconds = Math.ceil(getPermissionNoticeTimeoutMs(request.timeoutMs) / 1000);
  const base = request.kind === 'question' ? '等待输入' : '等待审批';
  return `${base}，${timeoutSeconds} 秒后超时`;
}

export function formatRisk(risk: PermissionRequest['risk']): string {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '低风险';
}
