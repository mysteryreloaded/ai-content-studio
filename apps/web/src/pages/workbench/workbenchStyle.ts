export const WORKBENCH_STYLE = `
.workbench-asset {
  display: block;
  max-width: 100%;
  margin-top: 0.25rem;
}
.workbench-progress {
  opacity: 0.8;
}
.workbench-thumb {
  max-width: 160px;
  max-height: 160px;
  vertical-align: middle;
}
.workbench-download {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
}
.workbench-ai-reminder {
  opacity: 0.7;
}
.workbench-layout {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
}
.workbench-form {
  flex: 1;
  min-width: 0;
}
.workbench-submissions {
  width: 320px;
  flex-shrink: 0;
}
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
  .workbench-layout {
    flex-direction: column;
  }
  .workbench-submissions {
    width: auto;
  }
  .workbench-generate-bar {
    justify-content: space-between;
  }
}
`;
