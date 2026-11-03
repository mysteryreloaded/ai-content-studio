/** Issue #68: an Admin removed this Generation — shown as a dismissable card, same as the Gallery's. */
export function RemovedCard() {
  return (
    <li>
      <span role="alert">Removed by an administrator</span>
    </li>
  );
}
