// The terminal's shell: Cells and text. The sidebar's rows on the left, the
// page beside it, the player's two rows along the bottom; toasts take the
// status line. No images, gradients, shadows or point widths.

import { View } from "nsh";
import { Sidebar } from "../components/library/sidebar";
import { TerminalPlayer } from "../components/player/player-bar";
import { MainStack } from "./main";

export function TerminalShell() {
  return (
    <View class="flex-1">
      <View class="min-h-0 flex-1 flex-row gap-1">
        <View class="w-1/4 border-r border-border">
          <Sidebar />
        </View>
        <MainStack class="min-w-0" />
      </View>
      <TerminalPlayer />
    </View>
  );
}
