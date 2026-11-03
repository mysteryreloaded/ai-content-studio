import type { WorkbenchInput } from "@ai-content-studio/shared";

interface InputFieldProps {
  input: WorkbenchInput;
  value: string;
  onChange: (value: string) => void;
  issue: string | undefined;
}

/** One Input's field: a blank, optional Input shows the Workflow's own value as its placeholder (issue #46). */
export function InputField({ input, value, onChange, issue }: InputFieldProps) {
  const placeholder =
    input.placeholder === null ? undefined : String(input.placeholder);
  const helpId = input.help ? `input-help-${input.id}` : undefined;
  const issueId = issue ? `input-issue-${input.id}` : undefined;
  const describedBy = [helpId, issueId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={`input-${input.id}`}>
        {input.label}
        {input.required && " (required)"}
      </label>
      {input.help && <p id={helpId}>{input.help}</p>}

      {input.kind === "text" &&
        (input.multiline ? (
          <textarea
            id={`input-${input.id}`}
            value={value}
            placeholder={placeholder}
            maxLength={input.maxLength}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            id={`input-${input.id}`}
            value={value}
            placeholder={placeholder}
            maxLength={input.maxLength}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
        ))}

      {input.kind === "number" && (
        <input
          id={`input-${input.id}`}
          type="number"
          value={value}
          placeholder={placeholder}
          min={input.min}
          max={input.max}
          step={input.step}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {input.kind === "seed" && (
        <input
          id={`input-${input.id}`}
          type="number"
          value={value}
          placeholder="Random"
          min={0}
          max={input.max ?? undefined}
          step={1}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {input.kind === "select" && input.options.length === 2 && (
        <label>
          <input
            type="checkbox"
            id={`input-${input.id}`}
            checked={value === input.options[1]?.id}
            aria-describedby={describedBy}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? (input.options[1]?.id ?? "")
                  : (input.options[0]?.id ?? ""),
              )
            }
          />
          {value === input.options[1]?.id
            ? input.options[1]?.label
            : (input.options[0]?.label ?? "")}
        </label>
      )}

      {input.kind === "select" && input.options.length !== 2 && (
        <select
          id={`input-${input.id}`}
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Use the Workflow's value</option>
          {input.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {issue && (
        <p id={issueId} role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}
