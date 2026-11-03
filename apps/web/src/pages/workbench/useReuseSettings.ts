import {
  type GenerationInputSetting,
  encodePointsValue,
  resolvePointsFractions,
} from "@ai-content-studio/shared";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { WorkbenchMode, WorkbenchModel } from "./types.js";

export function useReuseSettings({
  model,
  reuseGenerationId,
  selectMode,
  setValues,
  setReuseNotice,
  searchParams,
  setSearchParams,
}: {
  model: WorkbenchModel | null;
  reuseGenerationId: string | null;
  selectMode: (mode: WorkbenchMode) => void;
  setValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  setReuseNotice: Dispatch<SetStateAction<string | null>>;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  // "Reuse these settings" (issue #57's AC): `?reuse=<generationId>`
  // refills this Mode's form from a past Generation's own settings,
  // flagging whatever no longer fits the current revision and
  // clearing a gone Upload with a note, rather than guessing at it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `searchParams`/`setSearchParams` deliberately excluded — this only ever runs off `reuseGenerationId` itself, and re-running it because its own cleanup just changed `searchParams` would loop.
  useEffect(() => {
    if (!model || !reuseGenerationId) return;
    let cancelled = false;

    fetch(`/api/generations/${reuseGenerationId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{
          modelId: string;
          modelDeleted: boolean;
          modeId: string;
          removedAt: string | null;
          settings: GenerationInputSetting[];
        }>;
      })
      .then((detail) => {
        if (cancelled) return;
        if (detail.removedAt) {
          setReuseNotice(
            "That Generation was removed by an administrator; its settings can't be reused.",
          );
          return;
        }
        if (detail.modelDeleted || detail.modelId !== model.id) {
          setReuseNotice("That Generation's Model can't be reused.");
          return;
        }
        const targetMode =
          model.modes.find((mode) => mode.id === detail.modeId) ?? null;
        if (!targetMode) {
          setReuseNotice(
            "That Generation's Mode no longer exists; pick a Mode and settings yourself.",
          );
          return;
        }
        selectMode(targetMode);

        const reused: Record<string, string> = {};
        const dropped: string[] = [];
        const pointsSettings: Array<
          Extract<GenerationInputSetting, { kind: "points" }>
        > = [];
        for (const setting of detail.settings) {
          const input = targetMode.inputs.find((i) => i.id === setting.inputId);
          if (!input) {
            dropped.push(`${setting.label} (no longer on this Mode)`);
            continue;
          }
          if (setting.kind === "points") {
            // Deferred: whether its points carry over depends on
            // whether the Video Upload it was drawn on is reused too.
            pointsSettings.push(setting);
            continue;
          }
          if (setting.kind === "upload") {
            if (setting.upload) reused[input.id] = setting.upload.id;
            else dropped.push(`${setting.label} (its Upload is gone)`);
            continue;
          }
          reused[input.id] = String(setting.value);
        }
        for (const setting of pointsSettings) {
          const input = targetMode.inputs.find((i) => i.id === setting.inputId);
          const videoSetting =
            input?.kind === "points"
              ? detail.settings.find(
                  (
                    s,
                  ): s is Extract<GenerationInputSetting, { kind: "upload" }> =>
                    s.kind === "upload" && s.inputId === input.videoInputId,
                )
              : undefined;
          if (
            input?.kind === "points" &&
            reused[input.videoInputId] &&
            videoSetting?.upload?.width &&
            videoSetting.upload.height &&
            setting.frameWidth !== null &&
            setting.frameHeight !== null
          ) {
            const fractions = resolvePointsFractions(
              setting.points,
              videoSetting.upload.width,
              videoSetting.upload.height,
              setting.frameWidth,
              setting.frameHeight,
            );
            reused[input.id] = encodePointsValue(fractions);
          } else {
            dropped.push(`${setting.label} (redraw the points)`);
          }
        }
        setValues((current) => ({ ...current, ...reused }));
        setReuseNotice(
          dropped.length === 0
            ? "Reused that Generation's settings."
            : `Reused that Generation's settings. Not carried over: ${dropped.join(", ")}.`,
        );
      })
      .catch(() => {
        if (!cancelled) setReuseNotice("Could not reuse that Generation.");
      })
      .finally(() => {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete("reuse");
          setSearchParams(next, { replace: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [model, reuseGenerationId, selectMode]);
}
