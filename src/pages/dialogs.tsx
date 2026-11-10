// What opens over the pages for the whole app: About, the sign-in prompt
// and the first-run sheet. Each is `nsh/base`'s `Dialog` or `Sheet`, which
// own focus, Escape and back.

import { keymap, Scroll, Text, View } from "nsh";
import { ActionButton, IconButton, terminal, TextLink } from "../components/ui/controls";
import { AppDialog, AppSheet } from "../components/ui/overlays";
import { NSH_URL, openExternal, openPremium, REPO_URL, SPOTIFY_URL, TERMS_URL } from "../state/links";
import { aboutOpen, finishFirstRun, firstRunOpen, setAboutOpen, setShortcutsOpen, shortcutsOpen } from "../state/overlays";
import { REGION_KEYS } from "../components/ui/regions";
import { cancelSignIn, health, signedIn, signIn } from "../state/session";
import { Logo } from "../ui/logo";

const DISCLAIMER = "Spotish is an unofficial client and is not affiliated with Spotify.";

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

/** About Spotish: the disclaimer first, Premium, then NSH. */
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
              Spotish
            </Text>
            <Text class="text-xs text-muted-foreground">A native player for Spotify</Text>
          </View>
        </View>
        <View class="gap-2" selectable={!terminal}>
          <Text class="text-sm font-bold text-foreground">{DISCLAIMER}</Text>
          <Text class="text-sm text-muted-foreground">
            It plays through Spotify's own web player, so a Spotify account is needed and Spotify's terms apply. Spotify, its
            logo and all music, artwork and trademarks belong to Spotify and the rights holders.
          </Text>
          <View class="flex-row flex-wrap gap-x-4 gap-y-1">
            <TextLink label="Spotify Terms" onPress={() => openExternal(TERMS_URL)} />
            <TextLink label="Spotify" onPress={() => openExternal(SPOTIFY_URL)} />
          </View>
        </View>
        <View class={terminal ? "gap-1" : "gap-2 rounded-(--radius-card) border border-border p-4"}>
          <Text class="text-sm text-muted-foreground">
            Spotish never blocks Spotify's ads. Premium removes them, plays any track on demand, and supports artists.
          </Text>
          <View class="flex-row pt-1">
            <ActionButton label="Get Spotify Premium" variant="primary" onPress={openPremium} />
          </View>
        </View>
        <View class="flex-row flex-wrap gap-x-4 gap-y-1">
          <TextLink label="Built with NSH" onPress={() => openExternal(NSH_URL)} />
          <TextLink label="Source on GitHub" onPress={() => openExternal(REPO_URL)} />
        </View>
      </Scroll>
    </AppDialog>
  );
}

/** While Spotify's login window is open. Escape, back and Cancel cancel it. */
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
          Log in to Spotify
        </Text>
        <Text class="text-center text-sm text-muted-foreground">
          Log in in the Spotify window, then close it to finish.
        </Text>
        <ActionButton label="Cancel" onPress={cancelSignIn} />
      </View>
    </AppDialog>
  );
}

/** Shown once, on the first launch: what Spotish is, and how to start. */
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
            Welcome to Spotish
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
          <ActionButton label="Get Spotify Premium" onPress={openPremium} />
          <ActionButton label={signedIn() === true ? "Start listening" : "Not now"} onPress={finishFirstRun} />
        </View>
        <TextLink label="Built with NSH" onPress={() => openExternal(NSH_URL)} />
      </View>
    </AppSheet>
  );
}
