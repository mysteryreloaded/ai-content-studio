import type { WorkbenchInput } from "@ai-content-studio/shared";
import { Field, fieldDescribedBy } from "./Field.js";
import { NumberControl } from "./NumberControl.js";
import { SeedControl } from "./SeedControl.js";
import { SelectControl } from "./SelectControl.js";
import { TextControl } from "./TextControl.js";

interface InputFieldProps {
  input: WorkbenchInput;
  value: string;
  onChange: (value: string) => void;
  issue: string | undefined;
}

/**
 * One Input's field (issue #194): `Field` composed with its control. A
 * blank, optional Input shows the Workflow's own value as its
 * placeholder (issue #46). Used directly for text/number/seed/select
 * Inputs; the Model editor's `TestPanel` also renders this unchanged.
 */
export function InputField({ input, value, onChange, issue }: InputFieldProps) {
  const placeholder =
    input.placeholder === null ? undefined : String(input.placeholder);
  const describedBy = fieldDescribedBy(input.id, input.help, issue);
  const invalid = Boolean(issue);

  return (
    <Field
      id={input.id}
      label={input.label}
      optional={!input.required}
      help={input.help}
      error={issue}
    >
      {input.kind === "text" && (
        <TextControl
          id={input.id}
          input={input}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          describedBy={describedBy}
          invalid={invalid}
        />
      )}
      {input.kind === "number" && (
        <NumberControl
          id={input.id}
          input={input}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          describedBy={describedBy}
          invalid={invalid}
        />
      )}
      {input.kind === "seed" && (
        <SeedControl
          id={input.id}
          input={input}
          value={value}
          onChange={onChange}
          describedBy={describedBy}
          invalid={invalid}
        />
      )}
      {input.kind === "select" && (
        <SelectControl
          id={input.id}
          input={input}
          value={value}
          onChange={onChange}
          optional={!input.required}
          describedBy={describedBy}
          invalid={invalid}
        />
      )}
    </Field>
  );
}
