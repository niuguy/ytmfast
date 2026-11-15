// Updates: a newer build of the app's TSX (an OTA package, run from the
// next start) and a newer app (a new binary, for Rust or NSH runtime
// changes), from the GitHub Releases named in nsh.json (nsh.json
// "updater"). Quiet: a failed check is logged, and the next check tries
// again.
//
// Wiring (App.tsx, once the app has started; again every few hours if it
// stays open):
//
//   checkForUpdates({ notify: (message, action) => store.notify(message) });
//
// `notify` gets one message per finding, with an action where one makes
// sense ("Restart", "Update", "Download"); a toast or a banner shows it.
// An offer is `sticky`: it stays until the user acts on it or closes it,
// and `availableUpdate()` keeps it for a menu (the tray's "Update to …"),
// so a check made while nobody looked is not lost. `manual` (the tray's
// "Check for Updates…") also reports finding nothing, and failing.
//
// --- How releases must be made -------------------------------------------
//
// Keys (once; keep the .secret files out of the repository, root.secret
// offline):
//   nsh keygen keys/root          # nsh.json updater.packages.roots ← root.pub
//   nsh keygen keys/release       # signs packages, in CI
//   nsh keygen keys/update        # signs latest.json; nsh.json updater.publicKey ← update.pub
//   nsh certify --root keys/root.secret --key keys/release.pub \
//     --apps dev.ytmfast -o keys/release.cert   # renew yearly
//   gh secret set NSH_RELEASE_KEY < keys/release.secret
//   gh secret set NSH_RELEASE_CERT < keys/release.cert
//   gh secret set NSH_UPDATE_KEY < keys/update.secret
// Until "publicKey" and "packages.roots" are in nsh.json, the app checks for
// new app builds only (unsigned manifests accepted from GitHub) and never
// for packages; only app builds made with them take OTA packages.
//
// Every release raises `build` in nsh.json (one counter for packages and
// app builds) and `version` (semver). Then, on a `v*` tag:
// - TSX only (screens, styles, bridge.js once it ships in the bundle):
//     nsh publish --key release.secret --cert release.cert -o dist/dev.ytmfast-<build>.nshpkg
//     nsh update-manifest --package dist/…nshpkg --notes CHANGES.md --key update.secret -o dist
//   Publish with the nsh version of the app builds in the field, or set
//   nsh.json "minRuntime" to the oldest runtime the TSX supports; when the
//   TSX needs a newer Rust export, raise `Version.api()` (src/version.rs)
//   and gate on it, or ship an app build.
// - Rust, NSH runtime or nsh.json changes: a new app build.
//     nsh package --target linux|macos|windows   # per platform, *-<version>-<os>-<arch>.tar.gz/.zip
//     nsh update-manifest *.tar.gz *.zip [--package …] --notes CHANGES.md --key update.secret
//   On macOS, sign with a Developer ID and notarize before the manifest.
// Upload the archives and/or package, then latest.json and latest.json.sig,
// as assets of a published (not draft, not prerelease) GitHub Release.

import { openUrl, signal } from "nsh";
import { isAvailable as canRestart } from "nsh/desktop";
import {
  checkForPackage,
  checkForUpdate,
  downloadPackage,
  downloadUpdate,
  installAndRestart,
  restartToPackage,
} from "nsh/updater";

/** Where `checkForUpdates` reports what it found. */
export interface UpdateOptions {
  /** Shows `message` to the user, with a button running `action` when
   * given; `sticky` ones stay until closed or chosen. */
  notify(message: string, action?: { label: string; run(): void }, opts?: { sticky?: boolean }): void;
}

/** An update found and ready to take: its version, and what takes it. */
export interface AvailableUpdate {
  version: string;
  /** "Restart", "Update" or "Download": what `take` does. */
  label: string;
  take(): void;
}

const offered = signal<AvailableUpdate | null>(null);

/** The update the last check found, if any (reactive). */
export const availableUpdate = () => offered();

let checking = false;
let installing = false;

/**
 * Checks for a newer build of the app's TSX (downloaded, it runs from the
 * next start; on the desktops the user can restart into it now), and when
 * there is none, for a newer app (offered for download and install, or as
 * a link where it cannot install itself). Resolves when done; never
 * rejects. In development runs and on the web it finds nothing. `manual`:
 * the user asked, so finding nothing and failing are said too.
 */
export async function checkForUpdates(opts: UpdateOptions, manual = false): Promise<void> {
  if (checking || installing) return;
  checking = true;
  try {
    const pkg = await checkForPackage();
    if (pkg) {
      await downloadPackage();
      if (canRestart) {
        offer(opts, {
          version: pkg.version,
          label: "Restart",
          take: () => void restartToPackage().catch((e: unknown) => console.warn("update: restart failed:", e)),
        });
      }
      return;
    }
    const app = await checkForUpdate();
    if (!app) {
      offered.set(null);
      if (manual) opts.notify("YTMFast is up to date.");
      return;
    }
    offer(
      opts,
      app.canInstall
        ? { version: app.version, label: "Update", take: () => void installApp(opts) }
        : { version: app.version, label: "Download", take: () => void openUrl(app.url).catch(() => undefined) },
    );
  } catch (error) {
    console.warn("update check failed:", error);
    if (manual) opts.notify("Couldn't check for updates. Try again later.");
  } finally {
    checking = false;
  }
}

function offer(opts: UpdateOptions, update: AvailableUpdate): void {
  offered.set(update);
  opts.notify(`YTMFast ${update.version} is available.`, { label: update.label, run: update.take }, { sticky: true });
}

async function installApp(opts: UpdateOptions): Promise<void> {
  if (installing) return;
  installing = true;
  opts.notify("Updating YTMFast…");
  try {
    await downloadUpdate();
    await installAndRestart(); // Settles only on failure.
  } catch (error) {
    console.warn("update: install failed:", error);
    opts.notify("The update could not be installed.");
  } finally {
    installing = false;
  }
}
