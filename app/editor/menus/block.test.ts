import { t } from "i18next";
import { createRef } from "react";
import Desktop from "~/utils/Desktop";
import blockMenuItems from "./block";

afterEach(() => vi.restoreAllMocks());

describe("TikZ block menu entry", () => {
  it("follows diagrams.net in the browser", () => {
    vi.spyOn(Desktop, "isElectron").mockReturnValue(false);
    const items = blockMenuItems(t, createRef<HTMLDivElement>());
    const diagramIndex = items.findIndex((item) => item.name === "editDiagram");

    expect(diagramIndex).toBeGreaterThanOrEqual(0);
    expect(items[diagramIndex + 1].name).toBe("insertTikz");
  });

  it("remains available when Electron excludes diagrams.net", () => {
    vi.spyOn(Desktop, "isElectron").mockReturnValue(true);
    const items = blockMenuItems(t, createRef<HTMLDivElement>());

    expect(items.some((item) => item.name === "editDiagram")).toBe(false);
    expect(items.some((item) => item.name === "insertTikz")).toBe(true);
  });
});
