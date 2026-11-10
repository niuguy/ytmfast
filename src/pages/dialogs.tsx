// What opens over the pages for the whole app: About, the sign-in prompt
// and the first-run sheet. Each is `nsh/base`'s `Dialog` or `Sheet`, which
// own focus, Escape and back.

import { keymap, Scroll, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { createPlaylist } from "../state/library";
import { closeNewPlaylist, newPlaylistFor } from "../state/overlays";
import { ActionButton, IconButton, terminal, TextLink } from "../components/ui/controls";
import { AppDialog, AppSheet } from "../components/ui/overlays";
import { NSH_URL, openExternal, openPremium, REPO_URL, SPOTISH_URL, TERMS_URL, YTM_URL } from "../state/links";
import { aboutOpen, finishFirstRun, firstRunOpen, setAboutOpen, setShortcutsOpen, shortcutsOpen } from "../state/overlays";
import { REGION_KEYS } from "../components/ui/regions";
import { cancelSignIn, health, signedIn, signIn } from "../state/session";
import { Logo } from "../ui/logo";

const DISCLAIMER = "YTMFast is an unofficial client and is not affiliated with YouTube or Google.";

/** The keyboard, as the help lists it: what each key does, by section.
 * Several keystrokes in one row are alternatives (shown joined by "/"). */
const SHORTCUTS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Regions",
    rows: REGION_KEYS.map((k) => ({ keys: [k.keystroke], label: `Go to the ${k.label.toLowerCase()}` })),
  },
  {
    title: "In a region",
    rows: [
      { keys: ["up", "down", "left", "right"], label: "Move between items" },
      { keys: ["home", "end"], label: "First and last item" },
      { keys: ["pageup", "pagedown"], label: "Up and down a screen" },
      { keys: ["enter"], label: "Play or open" },
      { keys: ["tab", "shift+tab"], label: "Next and previous control" },
    ],
  },
  {
    title: "Playback",
    rows: [
      { keys: ["space"], label: "Play and pause" },
      { keys: ["mod+shift+right"], label: "Next track" },
      { keys: ["mod+shift+left"], label: "Previous track" },
    ],
  },
  {
    title: "Pages",
    rows: [
      { keys: ["alt+left"], label: "Go back" },
      { keys: ["escape"], label: "Close or go back" },
      { keys: ["shift+/"], label: "Show these shortcuts" },
    ],
  },
];

/** A keystroke as a key cap, written the platform's way. */
function KeyCap(props: { keystroke: string }) {
  return (
    <Text class={terminal ? "text-foreground" : "rounded-(--radius) border border-border bg-secondary px-1.5 py-0.5 text-xs font-medium text-foreground"}>
      {keymap.label(props.keystroke)}
    </Text>
  );
}

/** The keyboard shortcuts' help (`?`). */
export function ShortcutsDialog() {
  return (
    <AppDialog open={shortcutsOpen()} onOpenChange={setShortcutsOpen} testID="shortcuts">
      <View class="flex-row items-center justify-between pl-6 pr-3 pt-3">
        <Text role="header" class="text-lg font-extrabold text-foreground">
          Keyboard Shortcuts
        </Text>
        <IconButton name="close" label="Close" onPress={() => setShortcutsOpen(false)} />
      </View>
      <Scroll class="max-h-140" contentClass={terminal ? "gap-1" : "gap-5 px-6 pb-6 pt-3"}>
        <Each of={SHORTCUTS} key={(s) => s.title}>
          {(section) => (
            <View class="gap-2">
              <Text class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section().title}</Text>
              <Each of={section().rows} key={(r) => r.label}>
                {(row) => (
                  <View class="min-h-7 flex-row items-center gap-4">
                    <Text class="min-w-0 flex-1 text-sm text-foreground">{row().label}</Text>
                    <View class="flex-row items-center gap-1">
                      <Each of={row().keys} key={(k) => k}>
                        {(k) => <KeyCap keystroke={k()} />}
                      </Each>
                    </View>
                  </View>
                )}
              </Each>
            </View>
          )}
        </Each>
      </Scroll>
    </AppDialog>
  );
}

/** About YTMFast: the disclaimer first, Premium, then NSH, the source and
 * Spotish, the app it is forked from. */
