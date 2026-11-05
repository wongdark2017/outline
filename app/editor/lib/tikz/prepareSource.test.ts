import { describeTexError, prepareSource } from "./prepareSource";

describe("prepareSource", () => {
  it("wraps a snippet and moves multiline declarations into the preamble", () => {
    const source = String.raw`\usepackage{
  pgfplots, % a supported package
  amsmath
}
\usetikzlibrary{calc, angles}
\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    const result = prepareSource(source);
    expect(result.info).toMatchObject({
      isDocument: false,
      packages: ["pgfplots", "amsmath"],
      libraries: ["calc", "angles"],
      skippedPackages: [],
    });
    expect(result.tex).toMatch(
      /^\\usepackage\{pgfplots,amsmath\}\n\\usetikzlibrary\{calc,angles\}\n\\begin\{document\}/
    );
    expect(result.tex).toContain(String.raw`\draw (0,0) -- (1,1);`);
    expect(result.tex).toMatch(/\\end\{document\}$/);
  });

  it("preserves standalone border without losing code beside the document class", () => {
    const source = String.raw`\documentclass[tikz,border={2pt 3pt 4pt 5pt}]{standalone}\usetikzlibrary{calc}
\begin{document}\begin{tikzpicture}\node {中文};\end{tikzpicture}\end{document}`;
    const { tex, info } = prepareSource(source);
    expect(info).toMatchObject({
      isDocument: true,
      documentClass: "standalone",
      border: "{2pt 3pt 4pt 5pt}",
      libraries: ["calc"],
      hasWideChars: true,
    });
    expect(tex).toMatch(/^\\standaloneconfig\{border=\{2pt 3pt 4pt 5pt\}\}/);
    expect(tex).not.toContain("\\documentclass");
    expect(tex).toContain("\\usetikzlibrary{calc}");
    expect(tex).toContain("\\node {中文}");
  });

  it("recognizes margin only for standalone documents", () => {
    expect(
      prepareSource(String.raw`\documentclass[margin=5mm]{standalone}`).info
        .border
    ).toBe("5mm");
    expect(
      prepareSource(String.raw`\documentclass[border=5mm]{article}`).info.border
    ).toBeUndefined();
  });

  it("removes unsupported font setup while preserving adjacent commands and CJK contents", () => {
    const source = String.raw`\usepackage[UTF8]{ctex}
\usepackage{amsmath,xeCJK,CJK}
\setCJKmainfont[
  BoldFont={SimHei}
]{SimSun}\def\answer{42}
\ctexset{section={format={\bfseries}}}
\begin{document}
\begin{CJK*}{UTF8}{gbsn}中文内容\end{CJK*}
\end{document}`;
    const { tex, info } = prepareSource(source);
    expect(info.skippedPackages).toEqual(["ctex", "xeCJK", "CJK"]);
    expect(info.packages).toEqual(["amsmath"]);
    expect(tex).toContain("\\usepackage{amsmath}");
    expect(tex).not.toMatch(/setCJKmainfont|ctexset|SimSun|gbsn|CJK\*/);
    expect(tex).toContain("\\def\\answer{42}");
    expect(tex).toContain("中文内容");
  });

  it("removes both arguments of CJK family font setup", () => {
    const { tex } =
      prepareSource(String.raw`\setCJKfamilyfont{song}[BoldFont=SimHei]{SimSun}
\begin{tikzpicture}\node {测试};\end{tikzpicture}`);
    expect(tex).not.toMatch(/song|BoldFont|SimSun/);
    expect(tex).toContain("\\node {测试}");
  });

  it("drops preloaded packages without dropping other requested packages", () => {
    const { tex, info } =
      prepareSource(String.raw`\usepackage[dvipsnames]{xcolor}
\usepackage{tikz,pgf,pgfplots}
\begin{document}\end{document}`);
    expect(tex).not.toContain("dvipsnames");
    expect(tex).not.toContain("\\usepackage{tikz");
    expect(tex).toContain("\\usepackage{pgfplots}");
    expect(info.packages).toEqual(["xcolor", "tikz", "pgf", "pgfplots"]);
  });

  it("ignores declarations in comments and verbatim text", () => {
    const source = String.raw`% \begin{document}\usepackage{ctex}
\verb|\usepackage{fontspec}| % \usetikzlibrary{external}
\begin{verbatim}
\usepackage{xeCJK}
\end{verbatim}
\node {50\%}; % \usepackage{CJK}
\usetikzlibrary{calc,calc}`;
    const { tex, info } = prepareSource(source);
    expect(info.isDocument).toBe(false);
    expect(info.skippedPackages).toEqual([]);
    expect(info.packages).toEqual([]);
    expect(info.libraries).toEqual(["calc"]);
    expect(tex).toContain("\\verb|\\usepackage{fontspec}|");
    expect(tex).toContain("\\node {50\\%}");
  });

  it("recognizes a comment after an escaped backslash and tolerates incomplete input", () => {
    const result = prepareSource(String.raw`\\% \usepackage{ctex}
\usepackage{unfinished
\begin{tikzpicture}`);
    expect(result.info.skippedPackages).toEqual([]);
    expect(result.tex).toContain("\\usepackage{unfinished");
  });

  it("removes comment commands without changing percent-newline semantics", () => {
    const source = String.raw`\begin{tikzpicture}
\def\label{A% \documentclass{standalone}
B}
\node {\label}; % \documentclass would make the worker drop this node
\node {50\%};
\end{tikzpicture}`;
    const { tex } = prepareSource(source);
    expect(tex).not.toContain("\\documentclass");
    expect(tex).toContain("\\def\\label{A%\nB}");
    expect(tex).toContain("\\node {\\label}; %\n");
    expect(tex).toContain("\\node {50\\%};");
  });
});

describe("describeTexError", () => {
  it("maps a multiline package declaration to its original first line", () => {
    const source = String.raw`% \usepackage{pgf-pie}
\documentclass{standalone}
\usepackage{
  amsmath,
  pgf-pie
}
\begin{document}\end{document}`;
    const error =
      "Compiler prefix\n! LaTeX Error: File `pgf-pie.sty' not found.\n\n! Emergency stop.\nl.29 \\begin\nignored suffix";
    expect(describeTexError(error, source)).toEqual({
      detail:
        "! LaTeX Error: File `pgf-pie.sty' not found.\n\n! Emergency stop.\nl.29 \\begin",
      missingPackage: "pgf-pie",
      line: 3,
    });
  });

  it("does not invent a source line for a transitive missing package", () => {
    expect(
      describeTexError(
        "! LaTeX Error: File `dependency.sty' not found.",
        "\\usepackage{parent}"
      )
    ).toMatchObject({
      missingPackage: "dependency",
      line: undefined,
    });
  });

  it("keeps non-TeX diagnostics unchanged", () => {
    expect(describeTexError("Network failed", "")).toEqual({
      detail: "Network failed",
    });
  });
});
