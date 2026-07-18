import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CURSOR_MARKER, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const MAX_OUTPUT_BYTES = 50 * 1024;

class SudoPasswordPrompt {
	focused = false;
	private password = "";

	constructor(
		private readonly tui: { requestRender(): void },
		private readonly theme: any,
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
		} else if (!data.includes("\u001b") && !/[\r\n]/.test(data)) {
			this.password += data;
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const line = (text: string) => truncateToWidth(text, width);
		const bullets = "•".repeat(Array.from(this.password).length);
		return [
			line(this.theme.fg("accent", this.theme.bold("sudo password required"))),
			line(this.theme.fg("muted", `Command: ${this.command}`)),
			line(`Password: ${bullets}${this.focused ? CURSOR_MARKER : ""}`),
			line(this.theme.fg("dim", "Enter to run · Esc to cancel")),
		];
	}

	invalidate(): void {}
}

function appendCapped(current: string, chunk: string): string {
	if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current;
	const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current);
	return current + Buffer.from(chunk).subarray(0, remaining).toString();
}

async function runSudo(command: string, password: string, cwd: string, timeout: number, signal?: AbortSignal) {
	return new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve, reject) => {
		const child = spawn("/usr/bin/sudo", ["-S", "-p", "", "--", "/bin/sh", "-c", command], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let killed = false;
		const stop = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		const timer = setTimeout(stop, timeout);
		signal?.addEventListener("abort", stop, { once: true });
		child.stdout.on("data", (data) => { stdout = appendCapped(stdout, data.toString()); });
		child.stderr.on("data", (data) => { stderr = appendCapped(stderr, data.toString()); });
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
			resolve({ stdout, stderr, code: code ?? 1, killed });
		});

		child.stdin.write(`${password}\n`);
		password = "";
		child.stdin.end();
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "sudo",
		label: "Sudo",
		description: "Run a shell command with administrator privileges after securely prompting the user for their sudo password.",
		promptSnippet: "Run an administrator command after securely prompting for the user's sudo password",
		promptGuidelines: [
			"Use sudo for commands that require administrator privileges; never put a password in a command or tool argument.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run as administrator" }),
			timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300, description: "Timeout in seconds (default 120)" })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				throw new Error("sudo password prompting requires Pi's interactive TUI.");
			}
			const password = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) =>
				new SudoPasswordPrompt(tui, theme, done, params.command),
			);
			if (password === undefined) {
				return { content: [{ type: "text", text: "Cancelled: no sudo password entered." }], details: { cancelled: true } };
			}

			const result = await runSudo(params.command, password, ctx.cwd, (params.timeout ?? 120) * 1000, signal);
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
			const truncated = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES;
			return {
				content: [{
					type: "text",
					text: `sudo exited with code ${result.code}${result.killed ? " (cancelled or timed out)" : ""}${output ? `\n${output}` : ""}${truncated ? "\n[Output truncated at 50KB]" : ""}`,
				}],
				details: { code: result.code, killed: result.killed, truncated },
			};
		},
	});
}
