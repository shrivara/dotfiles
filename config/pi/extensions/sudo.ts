import { spawn } from "node:child_process";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_OUTPUT_BYTES = 50 * 1024;

type SudoResult = {
  stdout: string;
  stderr: string;
  code: number;
  termination?: "cancelled" | "timed out";
  truncated: boolean;
};

type OutputCapture = {
  stdout: string;
  stderr: string;
  bytes: number;
  truncated: boolean;
};

class SudoPasswordPrompt implements Component, Focusable {
  focused = false;
  private password = "";

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (password: string | undefined) => void,
    private readonly command: string,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      const password = this.password;
      this.password = "";
      this.done(password);
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.password = "";
      this.done(undefined);
      return;
    }

    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      this.password = Array.from(this.password).slice(0, -1).join("");
    } else {
      const decoded = decodeKittyPrintable(data);
      if (decoded !== undefined) {
        this.password += decoded;
      } else if (!/[\x00-\x1f\x7f]/.test(data)) {
        this.password += data;
      }
    }

    this.tui.requestRender();
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    const line = (text: string) => truncateToWidth(text, width);
    const command = this.command.replace(/[\r\n\t]+/g, " ");
    const bullets = "•".repeat(Array.from(this.password).length);

    return [
      line(this.theme.fg("accent", this.theme.bold("sudo password required"))),
      line(this.theme.fg("muted", `Command: ${command}`)),
      line(`Password: ${bullets}${this.focused ? CURSOR_MARKER : ""}`),
      line(this.theme.fg("dim", "Enter to run · Esc to cancel")),
    ];
  }

  invalidate(): void {}
}

function appendOutput(
  capture: OutputCapture,
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void {
  const remaining = Math.max(0, MAX_OUTPUT_BYTES - capture.bytes);
  const accepted = chunk.subarray(0, remaining);

  capture[stream] += accepted.toString("utf8");
  capture.bytes += accepted.length;
  if (accepted.length < chunk.length) capture.truncated = true;
}

async function runSudo(
  command: string,
  password: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SudoResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sudo",
      ["-S", "-p", "", "--", "/bin/sh", "-c", command],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    const capture: OutputCapture = {
      stdout: "",
      stderr: "",
      bytes: 0,
      truncated: false,
    };
    let termination: SudoResult["termination"];

    const stop = (reason: NonNullable<SudoResult["termination"]>) => {
      if (child.exitCode !== null || termination) return;
      termination = reason;
      child.kill("SIGTERM");
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timed out"), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (data: Buffer) => appendOutput(capture, "stdout", data));
    child.stderr.on("data", (data: Buffer) => appendOutput(capture, "stderr", data));
    child.stdin.on("error", () => {}); // The child may exit before consuming input.
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({
        stdout: capture.stdout,
        stderr: capture.stderr,
        code: code ?? 1,
        termination,
        truncated: capture.truncated,
      });
    });

    const input = Buffer.from(`${password}\n`, "utf8");
    password = "";
    child.stdin.end(input, () => input.fill(0));
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "sudo",
    label: "Sudo",
    description:
      "Run a shell command with administrator privileges after securely prompting the user for their sudo password. Output is capped at 50KB.",
    promptSnippet:
      "Run an administrator command after securely prompting for the user's sudo password",
    promptGuidelines: [
      "Use the sudo tool for commands that require administrator privileges; never put a password in a command or tool argument.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run as administrator" }),
      timeout: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 300,
          description: "Timeout in seconds (default 120)",
        }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        throw new Error("sudo password prompting requires Pi's interactive TUI.");
      }

      const password = await ctx.ui.custom<string | undefined>(
        (tui, theme, _keybindings, done) =>
          new SudoPasswordPrompt(tui, theme, done, params.command),
      );
      if (password === undefined) {
        return {
          content: [{ type: "text", text: "Cancelled: no sudo password entered." }],
          details: { cancelled: true },
        };
      }

      const result = await runSudo(
        params.command,
        password,
        ctx.cwd,
        (params.timeout ?? 120) * 1_000,
        signal,
      );
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const suffix = result.termination ? ` (${result.termination})` : "";
      const truncation = result.truncated ? "\n[Output truncated at 50KB]" : "";

      return {
        content: [
          {
            type: "text",
            text: `sudo exited with code ${result.code}${suffix}${output ? `\n${output}` : ""}${truncation}`,
          },
        ],
        details: {
          code: result.code,
          termination: result.termination,
          truncated: result.truncated,
        },
      };
    },
  });
}
