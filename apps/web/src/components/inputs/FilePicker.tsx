import { type ReactNode, useRef, useState } from "react";

/**
 * The drop zone + hidden file input behind an Upload Input (issue
 * #197): drag-over highlights it, a drop or a pick both call `onPick`.
 * The native input stays in the DOM `sr-only` (not `hidden`), so `Field`'s
 * label still points at it and `getByLabelText` + `userEvent.upload`
 * keep working from a test; `children` gets the opener for its own
 * "Choose …" button or icon.
 */
export function FilePicker({
  id,
  accept,
  onPick,
  className,
  invalid,
  describedBy,
  children,
}: {
  id: string;
  accept: string;
  onPick: (file: File) => void;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  children: (open: () => void) => ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      data-over={over}
      aria-invalid={invalid}
      className={className}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) onPick(file);
      }}
    >
      <input
        ref={inputRef}
        id={`input-${id}`}
        type="file"
        accept={accept}
        required
        tabIndex={-1}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
      {children(() => inputRef.current?.click())}
    </div>
  );
}
