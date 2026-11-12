import React from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";

const output = document.getElementById("result");
const start = performance.now();
const elements = convertToExcalidrawElements([
  ...Array.from({ length: 99 }, (_, index) => ({
    type: "rectangle",
    x: (index % 10) * 55,
    y: Math.floor(index / 10) * 45,
    width: 40,
    height: 30,
  })),
  { type: "image", x: 550, y: 0, width: 20, height: 20, fileId: "file1" },
]);
const file = {
  id: "file1",
  mimeType: "image/png",
  dataURL:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ct8AAAAASUVORK5CYII=",
  created: Date.now(),
  lastRetrieved: Date.now(),
};
let completed = false;
createRoot(document.getElementById("canvas")).render(
  React.createElement(Excalidraw, {
    excalidrawAPI: (api) => {
      if (completed) {return;}
      completed = true;
      const ready = performance.now();
      setTimeout(() => {
        api.addFiles([file]);
        const beforePopulate = performance.now();
        api.updateScene({
          elements,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        const afterPopulate = performance.now();
        api.updateScene({ appState: { zoom: { value: 2 } } });
        const afterZoom = performance.now();
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "z",
            ctrlKey: true,
            bubbles: true,
          })
        );
        const afterUndoEvent = performance.now();
        output.textContent = JSON.stringify({
          readyMs: Math.round(ready - start),
          populateSyncMs: (afterPopulate - beforePopulate).toFixed(3),
          zoomSyncMs: (afterZoom - afterPopulate).toFixed(3),
          undoEventSyncMs: (afterUndoEvent - afterZoom).toFixed(3),
          elements: api.getSceneElements().length,
          files: Object.keys(api.getFiles()).length,
        });
      }, 50);
    },
  })
);
setTimeout(() => {
  if (output.textContent === "pending") {output.textContent = "timeout";}
}, 10000);
