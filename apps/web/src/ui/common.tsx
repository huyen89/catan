import { useId, type ReactNode } from 'react';
import { RESOURCES, type Resource, type ResourceCounts } from '@hexhaven/engine';
import { RESOURCE_LABEL } from '../game/labels';
import { adjustCount } from '../game/trade';
import { navigate } from '../router';
import { ResourceIcon } from './icons';

/** Five resource steppers. Test ids: `${testPrefix}-${res}-plus|minus`. */
export function ResourceCounter(props: {
  counts: ResourceCounts;
  onChange(next: ResourceCounts): void;
  /** Per-resource upper bound (e.g. the player's hand). */
  max?: ResourceCounts;
  testPrefix: string;
  label: string;
  disabled?: boolean;
}) {
  const { counts, onChange, max, testPrefix, label, disabled } = props;
  return (
    <div className="res-counter" role="group" aria-label={label}>
      {RESOURCES.map((r) => {
        const limit = max ? max[r] : 99;
        return (
          <div key={r} className={counts[r] > 0 ? 'res-step on' : 'res-step'}>
            <ResourceIcon res={r} size={20} />
            <button
              type="button"
              className="step"
              data-testid={`${testPrefix}-${r}-minus`}
              aria-label={`${label}: one less ${RESOURCE_LABEL[r]}`}
              disabled={disabled || counts[r] <= 0}
              onClick={() => onChange(adjustCount(counts, r, -1, limit))}
            >
              −
            </button>
            <span className="step-count" aria-label={`${counts[r]} ${RESOURCE_LABEL[r]}`}>
              {counts[r]}
            </span>
            <button
              type="button"
              className="step"
              data-testid={`${testPrefix}-${r}-plus`}
              aria-label={`${label}: one more ${RESOURCE_LABEL[r]}`}
              disabled={disabled || counts[r] >= limit}
              onClick={() => onChange(adjustCount(counts, r, 1, limit))}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Pick one resource. Test ids: `${testPrefix}-${res}`. */
export function ResourceChoice(props: {
  value: Resource | null;
  onChange(r: Resource): void;
  testPrefix: string;
  label: string;
  isDisabled?(r: Resource): boolean;
  note?(r: Resource): string | null;
}) {
  return (
    <div className="res-choice" role="group" aria-label={props.label}>
      {RESOURCES.map((r) => (
        <button
          key={r}
          type="button"
          className={props.value === r ? 'chip selected' : 'chip'}
          aria-pressed={props.value === r}
          aria-label={`${props.label}: ${RESOURCE_LABEL[r]}`}
          data-testid={`${props.testPrefix}-${r}`}
          disabled={props.isDisabled?.(r)}
          onClick={() => props.onChange(r)}
        >
          <ResourceIcon res={r} size={18} />
          {props.note?.(r) && <span className="chip-note">{props.note(r)}</span>}
        </button>
      ))}
    </div>
  );
}

/** In-app link: a real <a href> (middle-click, copy link) that navigates without a reload. */
export function Link(props: {
  to: string;
  className?: string;
  testId?: string;
  'aria-label'?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={props.to}
      className={props.className}
      data-testid={props.testId}
      aria-label={props['aria-label']}
      onClick={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

export function Modal(props: { title: string; testId?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-testid={props.testId}
      >
        <h2 id={id}>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}
