const STEAMID64_BASE = 76561197960265728n;

const log = (() => {
  const el = document.getElementById("log");
  return (msg) => {
    const time = new Date().toLocaleTimeString();
    el.textContent += `\n[${time}] ${msg}`;
    el.scrollTop = el.scrollHeight;
  };
})();

function detectOS() {
  const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  const ua = navigator.userAgent || "";
  const p = (uaPlatform + " " + ua).toLowerCase();

  if (p.includes("win")) return "windows";
  if (p.includes("mac")) return "mac";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "unknown";
}

function suggestedPath(os) {
  switch (os) {
    case "windows":
      return { main: "C:\\Program Files (x86)\\Steam", note: "Default install location. Custom installs may differ — check your Steam client's Settings → Storage." };
    case "linux":
      return { main: "~/.local/share/Steam", note: "Flatpak installs use ~/.var/app/com.valvesoftware.Steam/.local/share/Steam instead. Snap installs use ~/snap/steam/common/.local/share/Steam." };
    case "mac":
      return { main: "~/Library/Application Support/Steam", note: "" };
    default:
      return { main: "(unable to detect — open your Steam install folder)", note: "" };
  }
}

function initOsDetection() {
  const os = detectOS();
  const label = { windows: "Windows", linux: "Linux", mac: "macOS", unknown: "Unknown" }[os];
  document.getElementById("os-label").textContent = label;

  const { main, note } = suggestedPath(os);
  const box = document.getElementById("suggested-path");
  box.textContent = main;
  if (note) {
    const small = document.createElement("div");
    small.className = "muted small";
    small.style.marginTop = "6px";
    small.textContent = note;
    box.after(small);
  }
}

function checkBrowserSupport() {
  const supported = "showDirectoryPicker" in window;
  if (!supported) {
    document.getElementById("unsupported-warning").classList.remove("hidden");
    document.getElementById("btn-pick-steam").disabled = true;
  }
  return supported;
}

const state = {
  steamRootHandle: null,
  userdataHandle: null,
  profiles: [],       // { accountId, steamId64, personaName, accountName, avatarUrl, dirHandle }
  sourceProfile: null,
  destProfile: null,
};

async function pickSteamFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    state.steamRootHandle = handle;
    document.getElementById("steam-folder-status").textContent = `Selected: ${handle.name}`;
    log(`Granted access to "${handle.name}".`);

    state.userdataHandle = await handle.getDirectoryHandle("userdata");
    log(`Found userdata folder.`);

    await loadProfiles();
    document.getElementById("section-profiles").classList.remove("hidden");
  } catch (err) {
    if (err.name === "AbortError") return; // user cancelled picker
    log(`Error: ${err.message}`);
    alert(
      `Couldn't open "userdata" inside the folder you picked.\n` +
      `Make sure you selected the Steam root folder itself (the one containing "userdata", "steamapps", "config"), not a subfolder.`
    );
  }
}

async function readLoginUsers() {
  const map = new Map(); // steamid64 string -> { accountName, personaName }
  try {
    const configDir = await state.steamRootHandle.getDirectoryHandle("config");
    const fileHandle = await configDir.getFileHandle("loginusers.vdf");
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = parseVdf(text);
    const users = parsed.users || {};
    for (const [steamId64, data] of Object.entries(users)) {
      if (data && typeof data === "object") {
        map.set(steamId64, {
          accountName: data.AccountName || null,
          personaName: data.PersonaName || null,
        });
      }
    }
    log(`Parsed loginusers.vdf — found ${map.size} cached account(s).`);
  } catch (err) {
    log(`Note: couldn't read config/loginusers.vdf (${err.message}). Names will show as account IDs only.`);
  }
  return map;
}

