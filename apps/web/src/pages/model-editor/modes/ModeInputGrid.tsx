import { computeModePath, modeInputSetting } from "@ai-content-studio/shared";
import type {
  InputDefinition,
  ModeInputSetting,
  ModeInputState,
  Workflow,
} from "@ai-content-studio/shared";
import {
  boundNodeIds,
  visibleBoundFieldsFor,
  workflowForMode,
} from "../helpers/workflow.js";
import type { DraftMode } from "../types.js";
import { FixedValueEditor } from "./FixedValueEditor.js";

const MODE_INPUT_STATES: ModeInputState[] = [
  "hidden",
  "optional",
  "required",
  "fixed",
];

/**
 * The Mode × Input grid (issue #48): a row per Input, a column per Mode,
 * each cell holding that Mode's state for that Input (hidden, optional,
 * required, or fixed with a value) plus an optional Mode-specific label.
 * "Apply to every Mode whose Path holds this Input" copies a cell onto
 * every other Mode that could use it.
 */
export function ModeInputGrid({
  modes,
  inputs,
  workflow,
  onChange,
  onApplyToEveryEligibleMode,
}: {
  modes: DraftMode[];
  inputs: InputDefinition[];
  workflow: Workflow;
  onChange: (
    modeIndex: number,
    inputId: string,
    patch: Partial<ModeInputSetting>,
  ) => void;
  onApplyToEveryEligibleMode: (
    modeIndex: number,
    input: InputDefinition,
  ) => void;
}) {
  if (!inputs || inputs.length === 0) return null;

  return (
    <>
      <h4>Mode × Input grid</h4>
      <table>
        <thead>
          <tr>
            <th>Input</th>
            {modes.map((mode, i) => (
              <th key={mode.key}>{mode.name || `Mode ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inputs.map((input) => (
            <tr key={input.id}>
              <th scope="row">{input.label}</th>
              {modes.map((mode, modeIndex) => {
                const onPath =
                  mode.outputNodeIds.length > 0 &&
                  [...boundNodeIds(input)].some((id) =>
                    computeModePath(
                      workflowForMode(mode, inputs, workflow),
                      mode.outputNodeIds,
                      visibleBoundFieldsFor(mode, inputs),
                    ).nodeIds.has(id),
                  );
                const setting = modeInputSetting(mode.inputSettings, input.id);
                return (
                  <td
                    key={mode.key}
                    style={!onPath ? { opacity: 0.4 } : undefined}
                  >
                    <label>
                      State
                      <select
                        value={setting.state}
                        onChange={(event) =>
                          onChange(modeIndex, input.id, {
                            state: event.target.value as ModeInputState,
                            fixedValue:
                              event.target.value === "fixed"
                                ? setting.fixedValue
                                : null,
                          })
                        }
                      >
                        {MODE_INPUT_STATES
                          // ADR 0007: a Seed can't be fixed, or every
                          // Submission would draw the same one. An
                          // Image/Video/Audio Upload always takes a
                          // real Upload id (issue #48 CEO review, issue
                          // #51), so none of them can be fixed either.
                          // A Points Input always takes the user's own
                          // clicks (issue #52), same reasoning.
                          .filter(
                            (state) =>
                              state !== "fixed" ||
                              (input.kind !== "seed" &&
                                input.kind !== "image_upload" &&
                                input.kind !== "video_upload" &&
                                input.kind !== "audio_upload" &&
                                input.kind !== "points"),
                          )
                          .map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                      </select>
                    </label>

                    {setting.state === "fixed" && (
                      <FixedValueEditor
                        input={input}
                        value={setting.fixedValue}
                        onChange={(fixedValue) =>
                          onChange(modeIndex, input.id, { fixedValue })
                        }
                      />
                    )}

                    <label>
                      Mode label
                      <input
                        value={setting.label}
                        placeholder={input.label}
                        maxLength={60}
                        onChange={(event) =>
                          onChange(modeIndex, input.id, {
                            label: event.target.value,
                          })
                        }
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        onApplyToEveryEligibleMode(modeIndex, input)
                      }
                    >
                      Apply to every Mode whose Path holds this Input
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
