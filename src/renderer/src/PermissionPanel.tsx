import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, ShieldAlert } from 'lucide-react';
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
  const respondInFlightRef = useRef(false);
  const kindLabel = getActionableKindLabel(request);
  const canSendTypedAnswer = request.kind === 'question' && answer.trim().length > 0;
  const hasChoiceAnswers = request.kind === 'question' && Boolean(request.choices?.length);
  const needsTypedAnswer = request.kind === 'question' && !hasChoiceAnswers;

  useEffect(() => {
    setAnswer('');
    setBusyDecision(null);
    respondInFlightRef.current = false;
  }, [request.id]);

  async function respond(decision: PermissionDecision, selectedAnswer?: string): Promise<void> {
    if (respondInFlightRef.current) return;
    respondInFlightRef.current = true;
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
      respondInFlightRef.current = false;
      setBusyDecision(null);
    }
  }

  return (
    <section
      className={`permission-panel risk-${request.risk} kind-${request.kind} ${
        compact ? 'compact-layout' : 'detail-layout'
      }`}
      aria-label={kindLabel}
    >
      <div className="permission-panel-scroll">
        <div className="section-kicker">{agentLabels[request.agent]} {kindLabel}</div>
        <h2>{request.action}</h2>
        {request.prompt ? <p>{request.prompt}</p> : null}
        {request.command ? <code>{request.command}</code> : null}
      </div>
      <div className={`permission-panel-footer ${compact ? 'compact' : 'detail'}`}>
        <div className="permission-meta">
          {request.kind === 'question' ? <MessageCircle size={15} /> : <ShieldAlert size={15} />}
          <span>{formatActionableMeta(request)}</span>
          <strong>{formatRisk(request.risk)}</strong>
        </div>
        {!compact && request.kind === 'question' ? (
          <div className="permission-panel-response">
            <AnswerFields
              request={request}
              compact={false}
              answer={answer}
              busyDecision={busyDecision}
              needsTypedAnswer={needsTypedAnswer}
              onAnswerChange={setAnswer}
              onRespond={respond}
            />
          </div>
        ) : null}
        <div className="permission-panel-actions-row">
          <PermissionActionButtons
            request={request}
            compact={compact}
            busyDecision={busyDecision}
            canSendTypedAnswer={canSendTypedAnswer}
            needsTypedAnswer={needsTypedAnswer}
            onRespond={respond}
          />
        </div>
      </div>
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
        <AnswerFields
          request={request}
          compact={compact}
          answer={answer}
          busyDecision={busyDecision}
          needsTypedAnswer={needsTypedAnswer}
          onAnswerChange={onAnswerChange}
          onRespond={onRespond}
        />
      ) : null}
      <PermissionActionButtons
        request={request}
        compact={compact}
        busyDecision={busyDecision}
        canSendTypedAnswer={canSendTypedAnswer}
        needsTypedAnswer={needsTypedAnswer}
        onRespond={onRespond}
      />
    </>
  );
}

function AnswerFields({
  request,
  compact,
  answer,
  busyDecision,
  needsTypedAnswer,
  onAnswerChange,
  onRespond
}: {
  request: PermissionRequest;
  compact: boolean;
  answer: string;
  busyDecision: PermissionDecision | null;
  needsTypedAnswer: boolean;
  onAnswerChange: (value: string) => void;
  onRespond: (decision: PermissionDecision, selectedAnswer?: string) => Promise<void>;
}): JSX.Element {
  return (
    <div className={`answer-box ${compact ? 'compact' : ''}`}>
      {request.choices?.length ? (
        <div className="answer-choices">
          {request.choices.map((choice) => (
            <button
              className={`decision answer ${busyDecision === 'answer' ? 'is-submitting' : ''}`}
              type="button"
              key={choice}
              onClick={() => void onRespond('answer', choice)}
              disabled={Boolean(busyDecision)}
            >
              {busyDecision === 'answer' ? <Loader2 size={13} /> : null}
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
  );
}

function PermissionActionButtons({
  request,
  compact,
  busyDecision,
  canSendTypedAnswer,
  needsTypedAnswer,
  onRespond
}: {
  request: PermissionRequest;
  compact: boolean;
  busyDecision: PermissionDecision | null;
  canSendTypedAnswer: boolean;
  needsTypedAnswer: boolean;
  onRespond: (decision: PermissionDecision, selectedAnswer?: string) => Promise<void>;
}): JSX.Element {
  const busyLabel = busyDecision ? getBusyDecisionLabel(busyDecision) : null;

  return (
    <div className={`permission-actions ${compact ? 'compact' : ''}`}>
      {request.kind === 'permission' ? (
        <>
          <button
            className={`decision allow ${busyDecision === 'allow' ? 'is-submitting' : ''}`}
            type="button"
            onClick={() => void onRespond('allow')}
            disabled={Boolean(busyDecision)}
          >
            {busyDecision === 'allow' ? <Loader2 size={13} /> : null}
            {busyDecision === 'allow' ? busyLabel : '允许'}
          </button>
          <button
            className={`decision deny ${busyDecision === 'deny' ? 'is-submitting' : ''}`}
            type="button"
            onClick={() => void onRespond('deny')}
            disabled={Boolean(busyDecision)}
          >
            {busyDecision === 'deny' ? <Loader2 size={13} /> : null}
            {busyDecision === 'deny' ? busyLabel : '拒绝'}
          </button>
          <button
            className={`decision muted ${busyDecision === 'denyForSession' ? 'is-submitting' : ''}`}
            type="button"
            onClick={() => void onRespond('denyForSession')}
            disabled={Boolean(busyDecision)}
          >
            {busyDecision === 'denyForSession' ? <Loader2 size={13} /> : null}
            {busyDecision === 'denyForSession' ? busyLabel : '本会话拒绝'}
          </button>
        </>
      ) : (
        <>
          {needsTypedAnswer ? (
            <button
              className={`decision allow ${busyDecision === 'answer' ? 'is-submitting' : ''}`}
              type="button"
              onClick={() => void onRespond('answer')}
              disabled={Boolean(busyDecision) || !canSendTypedAnswer}
            >
              {busyDecision === 'answer' ? <Loader2 size={13} /> : null}
              {busyDecision === 'answer' ? busyLabel : '发送回答'}
            </button>
          ) : null}
          <button
            className={`decision muted ${busyDecision === 'deny' ? 'is-submitting' : ''}`}
            type="button"
            onClick={() => void onRespond('deny')}
            disabled={Boolean(busyDecision)}
          >
            {busyDecision === 'deny' ? <Loader2 size={13} /> : null}
            {busyDecision === 'deny' ? busyLabel : '跳过'}
          </button>
        </>
      )}
    </div>
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

function getBusyDecisionLabel(decision: PermissionDecision): string {
  if (decision === 'allow') return '允许中';
  if (decision === 'deny' || decision === 'denyForSession') return '拒绝中';
  if (decision === 'answer') return '发送中';
  return '处理中';
}
