import { override } from "mobx";
import naturalSort from "@shared/utils/naturalSort";
import Theme from "~/models/Theme";
import type RootStore from "./RootStore";
import Store, { RPCAction } from "./base/Store";

export default class ThemesStore extends Store<Theme> {
  actions = [
    RPCAction.Info,
    RPCAction.List,
    RPCAction.Create,
    RPCAction.Update,
    RPCAction.Delete,
  ];

  constructor(rootStore: RootStore) {
    super(rootStore, Theme);
  }

  @override
  get orderedData(): Theme[] {
    return naturalSort(Array.from(this.data.values()), "name");
  }
}
