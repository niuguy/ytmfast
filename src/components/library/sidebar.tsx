// The sidebar: the main pages, the user's library and the account. On a
// narrow desktop window it is a `compact` rail of icons and covers (each
// with a tooltip); the phone's drawer shows it in full.

import { hasAppWindow, quitApp } from "../../platform/desktop";
import { type AnimatedValue, createAnimatedValue, createMotion, effect, fpsEnabled, List, reduceMotion, setFpsEnabled, signal, Text, untracked, View } from "nsh";
import { AlertDialog, Button, Menu, MenuItem, MenuSeparator } from "nsh/base";
import type { Item } from "../../backend/types";
import { libraryQuery, meQuery } from "../../data/queries";
import { currentRoute, EXPLORE, HISTORY, HOME, type Route, SEARCH, switchTo } from "../../nav";
import { NSH_URL, openExternal, openPremium, REPO_URL, YTM_URL } from "../../state/links";
import { setAboutOpen, setDrawerOpen } from "../../state/overlays";
import { isCurrentContext, isPlayingContext, player } from "../../state/player";
import { signedIn, signIn, signOut } from "../../state/session";
import { ActionButton, Cover, focusRing, Hint, IconButton, keyRing, LAYER, menuItem, popupSurface, Pressable, terminal } from "../ui/controls";
import { createListGroup, createListKeys, KEYS_VIEWABILITY, type ListGroup, type ListKeys } from "../ui/list-keys";
import { ErrorState, LibrarySkeleton, Reveal } from "../ui/feedback";
import { Icon, iconMotion, type IconName } from "../ui/icons";
import { PlayingBars } from "../ui/playing";
import { createListWave, listItemEntrance, type ListWave, WAVE } from "../ui/motion";
import { DURATION, EASING } from "../ui/tokens";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "../ui/menu";
import { fallbackIcon } from "./cards";
import { accountMenuWidth, layout } from "../layout";

/** Switches to a page from the sidebar, cross-fading rather than
 * sliding (and closes the phone's drawer). */
function go(route: Route) {
  switchTo(route);
  setDrawerOpen(false);
}

/** A sidebar row's height and the gap under it (h-11, and gap-1 or pb-1):
 * rows are 48pt apart in both panels. */
const ROW_STEP = 44 + 4;

/** A panel's selection (transitions.dev "Tabs sliding"): one background
 * behind the rows that slides to the selected one (`index`, -1: none), rather
 * than each row lighting its own. With no selection it fades away; from no
 * selection it fades in where it lands. `top`: the first row's top in the
 * panel; `scroll`: the offset of the list it sits behind, which it follows
 * natively, without easing (a row scrolled away goes out of the panel, which
 * clips it). */
function SlidingSelection(props: { index: () => number; top: number; scroll?: AnimatedValue }) {
  const motion = createMotion({ initial: { opacity: 0 } });
  // Where it was last sent: undefined before the first placement, -1 while
  // hidden.
  let at: number | undefined;
  effect(() => {
    const i = props.index();
    untracked(() => {
      const from = at;
      at = i;
      if (from === i) return;
      const y = props.top + i * ROW_STEP;
      // The first placement, and reduced motion, jump; later ones slide.
      if (from === undefined || reduceMotion()) {
        if (i >= 0) motion.translateY.set(y);
        motion.opacity.set(i >= 0 ? 1 : 0);
        return;
      }
      const timing = { duration: DURATION.base, easing: EASING.inOut };
      if (i < 0) {
        void motion.opacity.timing(0, timing);
        return;
      }
      if (from < 0) motion.translateY.set(y);
      else void motion.translateY.timing(y, timing);
      void motion.opacity.timing(1, timing);
    });
  });
  const y = props.scroll ? motion.translateY.sub(props.scroll) : motion.translateY;
  return (
    <View
      class="pointer-events-none absolute left-2 right-2 top-0 h-11 rounded-(--radius-inset) bg-secondary"
      style={{ opacity: motion.opacity, transform: [{ translateY: y }] }}
    />
  );
}

/** One of the nav panel's entries. */
interface NavEntry {
  icon: IconName;
  label: string;
  route: Route;
}

/** Whether `route` is the page shown. */
function isShown(route: Route): boolean {
  const now = currentRoute();
  if (now.name !== route.name) return false;
  return !("uri" in route) || ("uri" in now && now.uri === route.uri);
}

