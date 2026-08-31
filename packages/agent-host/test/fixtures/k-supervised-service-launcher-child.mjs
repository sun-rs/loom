import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { NodeKCarrierSupervisedServiceLauncher } from "../../src/index.ts";

const configuration = JSON.parse(readFileSync(3, "utf8"));
const launcher = new NodeKCarrierSupervisedServiceLauncher({
  argumentPrefix: [configuration.serviceFixturePath],
  configurationPath: configuration.serviceConfigurationPath,
  stateDir: configuration.kStateDir,
});
const service = await launcher.launch("stable");
await writeFile(
  configuration.readyPath,
  `${JSON.stringify({ processId: service.processId })}\n`,
  { mode: 0o600 },
);
process.kill(process.pid, "SIGKILL");
