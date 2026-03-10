const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);

if (process.platform === "win32") {
  const shell = findPowerShell();
  const script = path.join(__dirname, "host-bootstrap.ps1");
  const result = spawnSync(shell, ["-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    stdio: "inherit",
  });
  process.exit(typeof result.status === "number" ? result.status : 1);
}

const script = path.join(__dirname, "host-bootstrap.sh");
const result = spawnSync("bash", [script, ...args], {
  stdio: "inherit",
});
process.exit(typeof result.status === "number" ? result.status : 1);

function findPowerShell() {
  const candidates = ["pwsh.exe", "powershell.exe", "pwsh"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      stdio: "ignore",
    });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Could not find PowerShell.");
}
