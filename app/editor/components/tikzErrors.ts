import type { TFunction } from "i18next";
import type { TikzSessionError } from "../extensions/TikzSession";
import { RENDER_TIMEOUT_MS } from "../lib/tikz/constants";
import type { TexProblem } from "../lib/tikz/prepareSource";
import type { RenderFailure } from "../lib/tikz/renderTikz";

/**
 * Selects fixed application copy without exposing browser or upload errors.
 * Specific compiler diagnostics take precedence over the generic failure.
 *
 * @param t - translates the application source phrase.
 * @param sessionError - a source-loading or attachment failure.
 * @param renderError - the categorized compilation failure.
 * @param problem - relevant TeX details and the original package location.
 * @returns the localized fixed message, or undefined when no error is active.
 */
export function getTikzErrorMessage(
  t: TFunction,
  sessionError?: TikzSessionError,
  renderError?: RenderFailure,
  problem?: TexProblem
): string | undefined {
  if (sessionError === "source") {
    return t(
      "The diagram source could not be loaded. The original image is unchanged. Try opening it again later."
    );
  }
  if (sessionError === "metadata") {
    return t(
      "This image does not contain editable TikZ source. The original image is unchanged."
    );
  }
  if (sessionError === "save") {
    return t(
      "The diagram could not be saved. Your code and preview are preserved."
    );
  }
  if (!renderError || renderError.reason === "aborted") {
    return undefined;
  }
  if (renderError.reason === "timeout") {
    return t(
      "Rendering timed out after {{seconds}} seconds. Simplify the code and try again.",
      { seconds: RENDER_TIMEOUT_MS / 1000 }
    );
  }
  if (renderError.reason === "engine") {
    return t(
      "The rendering engine could not be loaded. Your code is preserved. Check your network connection."
    );
  }
  if (renderError.reason === "invalid-svg") {
    return t("No valid diagram was generated. Check the code and try again.");
  }
  if (problem?.missingPackage) {
    return problem.line
      ? t(
          "Line {{line}} uses the {{name}} package, which is not available in the renderer. Remove the declaration or use a supported TikZ library.",
          { line: problem.line, name: problem.missingPackage }
        )
      : t(
          "The {{name}} package is not available in the renderer. Remove the declaration or use a supported TikZ library.",
          { name: problem.missingPackage }
        );
  }
  return t(
    "Diagram compilation failed. Update the code using the error details below."
  );
}