/** The nav panel's entries: Home, Explore, Search (the desktop lists it in
 * the header instead), and History while signed in. */
function navEntries(): NavEntry[] {
  const entries: NavEntry[] = [
    { icon: "home", label: "Home", route: HOME },
    { icon: "compass", label: "Explore", route: EXPLORE },
  ];
  if (layout() !== "desktop" || terminal) entries.push({ icon: "search", label: "Search", route: SEARCH });
  if (signedIn() === true) entries.push({ icon: "history", label: "History", route: HISTORY });
  return entries;
}

/** The nav panel's selection: the entry of the page shown, if any. */
function NavIndicator() {
  return <SlidingSelection index={() => navEntries().findIndex((e) => isShown(e.route))} top={8} />;
}

/** One of the main pages. */
function NavItem(props: { icon: IconName; label: string; route: Route; compact: boolean; keys: ListKeys; index: number }) {
  const selected = () => isShown(props.route);
  const hover = iconMotion();
  return (
    <View onMouseEnter={() => hover.play(props.icon)}>
    <Pressable
      focusable={false}
      accessibilityLabel={props.label}
      selected={selected()}
      onPress={() => {
        props.keys.pressed(props.index);
        go(props.route);
      }}
      tooltip={props.compact ? <Hint label={props.label} /> : undefined}
      class={
        terminal
          ? "px-1 focus:bg-muted selected:bg-muted"
          : `group h-11 flex-row items-center gap-3 rounded-(--radius-inset) transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] motion-reduce:transition-none ${focusRing} ${
              props.compact ? "justify-center" : "px-2"
            } ${props.keys.isActive(props.index) ? keyRing : ""}`
      }
    >
      <If when={!terminal}>
        {/* As wide as a library row's cover, so icons, covers and labels
            line up down the whole sidebar. */}
        <View class={`w-[30px] items-center ${LAYER} group-active:scale-90`}>
          <View style={hover.style}>
            <Icon name={props.icon} size={22} color={selected() ? "foreground" : "muted-foreground"} />
          </View>
        </View>
      </If>
      <If when={!props.compact || terminal}>
        <Text class={`text-base font-bold ${LAYER} group-hover:translate-x-0.5 ${selected() ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>{props.label}</Text>
      </If>
    </Pressable>
    </View>
  );
}

/** One library entry: a cell of the recycling list, so it reads `item()`
 * where it is used. */
function LibraryRow(props: { item: Item | undefined; compact: boolean; index: number; wave?: ListWave; keys?: ListKeys }) {
  // The rows wave in when the library shows; a row scrolled to comes in on
  // its own (its cover flipping open and its name sliding in just after). Made once, here: the
  // Button re-reads its style with its other props, and a motion made there
  // would play again.
  const { style: entrance, cover: coverIn, text: textIn } = untracked(() =>
    listItemEntrance({
      wave: props.wave,
      key: () => props.item?.uri ?? "",
      index: () => props.index,
      axis: "translateX",
      turns: WAVE.rows,
    }),
  );
  const uri = () => props.item?.uri ?? "";
  const kind = () => props.item?.kind ?? "";
  const selected = () => {
    const route = currentRoute();
    return route.name === "collection" && route.uri === uri();
  };
  const playingHere = () => isPlayingContext(uri());
  const current = () => isCurrentContext(uri());
  return (
    <Pressable
      focusable={!props.keys}
      accessibilityLabel={props.item?.name ?? ""}
      selected={selected()}
      onPress={() => {
        props.keys?.pressed(props.index);
        if (uri()) go({ name: "collection", uri: uri() });
      }}
      tooltip={props.compact ? <Hint label={props.item?.name ?? ""} /> : undefined}
      style={entrance}
      class={
        terminal
          ? "flex-row gap-1 px-1 focus:bg-muted selected:bg-muted"
          : `group h-11 flex-row items-center gap-3 rounded-(--radius-inset) px-2 transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] active:bg-muted motion-reduce:transition-none ${focusRing} ${
              props.compact ? "justify-center" : ""
            } ${props.keys?.isActive(props.index) ? keyRing : ""}`
      }
    >
      <View style={coverIn}>
        <Cover
          src={props.item?.image ?? ""}
          size={props.compact ? 36 : 30}
          round
          liked={kind() === "collection"}
          fallback={fallbackIcon(kind())}
          class={`${LAYER} group-hover:scale-110 group-active:scale-95`}
        />
      </View>
      <If when={!props.compact || terminal}>
        <View class="min-w-0 flex-1" style={textIn}>
          <Text class={`line-clamp-1 text-sm font-medium ${current() ? "text-primary" : "text-foreground"}`}>
            {props.item?.name ?? ""}
          </Text>
        </View>
        <If when={current() && !terminal}>
          <PlayingBars playing={playingHere()} size={12} />
        </If>
      </If>
    </Pressable>
  );
}

/** The library: the list (signed in), a login prompt (signed out), or
 * skeleton rows while it is not known yet. */
function LibraryPanel(props: { compact: boolean; group?: ListGroup }) {
  const library = libraryQuery();
  // The list's scroll offset, for the selection behind its rows.
  const scroll = createAnimatedValue(0);
  // Which row is selected: the open collection's place in the library.
  const selectedIndex = () => {
    const route = currentRoute();
    if (route.name !== "collection") return -1;
    return library.data()?.items.findIndex((i) => i.uri === route.uri) ?? -1;
  };
  return (
    <View accessibilityLabel="Your Library" class={terminal ? "min-h-0 flex-1" : "relative min-h-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-border bg-card"}>
      <If when={!terminal && signedIn() !== false}>
        {/* Behind the rows (the list's own top padding is 8pt). */}
        <SlidingSelection index={selectedIndex} top={8} scroll={scroll} />
      </If>
      <If when={signedIn() !== false} else={<SignedOutPrompt compact={props.compact} />}>
        <Reveal
          data={library.data()}
          placeholder={<LibraryPlaceholder query={library} compact={props.compact} />}
          class="min-h-0 flex-1"
        >
          {(lib, instant) => {
            // The rows wave in when they first show (at once when cached,
            // as the skeleton fades when they loaded); rows scrolled to come
            // in on their own.
            const wave = createListWave({ isTop: () => true, afterReveal: !instant });
            // Below the pages in the sidebar's region; Return opens the
            // playlist. The keyboard starts at the open one.
            const keys = createListKeys({
              count: () => lib().items.length,
              group: props.group,
              order: () => 1,
              activate: (i) => {
                const item = lib().items[i];
                if (item) go({ name: "collection", uri: item.uri });
              },
              start: selectedIndex,
            });
            return (
              <List
                ref={keys.ref}
                focusable={keys.focusable()}
                onFocus={keys.onFocus}
                onBlur={keys.onBlur}
                onViewableItemsChange={keys.onViewableItemsChange}
                viewabilityConfig={KEYS_VIEWABILITY}
                each={lib().items}
                keyExtractor={(i) => i.uri}
                estimatedItemSize={48}
                // Stops with a whole row at the top (rows are 48pt apart).
                snapToInterval={48}
                snapToAlignment="start"
                scrollValue={scroll}
                contentClass="px-2 pt-2 pb-1"
                class="flex-1"
              >
                {(item, index) => (
                  <View class="pb-1">
                    <LibraryRow item={item()} compact={props.compact} index={index()} wave={wave} keys={keys} />
                  </View>
                )}
              </List>
            );
          }}
        </Reveal>
      </If>
      {/* Rows leave the panel softly at its bottom edge, not cut off. */}
      <If when={!terminal}>
        <View class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
      </If>
    </View>
  );
}

function LibraryPlaceholder(props: { query: ReturnType<typeof libraryQuery>; compact: boolean }) {
  return (
    <If when={props.query.error() && !props.compact} else={<LibrarySkeleton compact={props.compact} rows={props.compact ? 4 : 6} />}>
      <ErrorState message="Your library didn't load." onRetry={props.query.refetch} />
    </If>
  );
}

function SignedOutPrompt(props: { compact: boolean }) {
  return (
    <If
      when={props.compact && !terminal}
      else={
        <View class="m-2 gap-3 rounded-(--radius-card) border border-border p-4">
          <Text class="text-base font-bold text-foreground">Your playlists live here</Text>
          <Text class="text-sm text-muted-foreground">Sign in with your Google account, free or Premium, to see your library.</Text>
          <View class="flex-row">
            <ActionButton label="Log in" variant="primary" onPress={signIn} />
          </View>
        </View>
      }
    >
      <View class="m-2 items-center">
        <IconButton name="logIn" label="Log in" hint onPress={signIn} />
      </View>
    </If>
  );
}

/** One row of the user menu: its icon, centred in a slot as wide as the
 * avatar above (so the icons line up under its centre and the labels under
 * the name), the label, and a mark for a page that opens in the browser,
 * or, for a setting (`checked` given), a check while it is on. */
function Entry(props: { icon: IconName; label: string; external?: boolean; checked?: boolean; onSelect: () => void }) {
  const hover = iconMotion();
  return (
    <MenuItem onSelect={props.onSelect} checked={props.checked} class={terminal ? "px-1 focus:bg-muted" : menuItem}>
      <View onMouseEnter={() => hover.play(props.icon)} class="flex-1 flex-row items-center gap-2.5">
        <If when={!terminal}>
          <View class="w-8 items-center" style={hover.style}>
            <Icon name={props.icon} size={16} color="muted-foreground" />
          </View>
        </If>
        <Text class="flex-1 text-sm text-popover-foreground">{props.label}</Text>
        <If when={props.external && !terminal}>
          <Icon name="externalLink" size={14} color="muted-foreground" />
        </If>
        <If when={props.checked && !terminal}>
          <Icon name="check" size={14} color="popover-foreground" />
        </If>
      </View>
    </MenuItem>
  );
}

const Separator = () => <MenuSeparator class={terminal ? "hidden" : "-mx-1 my-1 h-px bg-border"} />;

/** Logs out once the user confirms: the account goes with the music, and
 * coming back takes the browser's sign-in again, so a slip of the pointer
 * must not do it. */
async function confirmSignOut(): Promise<void> {
  const { action } = await AlertDialog.show({
    title: "Sign out of YouTube Music?",
    description: "The music stops, and you'll need to log in again to listen.",
    actions: [
      { id: "cancel", label: "Cancel", role: "cancel" },
      { id: "logOut", label: "Log out", role: "destructive" },
    ],
    closeOnEscape: true,
  });
  if (action === "logOut") await signOut();
}

/** The user menu: who is signed in and on which plan, then Premium, YTMFast
 * and NSH, the FPS monitor, and Exit; Log out on the account's row. */
function MenuEntries(props: { name: string; image: string }) {
  const premium = () => player().premium === true;
  return (
    <>
      <If when={signedIn() === true && !terminal}>
        <View class="flex-row items-center gap-2.5 py-2 pl-2.5 pr-1">
          <Cover src={props.image} size={32} round fallback="user" />
          <View class="min-w-0 flex-1">
            <Text class="line-clamp-1 text-sm font-semibold text-popover-foreground">{props.name}</Text>
            <Text class="text-xs text-muted-foreground">{premium() ? "YouTube Music Premium" : "YouTube Music"}</Text>
          </View>
          {/* Log out belongs to the account, so it sits on the account's
              row; an item still, for the menu's keys. It asks first. */}
          <MenuItem
            onSelect={() => void confirmSignOut()}
            accessibilityLabel="Log out"
            tooltip={<Hint label="Log out" />}
            class="size-8 items-center justify-center rounded-(--radius) hover:bg-muted focus:bg-muted active:bg-muted"
          >
            <Icon name="logOut" size={16} color="muted-foreground" />
          </MenuItem>
        </View>
        <Separator />
      </If>
      <If when={!premium()}>
        <Entry icon="crown" label="Premium" external onSelect={openPremium} />
      </If>
      <Entry icon="music" label="YouTube Music" external onSelect={() => openExternal(YTM_URL)} />
      <Separator />
      <Entry icon="info" label="About…" onSelect={() => setAboutOpen(true)} />
      <Entry icon="github" label="GitHub" external onSelect={() => openExternal(REPO_URL)} />
      <Entry icon="code" label="NSH" external onSelect={() => openExternal(NSH_URL)} />
      {/* NSH's performance monitor: frame rate, frame and commit costs. */}
      <Entry icon="activity" label="FPS" checked={fpsEnabled()} onSelect={() => setFpsEnabled(!fpsEnabled())} />
      <If when={(signedIn() === true && terminal) || hasAppWindow}>
        <Separator />
      </If>
      {/* A terminal has no account row: Log out is a row of its own. */}
      <If when={signedIn() === true && terminal}>
        <Entry icon="logOut" label="Log out…" onSelect={() => void confirmSignOut()} />
      </If>
      {/* Ends the app (the music stops), as the tray's Exit. */}
      <If when={hasAppWindow}>
        <Entry icon="power" label="Exit" onSelect={quitApp} />
      </If>
    </>
  );
}


/** The account at the sidebar's foot, which opens the user menu: the
 * user's picture and name (YTMFast, signed out). */
export function Account(props: { compact: boolean; placement?: "top" | "bottom"; align?: "start" | "end" }) {
  const me = meQuery();
  // Up from the sidebar's foot; down from the header's corner.
  const side = () => props.placement ?? "top";
  // Flush with its left edge, or (in the window's top-right corner) its right.
  const align = () => props.align ?? "start";
  const name = () => (signedIn() === true ? me.data()?.name || "Account" : "YTMFast");
  const open = signal(false);
  return (
    <Menu
      open={open()}
      onOpenChange={(e) => open.set(e.open)}
      placement={side()}
      align={align()}
      offset={4}
      popupClass={popupSurface}
      // As wide as the account row, so it opens flush with it.
      popupStyle={{ ...menuPopupStyle(side(), align()), width: accountMenuWidth() }}
      popupStartingStyle={menuPopupHidden(side(), align())}
      popupEndingStyle={menuPopupLeaving(side(), align())}
      trigger={
        <Button
          accessibilityLabel={`User menu: ${name()}`}
          selected={open()}
          tooltip={props.compact ? <Hint label={name()} /> : undefined}
          class={
            terminal
              ? "px-1 focus:bg-muted"
              : `group h-11 flex-row items-center gap-3 rounded-(--radius-inset) transition duration-200 ease-out hover:bg-row-hover active:scale-[0.98] selected:bg-secondary motion-reduce:transition-none ${focusRing} ${
                  props.compact ? `justify-center ${side() === "bottom" ? "w-11 rounded-full" : ""}` : "px-2"
                }`
          }
        >
          <Cover
            src={signedIn() === true ? (me.data()?.image ?? "") : ""}
            size={30}
            round
            fallback="user"
            class={LAYER}
          />
          <If when={!props.compact || terminal}>
            <Text class="line-clamp-1 flex-1 text-sm font-semibold text-foreground">{name()}</Text>
            <If when={!terminal}>
              {/* The chevron points the way the menu opens. */}
              <View class={`${side() === "top" ? "rotate-180" : ""} ${LAYER} opacity-60 group-hover:opacity-100 group-hover:-translate-y-0.5`}>
                <Icon name="chevronDown" size={14} color="muted-foreground" />
              </View>
            </If>
          </If>
        </Button>
      }
    >
      <MenuEntries name={name()} image={me.data()?.image ?? ""} />
    </Menu>
  );
}

/** The whole sidebar; `compact` is the desktop's icon rail. */
export function Sidebar(props: { compact?: boolean }) {
  const compact = () => (props.compact ?? false) && !terminal;
  // The pages and the library are one region: one stop of Tab, the arrows
  // going down through the pages into the library and back.
  const group = createListGroup({ region: "sidebar" });
  const nav = createListKeys({
    count: () => navEntries().length,
    group,
    order: () => 0,
    activate: (i) => {
      const entry = navEntries()[i];
      if (entry) go(entry.route);
    },
    start: () => Math.max(0, navEntries().findIndex((e) => isShown(e.route))),
  });
  return (
    <View
      role="navigation"
      class={terminal ? "min-h-0 flex-1 gap-1" : "min-h-0 flex-1 gap-2"}
    >
      <View
        ref={nav.ref}
        focusable={nav.focusable()}
        onFocus={nav.onFocus}
        onBlur={nav.onBlur}
        class={terminal ? "" : `relative gap-1 rounded-(--radius-panel) border border-border bg-card p-2`}
      >
        <If when={!terminal}>
          <NavIndicator />
        </If>
        {/* The desktop searches from the header's top-right corner; the
            phone's drawer and the terminal keep Search here. */}
        <Each of={navEntries()} key={(e) => e.label}>
          {(entry, i) => <NavItem icon={entry().icon} label={entry().label} route={entry().route} compact={compact()} keys={nav} index={i()} />}
        </Each>
      </View>
      <LibraryPanel compact={compact()} group={group} />
      {/* The account: a panel of its own, its row like every other. */}
      <View class={terminal ? "" : "rounded-(--radius-panel) border border-border bg-card p-2"}>
        <Account compact={compact()} />
      </View>
    </View>
  );
}