// Steam caches friend/profile avatars locally at config/avatarcache/<steamid64>.png
// (present on most modern Steam installs once the account has logged in at least once).
// We try that first; if it's missing we fall back to a generated placeholder icon.
async function tryLoadLocalAvatar(steamId64) {
  try {
    const configDir = await state.steamRootHandle.getDirectoryHandle("config");
    const avatarDir = await configDir.getDirectoryHandle("avatarcache");
    const fileHandle = await avatarDir.getFileHandle(`${steamId64}.png`);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

async function loadProfiles() {
  const loginUsers = await readLoginUsers();
  const profiles = [];

  for await (const [name, handle] of state.userdataHandle.entries()) {
    if (handle.kind !== "directory") continue;
    if (!/^\d+$/.test(name)) continue; // profile folders are numeric account IDs

    const accountId = name;
    const steamId64 = (BigInt(accountId) + STEAMID64_BASE).toString();
    const cached = loginUsers.get(steamId64);

    profiles.push({
      accountId,
      steamId64,
      personaName: cached?.personaName || null,
      accountName: cached?.accountName || null,
      avatarUrl: null,
      dirHandle: handle,
    });
  }

  profiles.sort((a, b) => a.accountId.localeCompare(b.accountId));
  state.profiles = profiles;
  renderProfiles();
  log(`Found ${profiles.length} profile folder(s) in userdata.`);

  let avatarsFound = 0;
  for (const profile of profiles) {
    const url = await tryLoadLocalAvatar(profile.steamId64);
    if (url) {
      profile.avatarUrl = url;
      avatarsFound++;
    }
  }
  if (avatarsFound > 0) {
    log(`Loaded ${avatarsFound} cached avatar(s) from config/avatarcache.`);
  } else {
    log(`No local avatar cache found — showing placeholder icons instead.`);
  }
  renderProfiles();
}

function renderProfiles() {
  const container = document.getElementById("profile-list");
  container.innerHTML = "";

  for (const profile of state.profiles) {
    const card = document.createElement("div");
    card.className = "profile-card";

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = profile.avatarUrl || svgPlaceholder(profile.accountId);
    img.alt = "";

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = profile.personaName || profile.accountName || `Unknown account`;

    const subId = document.createElement("div");
    subId.className = "sub-id";
    subId.textContent = `id ${profile.accountId}`;

    const buttons = document.createElement("div");
    buttons.className = "pick-buttons";

    const srcBtn = document.createElement("button");
    srcBtn.textContent = "Set as source";
    srcBtn.onclick = () => selectProfile(profile, "source");

    const destBtn = document.createElement("button");
    destBtn.textContent = "Set as destination";
    destBtn.onclick = () => selectProfile(profile, "dest");

    if (state.sourceProfile === profile) srcBtn.classList.add("active-source");
    if (state.destProfile === profile) destBtn.classList.add("active-dest");

    buttons.append(srcBtn, destBtn);
    info.append(name, subId, buttons);
    card.append(img, info);
    container.append(card);
  }
}

function svgPlaceholder(seed) {
  const hue = (parseInt(seed.slice(-4), 10) || 0) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='46' height='46'>
    <rect width='46' height='46' fill='hsl(${hue},40%,28%)'/>
    <text x='50%' y='55%' font-size='18' text-anchor='middle' fill='white' font-family='sans-serif'>?</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function selectProfile(profile, role) {
  if (role === "source") state.sourceProfile = profile;
  if (role === "dest") state.destProfile = profile;

  renderProfiles();
  renderMoveSlots();

  document.getElementById("section-move").classList.remove("hidden");
  const ready = !!(state.sourceProfile && state.destProfile && state.sourceProfile !== state.destProfile);
  document.getElementById("btn-backup").disabled = !state.destProfile;
  document.getElementById("btn-dry-run").disabled = !ready;
  document.getElementById("btn-move").disabled = !ready;

  if (state.sourceProfile && state.destProfile && state.sourceProfile === state.destProfile) {
    log("Source and destination can't be the same profile.");
  }
}

function renderMoveSlots() {
  const srcSlot = document.getElementById("source-slot");
  const destSlot = document.getElementById("dest-slot");

  srcSlot.textContent = state.sourceProfile
    ? `${state.sourceProfile.personaName || "Unknown"} (${state.sourceProfile.accountId})`
    : "Select a profile above";
  srcSlot.className = state.sourceProfile ? "" : "slot-empty";

  destSlot.textContent = state.destProfile
    ? `${state.destProfile.personaName || "Unknown"} (${state.destProfile.accountId})`
    : "Select a profile above";
  destSlot.className = state.destProfile ? "" : "slot-empty";
}

async function* walk(dirHandle, prefix = "") {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      yield { path, handle, kind: "file" };
    } else {
      yield { path, handle, kind: "directory" };
      yield* walk(handle, path);
    }
  }
}

async function copyDirRecursive(srcDir, destDir, onFile) {
  for await (const [name, handle] of srcDir.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      const destFileHandle = await destDir.getFileHandle(name, { create: true });
      const writable = await destFileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      if (onFile) onFile(name, file.size);
    } else {
      const destSubDir = await destDir.getDirectoryHandle(name, { create: true });
      await copyDirRecursive(handle, destSubDir, onFile);
    }
  }
}

