export const WORKBENCH_STYLE = `
.workbench-generate-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid currentColor;
}
.workbench-caps {
  margin-right: auto;
  opacity: 0.8;
  font-size: 0.9em;
}
@media (max-width: 640px) {
  .workbench-generate-bar {
    justify-content: space-between;
  }
}
`;
