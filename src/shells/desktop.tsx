// The desktop's shell: the sidebar (a rail on narrow windows) down the left,
// and the pages on the right with the player floating over their bottom, a
// pill the pages scroll behind.

import { View } from "nsh";
import { Toolbar } from "nsh/base";
import { Region } from "../components/ui/regions";
import { barSize, railSidebar, sidebarShown, sidebarWidth } from "../components/layout";
import { animateLayoutOn } from "../components/ui/motion";
import { Sidebar } from "../components/library/sidebar";
import { PlayerBar } from "../components/player/player-bar";
import { MainStack } from "./main";
import { nowPlayingOpen } from "../state/overlays";
import { TitleBar, titleBarArea } from "../components/ui/title-bar";
import { NavControls, TrailingControls } from "../components/header";

export function DesktopShell() {
  // Crossing a breakpoint, the sidebar and the player bar glide to their
  // new arrangement.
  animateLayoutOn(() => `${sidebarWidth()}|${barSize()}`);
  return (
    <View class="flex-1">
      {/* The header's controls, after the name: one stop of Tab, Left and
          Right between its buttons (the search field is a stop of its own). */}
      <TitleBar>
        <Region.Provider value={{ name: "header" }}>
          <Toolbar accessibilityLabel="Header" class="flex-1 items-center gap-2">
            <NavControls />
            <View class="flex-1" />
            <TrailingControls />
          </Toolbar>
        </Region.Provider>
      </TitleBar>
      <View class="flex-1 flex-row gap-2 px-2 pb-2" style={{ paddingTop: titleBarArea().height > 0 ? 0 : 8 }}>
        <If when={sidebarShown()}>
          <View class="shrink-0" style={{ width: sidebarWidth() }}>
            <Sidebar compact={railSidebar()} />
          </View>
        </If>
        <View class="relative min-w-0 flex-1">
          <MainStack class="min-w-0 overflow-hidden" />
          {/* Not drawn under Now Playing, which covers it. */}
          <If when={!nowPlayingOpen()}>
            <View class="absolute inset-x-3 bottom-1">
              <PlayerBar />
            </View>
          </If>
        </View>
      </View>
    </View>
  );
}