async function clearDirContents(dirHandle) {
  const names = [];
  for await (const [name] of dirHandle.entries()) names.push(name);
  for (const name of names) {
    await dirHandle.removeEntry(name, { recursive: true });
  }
}

async function zipDirRecursive(dirHandle, zipFolder) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      zipFolder.file(name, file);
    } else {
      const sub = zipFolder.folder(name);
      await zipDirRecursive(handle, sub);
    }
  }
}

async function backupDestination() {
  if (!state.destProfile) return;
  const btn = document.getElementById("btn-backup");
  btn.disabled = true;
  btn.textContent = "Zipping…";

  try {
    const zip = new JSZip();
    log(`Backing up destination profile ${state.destProfile.accountId}…`);
    await zipDirRecursive(state.destProfile.dirHandle, zip);

    const blob = await zip.generateAsync({ type: "blob" });
    const filename = `steam-userdata-backup-${state.destProfile.accountId}-${Date.now()}.zip`;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    log(`Backup saved as "${filename}". Keep this until you've confirmed the move worked.`);
  } catch (err) {
    log(`Backup failed: ${err.message}`);
    alert(`Backup failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "1. Backup destination (zip)";
  }
}

async function dryRun() {
  if (!state.sourceProfile || !state.destProfile) return;
  log(`--- Dry run: ${state.sourceProfile.accountId} → ${state.destProfile.accountId} ---`);

  let fileCount = 0;
  let totalBytes = 0;
  let overwriteCount = 0;

  for await (const entry of walk(state.sourceProfile.dirHandle)) {
    if (entry.kind !== "file") continue;
    fileCount++;
    const file = await entry.handle.getFile();
    totalBytes += file.size;

    const exists = await pathExists(state.destProfile.dirHandle, entry.path);
    if (exists) overwriteCount++;
  }

  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  log(`Would copy ${fileCount} file(s), ${mb} MB total. ${overwriteCount} file(s) in the destination would be overwritten.`);
  log(`Nothing has been changed yet — this was a preview only.`);
}

async function pathExists(rootDir, path) {
  const parts = path.split("/");
  let dir = rootDir;
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    await dir.getFileHandle(parts[parts.length - 1]);
    return true;
  } catch {
    return false;
  }
}

async function runMove() {
  if (!state.sourceProfile || !state.destProfile) return;
  const deleteSource = document.getElementById("delete-source").checked;

  const confirmed = confirm(
    `About to copy all files from profile ${state.sourceProfile.accountId} into profile ${state.destProfile.accountId}.\n` +
    (deleteSource ? `Source files WILL be deleted after copying.\n` : `Source files will be left alone.\n`) +
    `Have you already made a backup? This cannot be undone without one.`
  );
  if (!confirmed) return;

  const btn = document.getElementById("btn-move");
  btn.disabled = true;
  btn.textContent = "Working…";

  try {
    let copied = 0;
    log(`Starting copy: ${state.sourceProfile.accountId} → ${state.destProfile.accountId}…`);

    await copyDirRecursive(state.sourceProfile.dirHandle, state.destProfile.dirHandle, (name) => {
      copied++;
      if (copied % 25 === 0) log(`  …${copied} files copied so far`);
    });

    log(`Copy complete. ${copied} file(s) written.`);

    if (deleteSource) {
      log(`Deleting source files as requested…`);
      await clearDirContents(state.sourceProfile.dirHandle);
      log(`Source profile ${state.sourceProfile.accountId} cleared.`);
    }

    log(`Done.`);
    alert("Move complete. Check the log for details.");
  } catch (err) {
    log(`Move failed partway through: ${err.message}`);
    alert(`Something went wrong mid-move: ${err.message}\nYour backup zip is the way to recover the destination profile.`);
  } finally {
    btn.disabled = false;
    btn.textContent = "3. Run move";
  }
}

function init() {
  initOsDetection();
  checkBrowserSupport();

  document.getElementById("btn-pick-steam").addEventListener("click", pickSteamFolder);
  document.getElementById("btn-backup").addEventListener("click", backupDestination);
  document.getElementById("btn-dry-run").addEventListener("click", dryRun);
  document.getElementById("btn-move").addEventListener("click", runMove);
}

init();
