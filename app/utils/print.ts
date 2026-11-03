import { prepareMathForPrint } from "@shared/editor/extensions/Math";

/**
 * Opens the print dialog after formula fonts and menu updates are ready.
 *
 * @returns a promise that resolves after the print dialog closes.
 */
export async function printPage(): Promise<void> {
  await prepareMathForPrint(document);
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.print();
}
