import { sqlCompletionSource, sqlContextComplete } from "./sqlContextComplete";
import { sql, SQLConfig } from "./customSql";
import { removeQueryQuotesExtension } from "./removeQueryQuotes";
import { sqlHighlighter } from "./sqlHighlighter";
import { querySelection } from "./querySelection";
import { Entity } from "../../types";
import type { QuerySelectionChangeParams } from "./querySelection";
import { Options } from "sql-query-identifier";
import {
  EntityNavigationParams,
  tableNavigationExtension,
} from "./tableNavigation";

export { applyEntities } from "./customSql";
export { applyDialect } from "./removeQueryQuotes";
export { type ColumnsGetter } from "./sqlContextComplete";
export type { QuerySelectionChangeParams };
export type { EntityNavigationParams };

export type SQLExtensionsConfig = SQLConfig & {
  identiferDialect?: Options["dialect"];
  paramTypes?: Options["paramTypes"];
  onQuerySelectionChange?: (params: QuerySelectionChangeParams) => void;
  onEntityNavigate?: (params: EntityNavigationParams) => void;
  entitiesGetter?: () => Entity[];
  defaultSchemaGetter?: () => string | undefined;
}

/**
 * Get all base SQL extensions
 */
export function extensions(config: SQLExtensionsConfig) {
  return [
    sql(config),
    sqlHighlighter,
    removeQueryQuotesExtension(),
    sqlContextComplete(),
    config.columnsGetter ? sqlCompletionSource(config.columnsGetter) : [],
    config.onEntityNavigate && config.entitiesGetter
      ? tableNavigationExtension({
          entitiesGetter: config.entitiesGetter,
          defaultSchemaGetter: config.defaultSchemaGetter,
          onNavigate: config.onEntityNavigate,
        })
      : [],
    querySelection(config.identiferDialect, config.paramTypes, config.onQuerySelectionChange),
  ];
}
