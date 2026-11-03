import { prepareMathForPrint } from "@shared/editor/extensions/Math";
import { printPage } from "./print";

vi.mock("@shared/editor/extensions/Math", () => ({
  prepareMathForPrint: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printPage", () => {
  it("waits for formula styles and fonts before opening the print dialog", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(prepareMathForPrint).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const result = printPage();

    expect(prepareMathForPrint).toHaveBeenCalledWith(document);
    expect(print).not.toHaveBeenCalled();
    finish();
    await result;
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("does not print incomplete output if preparation fails", async () => {
    vi.mocked(prepareMathForPrint).mockRejectedValueOnce(
      new Error("Font load failed")
    );
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

    await expect(printPage()).rejects.toThrow("Font load failed");
    expect(print).not.toHaveBeenCalled();
  });
});
