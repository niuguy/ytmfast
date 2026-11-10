// The phone's shell: the pages full width, the
// mini player, and tabs for the library (first: its drawer opens from
// the left, with the whole sidebar), Explore (the
// home page) and Liked Songs. iOS and Android get the
// system's tab bar and header; elsewhere the app draws its own.

import { platform, Text, View } from "nsh";
import { Tab, Tabs } from "nsh/base";
import { BackHandler, isAvailable as mobile, TabBar } from "nsh/mobile";
import { Sidebar } from "../components/library/sidebar";
import { MiniPlayer } from "../components/player/player-bar";
import { focusRing } from "../components/ui/controls";
import { Icon, type IconName } from "../components/ui/icons";
import { AppSheet } from "../components/ui/overlays";
import { currentRoot, HOME, LIKED, nav, openRoot } from "../nav";
import { drawerOpen, setDrawerOpen } from "../state/overlays";
import { MainStack } from "./main";

type TabId = "home" | "liked" | "library";

const TABS: { id: TabId; label: string; icon: IconName; symbol: string }[] = [
  { id: "library", label: "Library", icon: "library", symbol: "books.vertical" },
  { id: "home", label: "Explore", icon: "compass", symbol: "safari" },
  { id: "liked", label: "Liked", icon: "heart", symbol: "heart" },
];

/** The tab that shows now (tracked). */
function selectedTab(): TabId {
  if (drawerOpen()) return "library";
  return currentRoot() === LIKED ? "liked" : "home";
}

function choose(id: TabId) {
  if (id === "library") {
    setDrawerOpen(!drawerOpen());
    return;
  }
  setDrawerOpen(false);
  openRoot(id === "home" ? HOME : LIKED);
}

/** The app's tabs, where the system has no tab bar (the web). */
function AppTabs() {
  return (
    <Tabs class="flex-row items-stretch border-t border-border bg-player px-2 pt-1 pb-[env(safe-area-inset-bottom)]">
      <Each of={TABS} key={(t) => t.id}>
        {(tab) => (
          <Tab
            selected={selectedTab() === tab().id}
            accessibilityLabel={tab().label}
            onPress={() => choose(tab().id)}
            class={`group min-h-12 flex-1 items-center justify-center gap-1 rounded-(--radius) py-2 active:opacity-60 ${focusRing}`}
          >
            <Icon name={tab().icon} size={24} color={selectedTab() === tab().id ? "foreground" : "muted-foreground"} />
            <Text class="text-xs font-medium text-muted-foreground group-selected:text-foreground">{tab().label}</Text>
          </Tab>
        )}
      </Each>
    </Tabs>
  );
}

export function PhoneShell() {
  // Android's back: from another root (Liked Songs), back goes Home before
  // it leaves.
  if (mobile) BackHandler.on("press", () => {
    if (drawerOpen()) {
      setDrawerOpen(false);
      return true;
    }
    if (nav.routes().length === 1 && currentRoot() !== HOME) {
      openRoot(HOME);
      return true;
    }
    return false;
  });
  return (
    <View class="flex-1">
      <MainStack />
      <MiniPlayer />
      <If
        when={mobile}
        else={<AppTabs />}
      >
        <TabBar
          items={TABS.map((t) => ({ title: t.label, icon: platform.select({ ios: t.symbol }) ?? null }))}
          selectedIndex={TABS.findIndex((t) => t.id === selectedTab())}
          onChange={({ index }) => choose(TABS[index].id)}
        />
      </If>
      <AppSheet open={drawerOpen()} onOpenChange={setDrawerOpen} side="left" testID="drawer">
        <View class="flex-1 p-2 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <Sidebar />
        </View>
      </AppSheet>
    </View>
  );
}
