import {
  WORKER_CLI_HELP_TOPIC_NAMES,
  workerHelpTopic,
} from "./standing-protocol.ts";
import { cliError, renderWorkerCliError } from "./worker-cli-error.ts";

const MESSAGE_POST_HELP = `"$RAH_WORKER_CLI" worker message-post [--turn HANDLE] --target TARGET [--final | --progress] < message.txt
"$RAH_WORKER_CLI" worker message-post [--turn HANDLE] --send-draft --target TARGET
"$RAH_WORKER_CLI" worker message-post [--turn HANDLE] --revise-draft DRAFT --target TARGET < revised.txt
Publishing alone does not end execution. Use final only after completing current work.
Draft revision retains its saved confirmation and final/progress intent; do not add overrides.
In a warm runtime, --turn HANDLE is required: use the current wake's handle.
More: "$RAH_WORKER_CLI" worker help messages-advanced
`;

/** Static documentation never opens a turn, reads stdin or performs a request. */
export function staticWorkerCommandHelp(
  arguments_: readonly string[],
  runtime: {
    stdout: { write(value: string): unknown };
    stderr: { write(value: string): unknown };
  },
  help: () => string,
): 0 | 1 | undefined {
  if (
    arguments_[0] === "worker" &&
    !["help", "--help"].includes(arguments_[1] ?? "") &&
    arguments_.includes("--help")
  ) {
    const options = [...arguments_.slice(2)];
    const turn = options.indexOf("--turn");
    if (turn >= 0 && options[turn + 1] && !options[turn + 1]!.startsWith("--"))
      options.splice(turn, 2);
    if (
      arguments_[1] === "message-post" &&
      options.length === 1 &&
      options[0] === "--help"
    ) {
      runtime.stdout.write(MESSAGE_POST_HELP);
      return 0;
    }
    renderWorkerCliError(
      runtime.stderr,
      cliError(
        "INVALID_ARG",
        "Use worker message-post --help [--turn HANDLE] without business options, or worker help <topic>.",
      ),
    );
    return 1;
  }
  // Static documentation has no execution scope. Accept the wake's uniform
  // --turn option without opening credentials (including an expired turn).
  if (
    arguments_[0] === "worker" &&
    ["help", "--help"].includes(arguments_[1] ?? "")
  ) {
    const index = arguments_.indexOf("--turn");
    if (
      index >= 2 &&
      arguments_[index + 1] !== undefined &&
      !arguments_[index + 1]!.startsWith("--")
    )
      arguments_ = [
        ...arguments_.slice(0, index),
        ...arguments_.slice(index + 2),
      ];
  }
  if (
    (arguments_.length === 3 &&
      arguments_[0] === "agent" &&
      arguments_[1] === "inbox" &&
      ["help", "--help"].includes(arguments_[2]!)) ||
    (arguments_.length === 2 &&
      arguments_[0] === "worker" &&
      (arguments_[1] === "help" || arguments_[1] === "--help")) ||
    (arguments_.length === 2 &&
      arguments_[0] === "reminder" &&
      (arguments_[1] === "help" || arguments_[1] === "--help")) ||
    (arguments_.length === 1 && arguments_[0] === "--help")
  ) {
    runtime.stdout.write(help());
    return 0;
  }
  // S1-c: detail that no longer rides in the standing prompt is served here.
  if (
    arguments_.length === 3 &&
    arguments_[0] === "worker" &&
    arguments_[1] === "help"
  ) {
    const topic = workerHelpTopic(arguments_[2]!);
    if (topic === undefined) {
      renderWorkerCliError(
        runtime.stderr,
        cliError(
          "INVALID_ARG",
          `Unknown help topic '${arguments_[2]!}'. Topics: ${WORKER_CLI_HELP_TOPIC_NAMES.join(", ")}.`,
        ),
      );
      return 1;
    }
    runtime.stdout.write(`${topic}\n`);
    return 0;
  }
  return undefined;
}
