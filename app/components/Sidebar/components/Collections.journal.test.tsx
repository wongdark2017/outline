import { isJournalSystemCollection } from "./isJournalSystemCollection";

describe("isJournalSystemCollection", () => {
  it("identifies marked Journal system collections", () => {
    expect(
      isJournalSystemCollection({
        sourceMetadata: {
          externalId: "outline:journal",
          externalName: "Journal",
        },
      })
    ).toEqual(true);
  });

  it("does not hide historical same-name collections without the marker", () => {
    expect(
      isJournalSystemCollection({
        sourceMetadata: null,
      })
    ).toEqual(false);
  });

  it("does not hide regular external collections", () => {
    expect(
      isJournalSystemCollection({
        sourceMetadata: {
          externalId: "linear",
          externalName: "Linear",
        },
      })
    ).toEqual(false);
  });
});
