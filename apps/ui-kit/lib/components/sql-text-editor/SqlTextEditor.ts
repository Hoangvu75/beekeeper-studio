import { Extension } from "@codemirror/state";
import { TextEditor } from "../text-editor/TextEditor";
import { Entity } from "../types";
import { Dialect } from "sql-query-identifier";
import {
  applyDialect,
  applyEntities,
  extensions as sqlExtensions,
  SQLExtensionsConfig,
} from "./extensions";
import { ExtensionConfiguration } from "../text-editor/types";
import { Cassandra, MySQL, PostgreSQL, SQLite, StandardSQL } from "@codemirror/lang-sql";

export interface CompletionSource {
  defaultSchema?: string;
  entities: Entity[];
}

const langIdToDialect = {
  "text/x-sql": StandardSQL,
  "text/x-pgsql": PostgreSQL,
  "text/x-mysql": MySQL,
  "text/x-cassandra": Cassandra,
  "text/x-sqlite": SQLite,
};

export class SqlTextEditor extends TextEditor {
  private extensionsConfig: SQLExtensionsConfig;
  private completionSource: CompletionSource;

  constructor(extensionsConfig?: SQLExtensionsConfig){
    super();
    this.completionSource = { entities: [] };
    this.extensionsConfig = {
      identiferDialect: "generic",
      onQuerySelectionChange: () => {},
      // HACK: always turn on schema completion
      schema: {},
      ...extensionsConfig,
    };
  }

  // --- Public API ---

  /**
   * Sets the completion source with entities and schema information
   */
  setCompletionSource(completionSource: CompletionSource) {
    this.completionSource = completionSource;
    applyEntities(
      this.view,
      completionSource.entities,
      completionSource.defaultSchema
    );
  }

  setQueryIdentifierDialect(dialect: Dialect) {
    applyDialect(this.view, dialect);
  }

  // --- Editor Setup ---

  /**
   * Get base extensions for the editor
   */
  protected getExtensions(config: ExtensionConfiguration): Extension[] {
    const baseExtensions = super.getExtensions(config);
    return [
      baseExtensions,
      sqlExtensions({
        ...this.extensionsConfig,
        entitiesGetter: () => this.completionSource.entities || [],
        defaultSchemaGetter: () => this.completionSource.defaultSchema,
        dialect: langIdToDialect[config.languageId] || StandardSQL,
      }),
    ];
  }
}