export function AboutDialog() {
  return (
    <AppDialog open={aboutOpen()} onOpenChange={setAboutOpen} testID="about">
      <View class="flex-row items-center justify-end px-3 pt-3">
        <IconButton name="close" label="Close" onPress={() => setAboutOpen(false)} />
      </View>
      <Scroll class="max-h-140" contentClass={terminal ? "gap-1" : "gap-5 px-6 pb-6"}>
        <View class="flex-row items-center gap-3">
          <If when={!terminal}>
            <Logo size={44} />
          </If>
          <View selectable={!terminal}>
            <Text role="header" class="text-xl font-extrabold text-foreground">
              YTMFast
            </Text>
            <Text class="text-xs text-muted-foreground">A native player for YouTube Music</Text>
          </View>
        </View>
        <View class="gap-2" selectable={!terminal}>
          <Text class="text-sm font-bold text-foreground">{DISCLAIMER}</Text>
          <Text class="text-sm text-muted-foreground">
            It plays through YouTube Music's own web player, so a Google account is needed and YouTube's terms apply.
            YouTube, its logo and all music, artwork and trademarks belong to Google and the rights holders.
          </Text>
          <View class="flex-row flex-wrap gap-x-4 gap-y-1">
            <TextLink label="YouTube Terms" onPress={() => openExternal(TERMS_URL)} />
            <TextLink label="YouTube Music" onPress={() => openExternal(YTM_URL)} />
          </View>
        </View>
        <View class={terminal ? "gap-1" : "gap-2 rounded-(--radius-card) border border-border p-4"}>
          <Text class="text-sm text-muted-foreground">
            YTMFast never blocks YouTube's ads. Premium removes them and supports artists.
          </Text>
          <View class="flex-row pt-1">
            <ActionButton label="Get YouTube Music Premium" variant="primary" onPress={openPremium} />
          </View>
        </View>
        <View class="flex-row flex-wrap gap-x-4 gap-y-1">
          <TextLink label="Built with NSH" onPress={() => openExternal(NSH_URL)} />
          <TextLink label="Source on GitHub" onPress={() => openExternal(REPO_URL)} />
          <TextLink label="Forked from Spotish" onPress={() => openExternal(SPOTISH_URL)} />
        </View>
      </Scroll>
    </AppDialog>
  );
}

/** "New playlist": a name, then Create (the song it was opened for goes
 * in). A private playlist of the account's own. */
export function NewPlaylistDialog() {
  const name = signal("");
  const busy = signal(false);
  const create = async () => {
    const pending = newPlaylistFor();
    if (!pending || !name().trim() || busy()) return;
    busy.set(true);
    const made = await createPlaylist(name().trim(), pending.trackUri || null);
    busy.set(false);
    if (made) name.set("");
  };
  return (
    <AppDialog
      open={newPlaylistFor() !== null}
      onOpenChange={(next) => {
        if (!next) closeNewPlaylist();
      }}
      testID="new-playlist"
    >
      <View class={terminal ? "gap-1" : "gap-4 p-6"}>
        <Text role="header" class="text-xl font-bold text-foreground">
          New playlist
        </Text>
        <View class={terminal ? "border border-border" : "h-11 flex-row items-center rounded-(--radius) border border-border bg-secondary px-3 focus-within:border-foreground"}>
          <Input
            value={name()}
            onChange={({ value }) => name.set(value)}
            onSubmit={() => void create()}
            placeholder="Name"
            accessibilityLabel="Playlist name"
            returnKeyType="done"
            autoFocus
            class="flex-1 text-base text-foreground"
            style={{ placeholderColor: token("muted-foreground"), caretColor: token("primary") }}
          />
        </View>
        <Text class="text-xs text-muted-foreground">Only you can see it; change that on YouTube Music.</Text>
        <View class="flex-row justify-end gap-2">
          <ActionButton label="Cancel" onPress={closeNewPlaylist} />
          <ActionButton label="Create" variant="primary" disabled={!name().trim() || busy()} onPress={() => void create()} />
        </View>
      </View>
    </AppDialog>
  );
}

/** While Google's sign-in window is open. Escape, back and Cancel cancel it. */
export function SigningInDialog() {
  const open = () => health().status === "signingIn";
  return (
    <AppDialog
      open={open()}
      onOpenChange={(next) => {
        if (!next) cancelSignIn();
      }}
      closeOnBackdropPress={false}
      testID="signing-in"
    >
      <View class={terminal ? "gap-1" : "items-center gap-4 p-8"}>
        <Text role="header" class="text-xl font-bold text-foreground">
          Sign in to YouTube Music
        </Text>
        <Text class="text-center text-sm text-muted-foreground">
          Sign in with Google in the window that opened. It closes by itself once you're signed in, or close it when you're done.
        </Text>
        <ActionButton label="Cancel" onPress={cancelSignIn} />
      </View>
    </AppDialog>
  );
}

/** Shown once, on the first launch: what YTMFast is, and how to start. */
export function FirstRunSheet() {
  return (
    <AppSheet
      open={firstRunOpen()}
      onOpenChange={(next) => {
        if (!next) finishFirstRun();
      }}
      side="bottom"
      testID="first-run"
    >
      <View class={terminal ? "gap-1" : "mx-auto w-full max-w-lg gap-4 p-6"}>
        <View class="flex-row items-center gap-3">
          <If when={!terminal}>
            <Logo size={44} />
          </If>
          <Text role="header" class="text-xl font-extrabold text-foreground">
            Welcome to YTMFast
          </Text>
        </View>
        <Text class="text-sm text-foreground">{DISCLAIMER}</Text>
        <View class="flex-row flex-wrap items-center gap-3">
          <If when={signedIn() !== true}>
            <ActionButton
              label="Log in"
              variant="primary"
              onPress={() => {
                finishFirstRun();
                signIn();
              }}
            />
          </If>
          <ActionButton label="Get YouTube Music Premium" onPress={openPremium} />
          <ActionButton label={signedIn() === true ? "Start listening" : "Not now"} onPress={finishFirstRun} />
        </View>
        <TextLink label="Built with NSH" onPress={() => openExternal(NSH_URL)} />
      </View>
    </AppSheet>
  );
}
