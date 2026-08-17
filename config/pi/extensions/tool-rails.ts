import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RailStatus = "pending" | "success" | "error";
type AnyToolDefinition = ToolDefinition<any, any, any>;
type DefinitionFactory = (cwd: string) => AnyToolDefinition;
type AnyRenderContext = Parameters<NonNullable<AnyToolDefinition["renderCall"]>>[2];

/** A status-colored, one-cell rail around an existing tool renderer. */
class ToolRail implements Component {
  constructor(
    private child: Component,
    private theme: Theme,
    private status: RailStatus,
  ) {}

  getChild(): Component {
    return this.child;
  }

  update(child: Component, theme: Theme, status: RailStatus): void {
    this.child = child;
    this.theme = theme;
    this.status = status;
  }

  render(width: number): string[] {
    if (width <= 2) return this.child.render(width);

    const lines = this.child.render(width - 2);
    if (lines.length === 0 || lines.every((line) => visibleWidth(line) === 0)) return [];

    const color = this.status === "pending" ? "warning" : this.status;
    const prefix = `${this.theme.fg(color, "▏")} `;
    return lines.map((line) => `${prefix}${truncateToWidth(line, width - 2, "")}`);
  }

  invalidate(): void {
    this.child.invalidate();
  }
}

function railStatus(context: { isPartial: boolean; isError: boolean }): RailStatus {
  if (context.isPartial) return "pending";
  return context.isError ? "error" : "success";
}

function renderWithRail(
  lastComponent: Component | undefined,
  theme: Theme,
  status: RailStatus,
  renderChild: (lastChild: Component | undefined) => Component,
): Component {
  const previousRail = lastComponent instanceof ToolRail ? lastComponent : undefined;
  const child = renderChild(previousRail?.getChild());

  if (previousRail) {
    previousRail.update(child, theme, status);
    return previousRail;
  }

  return new ToolRail(child, theme, status);
}

function childContext(
  context: AnyRenderContext,
  lastChild: Component | undefined,
): AnyRenderContext {
  return { ...context, lastComponent: lastChild };
}

/** Preserve built-in behavior and rendering, replacing only the outer shell. */
function withRail(factory: DefinitionFactory): AnyToolDefinition {
  const definitions = new Map<string, AnyToolDefinition>();
  const definitionFor = (cwd: string) => {
    let definition = definitions.get(cwd);
    if (!definition) {
      definition = factory(cwd);
      definitions.set(cwd, definition);
    }
    return definition;
  };

  const template = definitionFor(process.cwd());
  const originalCall = template.renderCall;
  const originalResult = template.renderResult;

  return {
    ...template,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return definitionFor(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      return renderWithRail(
        context.lastComponent,
        theme,
        railStatus(context),
        (lastChild) =>
          originalCall?.(args, theme, childContext(context, lastChild)) ??
          new Text(theme.fg("toolTitle", theme.bold(template.label)), 0, 0),
      );
    },
    renderResult(result, options, theme, context) {
      return renderWithRail(
        context.lastComponent,
        theme,
        railStatus(context),
        (lastChild) =>
          originalResult?.(result, options, theme, childContext(context, lastChild)) ??
          new Text("", 0, 0),
      );
    },
  };
}

export default function (pi: ExtensionAPI) {
  const factories: DefinitionFactory[] = [
    (cwd) => createReadToolDefinition(cwd),
    (cwd) => createBashToolDefinition(cwd),
    (cwd) => createEditToolDefinition(cwd),
    (cwd) => createWriteToolDefinition(cwd),
    (cwd) => createGrepToolDefinition(cwd),
    (cwd) => createFindToolDefinition(cwd),
    (cwd) => createLsToolDefinition(cwd),
  ];

  for (const factory of factories) pi.registerTool(withRail(factory));
}
