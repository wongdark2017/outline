/** Versioned, same-origin path of the unmodified TikZJax distribution. */
export const TIKZJAX_PATH = "/static/tikzjax-e374921f";

/** Maximum duration of worker startup, engine loading, and compilation. */
export const RENDER_TIMEOUT_MS = 10_000;

/** Delay after the latest source change before compiling the preview. */
export const PREVIEW_DELAY_MS = 600;

/** Inert SVG metadata script type shared with siyuan-embed-tikz. */
export const TIKZ_SOURCE_TYPE = "text/x-tikz";

/** Initial source for a new diagram. */
export const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}
  \draw[->] (-0.5,0) -- (3,0) node[right] {$x$};
  \draw[->] (0,-0.5) -- (0,2) node[above] {$y$};
  \draw[thick, blue, domain=0:2.8]
    plot (\x, {sin(\x r) + 1});
\end{tikzpicture}`;
