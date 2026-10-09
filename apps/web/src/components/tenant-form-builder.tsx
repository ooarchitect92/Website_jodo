'use client';
import type { TenantQuestion } from './tenant-questions';

export function TenantFormBuilder({
  fields,
  onChange,
}: {
  fields: TenantQuestion[];
  onChange: (fields: TenantQuestion[]) => void;
}) {
  const edit = (index: number, changes: Partial<TenantQuestion>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...changes } : field)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <section className="admin-panel">
      <h3>Additional enquiry questions</h3>
      <p>
        Add up to eight questions. The standard contact fields remain required. Do not request
        payment credentials or sensitive financial information.
      </p>
      {fields.map((field, index) => (
        <fieldset key={field.key} className="admin-panel">
          <legend>Question {index + 1}</legend>
          <label className="field">
            Question label
            <input
              value={field.label}
              required
              minLength={2}
              maxLength={80}
              onChange={(e) => edit(index, { label: e.target.value })}
            />
          </label>
          <label className="field">
            Answer format
            <select
              value={field.kind}
              onChange={(e) => {
                const kind = e.target.value as TenantQuestion['kind'];
                edit(index, { kind, options: kind === 'choice' ? ['Yes', 'No'] : [] });
              }}
            >
              <option value="short_text">Short answer</option>
              <option value="long_text">Long answer</option>
              <option value="choice">Single choice</option>
            </select>
          </label>
          {field.kind === 'choice' && (
            <label className="field">
              Choices, one per line (2–12)
              <textarea
                rows={4}
                value={field.options.join('\n')}
                onChange={(e) => edit(index, { options: e.target.value.split('\n') })}
              />
            </label>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => edit(index, { required: e.target.checked })}
            />
            Required answer
          </label>
          <div className="admin-toolbar">
            <button
              className="button outline"
              type="button"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              Move up
            </button>
            <button
              className="button outline"
              type="button"
              disabled={index === fields.length - 1}
              onClick={() => move(index, 1)}
            >
              Move down
            </button>
            <button
              className="button outline"
              type="button"
              onClick={() => onChange(fields.filter((entry) => entry.key !== field.key))}
            >
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      <button
        className="button outline"
        type="button"
        disabled={fields.length >= 8}
        onClick={() =>
          onChange([
            ...fields,
            {
              key: 'question_' + crypto.randomUUID().slice(0, 8),
              label: 'New question',
              kind: 'short_text',
              required: false,
              options: [],
            },
          ])
        }
      >
        Add question
      </button>
      <p className="small muted">Every save creates a new, retained form version.</p>
    </section>
  );
}
