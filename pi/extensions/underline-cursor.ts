import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Replaces Pi's inverse-video fake cursor with a rendered underscore.
 * This avoids terminal text attributes, which can leave visual artifacts in
 * terminals with differential repainting.
 */
class UnderlineCursorEditor extends CustomEditor {
  render(width: number): string[] {
    return super.render(width).map((line) =>
      line.replace(/\x1b\[7m([\s\S]*?)\x1b\[0m/g, (_match, grapheme: string) =>
        // At end-of-line Pi highlights a space: render a literal underscore.
        // On a character, a combining low line preserves that character.
        grapheme === " " ? "_" : `${grapheme}\u0332`,
      ),
    );
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      tui.setShowHardwareCursor(false);
      return new UnderlineCursorEditor(tui, theme, keybindings);
    });
  });
}
