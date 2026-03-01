import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Entity, TableEntity } from "../../types";
import { isTableLikeEntity } from "../utils";

export type EntityNavigationParams = {
  entity: TableEntity;
  identifier: string;
};

type TableNavigationConfig = {
  entitiesGetter: () => Entity[];
  defaultSchemaGetter?: () => string | undefined;
  onNavigate?: (params: EntityNavigationParams) => void;
};

const IDENTIFIER_REGEX =
  /(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*))*/g;
const SEGMENT_REGEX = /"(?:[^"]|"")+"|[^.]+/g;

function normalizeIdentifierPart(input: string): string {
  const value = input.trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}

function equalsIdentifierPart(left: string, right: string): boolean {
  return left === right || left.toLowerCase() === right.toLowerCase();
}

function parseIdentifier(input: string): string[] {
  return (input.match(SEGMENT_REGEX) || [])
    .map(normalizeIdentifierPart)
    .filter(Boolean);
}

function findIdentifierAtPosition(
  view: EditorView,
  x: number,
  y: number
): string | null {
  const pos = view.posAtCoords({ x, y });
  if (pos == null) return null;

  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;

  IDENTIFIER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = IDENTIFIER_REGEX.exec(line.text))) {
    const from = match.index;
    const to = match.index + match[0].length;
    if (offset >= from && offset <= to) {
      return match[0];
    }
  }

  return null;
}

function findEntityFromIdentifier(
  identifier: string,
  entities: Entity[],
  defaultSchema?: string
): TableEntity | null {
  const candidates = entities.filter(isTableLikeEntity);
  if (!candidates.length) return null;

  const parts = parseIdentifier(identifier);
  if (!parts.length) return null;

  let tableName = parts[parts.length - 1];
  let schemaName: string | undefined;
  if (parts.length >= 2) {
    schemaName = parts[parts.length - 2];
  }

  if (schemaName) {
    return (
      candidates.find(
        (entity) =>
          equalsIdentifierPart(entity.name, tableName) &&
          !!entity.schema &&
          equalsIdentifierPart(entity.schema, schemaName)
      ) || null
    );
  }

  const byName = candidates.filter((entity) =>
    equalsIdentifierPart(entity.name, tableName)
  );
  if (!byName.length) return null;

  if (defaultSchema) {
    const inDefaultSchema = byName.find(
      (entity) =>
        !!entity.schema && equalsIdentifierPart(entity.schema, defaultSchema)
    );
    if (inDefaultSchema) return inDefaultSchema;
  }

  return byName.find((entity) => !entity.schema) || byName[0] || null;
}

export function tableNavigationExtension({
  entitiesGetter,
  defaultSchemaGetter,
  onNavigate,
}: TableNavigationConfig): Extension {
  let lastMouseCoords: { x: number; y: number } | null = null;
  let pointerActive = false;

  const clearPointer = (view: EditorView) => {
    if (!pointerActive) return;
    pointerActive = false;
    view.dom.style.cursor = "";
  };

  const setPointer = (view: EditorView) => {
    if (pointerActive) return;
    pointerActive = true;
    view.dom.style.cursor = "pointer";
  };

  const resolveTarget = (
    view: EditorView,
    x: number,
    y: number
  ): EntityNavigationParams | null => {
    const identifier = findIdentifierAtPosition(view, x, y);
    if (!identifier) return null;

    const entity = findEntityFromIdentifier(
      identifier,
      entitiesGetter(),
      defaultSchemaGetter?.()
    );
    if (!entity) return null;

    return { entity, identifier };
  };

  return EditorView.domEventHandlers({
    mousemove(event, view) {
      lastMouseCoords = { x: event.clientX, y: event.clientY };

      if (!(event.ctrlKey || event.metaKey)) {
        clearPointer(view);
        return false;
      }

      const target = resolveTarget(view, event.clientX, event.clientY);
      if (target) {
        setPointer(view);
      } else {
        clearPointer(view);
      }

      return false;
    },
    mouseleave(_event, view) {
      clearPointer(view);
      return false;
    },
    keydown(event, view) {
      if (!lastMouseCoords) return false;
      if (!(event.ctrlKey || event.metaKey)) return false;
      const target = resolveTarget(view, lastMouseCoords.x, lastMouseCoords.y);
      if (target) setPointer(view);
      return false;
    },
    keyup(event, view) {
      if (!lastMouseCoords) {
        clearPointer(view);
        return false;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        clearPointer(view);
        return false;
      }

      const target = resolveTarget(view, lastMouseCoords.x, lastMouseCoords.y);
      if (target) {
        setPointer(view);
      } else {
        clearPointer(view);
      }
      return false;
    },
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey)) return false;

      const target = resolveTarget(view, event.clientX, event.clientY);
      if (!target) return false;

      event.preventDefault();
      event.stopPropagation();
      onNavigate?.(target);
      return true;
    },
  });
}

