// Updates: a newer build of the app's TSX (an OTA package, run from the
// next start) and a newer app (a new binary, for Rust or NSH runtime
// changes), from the GitHub Releases of huacnlee/spotish (nsh.json
// "updater"). Quiet: a failed check is logged, and the next check tries
// again.
//
// Wiring (App.tsx, once the app has started; again every few hours if it
// stays open):
//
//   checkForUpdates({ notify: (message, action) => store.notify(message) });
//
// `notify` gets one message per finding, with an action where one makes
// sense ("Restart", "Download"); a toast or a banner shows it.
//
// --- How releases must be made -------------------------------------------
//
// Keys (once; keep the .secret files out of the repository, root.secret
// offline):
//   nsh keygen keys/root          # nsh.json updater.packages.roots ← root.pub
//   nsh keygen keys/release       # signs packages, in CI
//   nsh keygen keys/update        # signs latest.json; nsh.json updater.publicKey ← update.pub
//   nsh certify --root keys/root.secret --key keys/release.pub \
//     --apps dev.huacnlee.spotish -o keys/release.cert   # renew yearly
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
//     nsh publish --key release.secret --cert release.cert -o dist/dev.huacnlee.spotish-<build>.nshpkg
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

import { openUrl } from "nsh";
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
   * given. */
  notify(message: string, action?: { label: string; run(): void }): void;
}

let checking = false;

/**
 * Checks for a newer build of the app's TSX (downloaded, it runs from the
 * next start; on the desktops the user can restart into it now), and when
 * there is none, for a newer app (offered for download and install, or as
 * a link where it cannot install itself). Resolves when done; never
 * rejects. In development runs and on the web it finds nothing.
 */
export async function checkForUpdates(opts: UpdateOptions): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const pkg = await checkForPackage();
    if (pkg) {
      await downloadPackage();
      if (canRestart) {
        opts.notify(`Spotish ${pkg.version} is ready.`, {
          label: "Restart",
          run: () => void restartToPackage().catch((e: unknown) => console.warn("update: restart failed:", e)),
        });
      }
      return;
    }
    const app = await checkForUpdate();
    if (!app) return;
    if (app.canInstall) {
      opts.notify(`Spotish ${app.version} is available.`, {
        label: "Update",
        run: () => void installApp(opts),
      });
    } else {
      opts.notify(`Spotish ${app.version} is available.`, {
        label: "Download",
        run: () => void openUrl(app.url).catch(() => undefined),
      });
    }
  } catch (error) {
    console.warn("update check failed:", error);
  } finally {
    checking = false;
  }
}

async function installApp(opts: UpdateOptions): Promise<void> {
  try {
    await downloadUpdate();
    await installAndRestart(); // Settles only on failure.
  } catch (error) {
    console.warn("update: install failed:", error);
    opts.notify("The update could not be installed.");
  }
}
