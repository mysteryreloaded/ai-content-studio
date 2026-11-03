export function CountPicker({
  count,
  onChange,
}: {
  count: number;
  onChange: (count: number) => void;
}) {
  return (
    <fieldset>
      <legend>Variants</legend>
      <label htmlFor="submission-count">How many (1-4)</label>
      <select
        id="submission-count"
        value={count}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[1, 2, 3, 4].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </fieldset>
  );
}
