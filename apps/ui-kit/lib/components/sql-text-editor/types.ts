import { TextEditorEventMap, TextEditorMenuContext } from "../text-editor";
import type { QuerySelectionChangeParams } from "./extensions";
import type { EntityNavigationParams } from "./extensions";

export interface SqlTextEditorEventMap extends TextEditorEventMap {
  "bks-query-selection-change": QuerySelectionChangeParams;
  "bks-entity-navigate": EntityNavigationParams;
}

export type SqlTextEditorMenuContext = TextEditorMenuContext & {
  selectedQuery: string;
}
