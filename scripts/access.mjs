import os from "node:os";
import {
  createAccessUser,
  publicUser,
  readAccessConfig,
  readAccessUsers,
  removeAccessUser,
  rotateAccessToken,
  slugifyAccessId,
  updateAccessUser,
  writeAccessConfig
} from "./access-control.mjs";

// Parses npm-forwarded CLI flags such as --id owner --name "Owner".
function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = next;
        index += 1;
      }
    } else {
      positional.push(value);
    }
  }

  return { command: positional[0] ?? "status", options };
}

// Prints token material only at creation/rotation time.
function printCreated({ user, token }) {
  console.log(`User: ${user.id}`);
  console.log(`Name: ${user.name}`);
  console.log(`Role: ${user.role}`);
  console.log("Access token:");
  console.log(token);
}

const { command, options } = parseArgs(process.argv.slice(2));

if (command === "setup") {
  const config = await writeAccessConfig({ authRequired: true, networkGuard: options["network-guard"] || "tailscale" });
  const users = await readAccessUsers();
  console.log("Orbiter access config");
  console.log(`Auth required: ${config.authRequired}`);
  console.log(`Network guard: ${config.networkGuard}`);

  if (!users.length) {
    const id = slugifyAccessId(options.id || os.userInfo().username || "owner");
    const name = options.name || id;
    console.log("");
    console.log("Created owner access user");
    printCreated(await createAccessUser({ id, name, role: "admin" }));
  } else {
    console.log("");
    console.log(`Access users already configured: ${users.length}`);
  }
} else if (command === "add") {
  printCreated(await createAccessUser({
    id: options.id || options.name,
    name: options.name || options.id,
    role: options.role || "member",
    ephemeral: options.ephemeral,
    dataScope: options["data-scope"] || options.dataScope
  }));
} else if (command === "rotate") {
  printCreated(await rotateAccessToken(options.id));
} else if (command === "remove") {
  const result = await removeAccessUser(options.id);
  console.log(`Removed user: ${result.user.id}`);
  console.log(`Role: ${result.user.role}`);
  console.log(`Sessions revoked: ${result.revokedSessions}`);
} else if (command === "update") {
  const user = await updateAccessUser({
    id: options.id,
    name: options.name,
    role: options.role,
    active: options.active,
    phoneE164: options.phone || options.phoneE164 || options["phone-e164"],
    ephemeral: options.ephemeral,
    dataScope: options["data-scope"] || options.dataScope
  });
  console.log(`Updated user: ${user.id}`);
  console.log(`Name: ${user.name}`);
  console.log(`Role: ${user.role}`);
  console.log(`Active: ${user.active ? "yes" : "no"}`);
  console.log(`Ephemeral: ${user.ephemeral ? "yes" : "no"}`);
  console.log(`Data scope: ${user.dataScope}`);
  console.log(`Phone last 4: ${user.phoneLast4 || "not set"}`);
} else if (command === "list") {
  const users = (await readAccessUsers()).map(publicUser);
  if (!users.length) {
    console.log("No access users configured.");
  } else {
    for (const user of users) {
      console.log(`${user.id}\t${user.role}\t${user.active ? "active" : "inactive"}\t${user.name}`);
    }
  }
} else if (command === "status") {
  const config = await readAccessConfig();
  const users = await readAccessUsers();
  console.log("Orbiter access status");
  console.log(`Auth required: ${config.authRequired}`);
  console.log(`Network guard: ${config.networkGuard}`);
  console.log(`Users: ${users.length}`);
} else {
  console.log("Usage:");
  console.log("  npm run access:setup");
  console.log("  npm run access:add -- --id partner --name \"Partner\" --role member");
  console.log("  npm run access:add -- --id mom --name \"Mom\" --role guest --ephemeral true");
  console.log("  node scripts/access.mjs update --id partner --name \"Partner\" --role wife");
  console.log("  node scripts/access.mjs update --id owner --phone +15555550123");
  console.log("  npm run access:rotate -- --id owner");
  console.log("  npm run access:remove -- --id old-user");
  console.log("  npm run access:list");
}
