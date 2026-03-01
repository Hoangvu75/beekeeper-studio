import {
  Decoration,
  DecorationSet,
  EditorView,
} from "@codemirror/view";
import {
  Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
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
type IdentifierAtPosition = {
  identifier: string;
  from: number;
  to: number;
};
type Range = { from: number; to: number };
type ResolvedTarget = EntityNavigationParams & Range;

const IDENTIFIER_REGEX =
  /(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)(?:\.(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*))*/g;
const SEGMENT_REGEX = /"(?:[^"]|"")+"|[^.]+/g;
const setHoverRangeEffect = StateEffect.define<Range | null>();
const hoverMark = Decoration.mark({ class: "cm-bks-table-link" });
const hoverRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHoverRangeEffect)) {
        const range = effect.value;
        next = range
          ? Decoration.set([hoverMark.range(range.from, range.to)])
          : Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const hoverTheme = EditorView.baseTheme({
  ".cm-bks-table-link": {
    textDecoration: "underline",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "2px",
    textDecorationColor: "currentColor",
  },
  "&dark .cm-bks-table-link": {
    color: "#60a5fa",
  },
  "&light .cm-bks-table-link": {
    color: "#2563eb",
  },
});

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
): IdentifierAtPosition | null {
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
      return {
        identifier: match[0],
        from: line.from + from,
        to: line.from + to,
      };
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
  let activeHoverRange: Range | null = null;
  let pointerActive = false;

  const rangesEqual = (left: Range | null, right: Range | null): boolean => {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return left.from === right.from && left.to === right.to;
  };

  const updateHoverRange = (view: EditorView, range: Range | null) => {
    if (rangesEqual(activeHoverRange, range)) return;
    activeHoverRange = range;
    view.dispatch({ effects: setHoverRangeEffect.of(range) });
  };

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
  ): ResolvedTarget | null => {
    const identifierAtPosition = findIdentifierAtPosition(view, x, y);
    if (!identifierAtPosition) return null;

    const entity = findEntityFromIdentifier(
      identifierAtPosition.identifier,
      entitiesGetter(),
      defaultSchemaGetter?.()
    );
    if (!entity) return null;

    return {
      entity,
      identifier: identifierAtPosition.identifier,
      from: identifierAtPosition.from,
      to: identifierAtPosition.to,
    };
  };

  return [
    hoverRangeField,
    hoverTheme,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        lastMouseCoords = { x: event.clientX, y: event.clientY };

        if (!(event.ctrlKey || event.metaKey)) {
          clearPointer(view);
          updateHoverRange(view, null);
          return false;
        }

        const target = resolveTarget(view, event.clientX, event.clientY);
        if (target) {
          setPointer(view);
          updateHoverRange(view, { from: target.from, to: target.to });
        } else {
          clearPointer(view);
          updateHoverRange(view, null);
        }

        return false;
      },
      mouseleave(_event, view) {
        clearPointer(view);
        updateHoverRange(view, null);
        return false;
      },
      keydown(event, view) {
        if (!lastMouseCoords) return false;
        if (!(event.ctrlKey || event.metaKey)) return false;
        const target = resolveTarget(view, lastMouseCoords.x, lastMouseCoords.y);
        if (target) {
          setPointer(view);
          updateHoverRange(view, { from: target.from, to: target.to });
        }
        return false;
      },
      keyup(event, view) {
        if (!lastMouseCoords) {
          clearPointer(view);
          updateHoverRange(view, null);
          return false;
        }

        if (!(event.ctrlKey || event.metaKey)) {
          clearPointer(view);
          updateHoverRange(view, null);
          return false;
        }

        const target = resolveTarget(view, lastMouseCoords.x, lastMouseCoords.y);
        if (target) {
          setPointer(view);
          updateHoverRange(view, { from: target.from, to: target.to });
        } else {
          clearPointer(view);
          updateHoverRange(view, null);
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
    }),
  ];
}
