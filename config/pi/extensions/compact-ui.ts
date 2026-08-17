import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const EDITOR_BORDER = /^─+$/;
const EDITOR_SCROLL_BORDER = /^─── [↑↓] \d+ more ─*$/;

type LayoutNode = {
  entries?: Array<{ component?: LayoutNode; minSize?: number }>;
};

type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

/**
 * Fullscreen currently reserves three rows for Pi's bordered editor. A
 * borderless editor needs only one. This feature-detected compatibility shim
 * is deliberately isolated so a future Pi layout change safely becomes a
 * no-op instead of breaking startup.
 */
function compactFullscreenEditorSlot(tui: unknown): void {
  const fullscreen = tui as { mode?: string; layoutRoot?: LayoutNode };
  if (fullscreen.mode !== "fullscreen") return;

  const candidates = (fullscreen.layoutRoot?.entries ?? [])
    .flatMap((entry) => entry.component?.entries ?? [])
    .filter((entry) => entry.minSize === 3);

  if (candidates.length === 1) candidates[0]!.minSize = 1;
}

/** Remove editor rules and replace inverse-video cursors with an underline. */
class CompactEditor extends CustomEditor {
  private background: (text: string) => string = (text) => text;

  setBackground(background: (text: string) => string): void {
    this.background = background;
  }

  render(width: number): string[] {
    const lines = super.render(width);

    // The first row is always the editor's top rule or scroll rule.
    if (lines.length > 0) lines.shift();

    // Autocomplete rows follow the bottom rule, so search backwards for it.
    for (let index = lines.length - 1; index >= 0; index--) {
      const plain = stripTerminalSequences(lines[index] ?? "");
      if (EDITOR_BORDER.test(plain) || EDITOR_SCROLL_BORDER.test(plain)) {
        lines.splice(index, 1);
        break;
      }
    }

    return lines.map((line) =>
      this.background(
        line.replace(/\x1b\[7m([\s\S]*?)\x1b\[0m/g, (_match, grapheme: string) =>
          grapheme === " " ? "_" : `${grapheme}\u0332`,
        ),
      ),
    );
  }
}

function formatTokens(count: number): string {
  if (count < 1_000) return `${count}`;
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  if (!home) return cwd;

  const relativePath = relative(resolve(home), resolve(cwd));
  const insideHome =
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));

  if (!insideHome) return cwd;
  return relativePath === "" ? "~" : `~${sep}${relativePath}`;
}

function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
  if (!usage) return;
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

function collectUsage(ctx: ExtensionContext): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant" || entry.message.role === "toolResult") {
        addUsage(totals, entry.message.usage);
      }
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      addUsage(totals, entry.usage);
    }
  }

  return totals;
}

function sanitizeStatus(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function footerRight(ctx: ExtensionContext, theme: Theme): string {
  const totals = collectUsage(ctx);
  const separator = theme.fg("dim", " • ");
  const parts: string[] = [];

  if (ctx.model) {
    parts.push(theme.fg("dim", ctx.model.id));
    if (ctx.model.reasoning) parts.push(theme.fg("dim", ctx.thinkingLevel ?? "off"));
  } else {
    parts.push(theme.fg("dim", "no model"));
  }

  if (totals.input) parts.push(theme.fg("dim", `↑${formatTokens(totals.input)}`));
  if (totals.output) parts.push(theme.fg("dim", `↓${formatTokens(totals.output)}`));
  if (totals.cacheRead) parts.push(theme.fg("dim", `R${formatTokens(totals.cacheRead)}`));
  if (totals.cacheWrite) parts.push(theme.fg("dim", `W${formatTokens(totals.cacheWrite)}`));
  if (totals.cost) parts.push(theme.fg("dim", `$${totals.cost.toFixed(3)}`));

  const context = ctx.getContextUsage();
  const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow;
  if (contextWindow) {
    const percentage = context?.percent;
    const label = `${percentage === null || percentage === undefined ? "?" : percentage.toFixed(1)}%/${formatTokens(contextWindow)}`;
    const color = percentage !== null && percentage !== undefined && percentage > 90
      ? "error"
      : percentage !== null && percentage !== undefined && percentage > 70
        ? "warning"
        : "dim";
    parts.push(theme.fg(color, label));
  }

  return parts.join(separator);
}

function fitFooter(left: string, right: string, width: number, theme: Theme): string {
  if (width <= 0) return "";

  const leftLimit = Math.min(visibleWidth(left), Math.max(1, Math.floor(width * 0.35)));
  const fittedLeft = truncateToWidth(left, leftLimit, theme.fg("dim", "…"));
  const separator = fittedLeft && right ? theme.fg("dim", " • ") : "";
  const available = Math.max(0, width - visibleWidth(fittedLeft) - visibleWidth(separator));
  const fittedRight = available > 0
    ? truncateToWidth(right, available, theme.fg("dim", "…"))
    : "";
  const content = `${fittedLeft}${fittedRight ? separator : ""}${fittedRight}`;
  const fill = " ".repeat(Math.max(0, width - visibleWidth(content)));
  return theme.bg("userMessageBg", `${content}${fill}`);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setEditorComponent((tui, _theme, keybindings) => {
      tui.setShowHardwareCursor(false);
      compactFullscreenEditorSlot(tui);

      const editor = new CompactEditor(tui, _theme, keybindings, { paddingX: 0 });
      editor.setBackground((text) => ctx.ui.theme.bg("userMessageBg", text));
      return editor;
    });

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          if (width <= 0) return [];

          const branch = footerData.getGitBranch();
          const sessionName = ctx.sessionManager.getSessionName();
          let location = formatCwd(ctx.cwd);
          if (branch) location += ` (${branch})`;
          if (sessionName) location += ` • ${sessionName}`;

          const statusLines = Array.from(footerData.getExtensionStatuses().entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([, text]) => sanitizeStatus(text))
            .filter(Boolean)
            .map((line) => {
              const content = truncateToWidth(line, width, theme.fg("dim", "…"));
              const fill = " ".repeat(Math.max(0, width - visibleWidth(content)));
              return theme.bg("userMessageBg", `${content}${fill}`);
            });

          const left = theme.fg("dim", location);
          return [...statusLines, fitFooter(left, footerRight(ctx, theme), width, theme)];
        },
      };
    });
  });
}
