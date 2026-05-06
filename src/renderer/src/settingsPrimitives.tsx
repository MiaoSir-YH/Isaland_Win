import type { AgentUsage } from '@shared/types';
import { formatDateTime, formatUsageWindow } from './formatters';
import { agentLabels, getDictionary, type Locale } from './i18n';

export function SectionTitle({ icon, title }: { icon: JSX.Element; title: string }): JSX.Element {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

export function UsageCard({
  usage,
  locale,
  dictionary
}: {
  usage: AgentUsage;
  locale: Locale;
  dictionary: ReturnType<typeof getDictionary>;
}): JSX.Element {
  return (
    <article className={`usage-card ${usage.available ? 'available' : 'missing'}`}>
      <div className="usage-card-header">
        <span className={`agent-dot ${usage.agent}`} />
        <div>
          <h2>{agentLabels[usage.agent]}</h2>
          <p>{usage.available ? usage.source : usage.message ?? 'Usage unavailable'}</p>
        </div>
      </div>
      <UsageMeter label="5h" window={usage.fiveHour} locale={locale} resetLabel={dictionary.labels.reset} />
      <UsageMeter label="7d" window={usage.sevenDay} locale={locale} resetLabel={dictionary.labels.reset} />
      <span className="usage-updated">{dictionary.labels.updated} {formatDateTime(usage.updatedAt, locale)}</span>
    </article>
  );
}

function UsageMeter({
  label,
  window,
  locale,
  resetLabel
}: {
  label: string;
  window: AgentUsage['fiveHour'];
  locale: Locale;
  resetLabel: string;
}): JSX.Element {
  const used = window?.used;
  const limit = window?.limit;
  const percent = typeof used === 'number' && typeof limit === 'number' && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="usage-meter">
      <div>
        <span>{label}</span>
        <strong>{formatUsageWindow(window)}</strong>
      </div>
      <div className="usage-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      {window?.resetAt ? <small>{resetLabel} {formatDateTime(window.resetAt, locale)}</small> : null}
    </div>
  );
}

export function ShortcutRow({ keys, label }: { keys: string[]; label: string }): JSX.Element {
  return (
    <div className="shortcut-row">
      <span>
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
      <strong>{label}</strong>
    </div>
  );
}

export function StatusTile({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning';
}): JSX.Element {
  return (
    <article className={`status-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function KeyValueList({ items }: { items: Array<[string, string | undefined]> }): JSX.Element {
  return (
    <dl className="key-value-list">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd title={value}>{value ?? 'Unavailable'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SettingToggle({
  icon,
  label,
  checked,
  onChange
}: {
  icon: JSX.Element;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="toggle-row">
      <span>
        {icon}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}
