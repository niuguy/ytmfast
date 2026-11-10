// The menus of songs and of collections: what can be done with one beyond
// playing it. A song's: play next, add to the queue, its radio, like or
// dislike it, add it to a playlist (the account's, or a new one), take it
// out of a playlist of the account's own, go to its album. A collection's
// (a card, a page's header): play next, add to the queue, its radio, save it
// to the library. Each opens from a "…" button (`SongMenuButton`,
// `ItemMenuButton`) and from the secondary button (`SongContextMenu`,
// `ItemContextMenu`).

import { type JSX, signal, Text, View } from "nsh";
import { Button, ContextMenu, Menu, MenuItem, MenuSeparator, Submenu } from "nsh/base";
import type { Item, PlaylistChoice } from "../../backend/types";
import { kindOf } from "../../backend/types";
import { open } from "../../nav";
import { backend } from "../../state/engine";
import { addToPlaylist, addToQueue, rate, removeFromPlaylist, setSaved, startRadio } from "../../state/library";
import { openNewPlaylist } from "../../state/overlays";
import { player } from "../../state/player";
import { ready, signedIn } from "../../state/session";
import { focusRing, Hint, LAYER, menuItem, popupSurface, terminal } from "../ui/controls";
import { Icon, type IconName } from "../ui/icons";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "../ui/menu";

/** A song as a menu needs it. */
export interface MenuSong {
  uri: string;
  name: string;
  albumUri?: string;
  /** Its row's id in a playlist (a playlist of the account's own takes it
   * out by it). */
  uid?: string;
}

/** Where a song's menu was opened: the collection it is listed in. */
export interface MenuContext {
  uri: string;
  /** A playlist of the account's own. */
  editable?: boolean;
}

const MENU_WIDTH = 240;

/** What a menu row shows: its icon, then its label; a chevron for one that
 * opens more. */
function EntryContent(props: { icon: IconName; label: string; more?: boolean }) {
  return (
    <View class="flex-1 flex-row items-center gap-2.5">
      <If when={!terminal}>
        <View class="w-5 items-center">
          <Icon name={props.icon} size={16} color="muted-foreground" />
        </View>
      </If>
      <Text class="flex-1 text-sm text-popover-foreground">{props.label}</Text>
      <If when={props.more && !terminal}>
        <Icon name="chevronRight" size={14} color="muted-foreground" />
      </If>
    </View>
  );
}

/** One row of a menu. */
function Entry(props: { icon: IconName; label: string; disabled?: boolean; onSelect?: () => void }) {
  return (
    <MenuItem
      onSelect={props.onSelect}
      disabled={props.disabled ?? false}
      accessibilityLabel={props.label}
      class={terminal ? "px-1 focus:bg-muted" : menuItem}
    >
      <EntryContent icon={props.icon} label={props.label} />
    </MenuItem>
  );
}

const Separator = () => <MenuSeparator class={terminal ? "hidden" : "-mx-1 my-1 h-px bg-border"} />;

/** "Add to playlist ›": a new playlist, then the account's playlists, loaded
 * when it first opens. */
function AddToPlaylist(props: { song: MenuSong }) {
  const choices = signal<PlaylistChoice[] | null>(null);
  const load = () => {
    if (choices() !== null || signedIn() !== true) return;
    backend
      .playlistChoices(props.song.uri)
      .then((list) => choices.set(list))
      .catch(() => choices.set([]));
  };
  return (
    <Submenu
      offset={4}
      disabled={signedIn() !== true}
      onOpenChange={(e) => e.open && load()}
      class={terminal ? "px-1 focus:bg-muted" : menuItem}
      trigger={<EntryContent icon="plus" label="Add to playlist" more />}
    >
      {/* Its popup takes its menu's look (popupClass, popupStyle). */}
      <>
        <Entry icon="plus" label="New playlist…" onSelect={() => openNewPlaylist(props.song.uri)} />
        <If when={(choices() ?? []).length > 0}>
          <Separator />
        </If>
        <If when={choices() === null && !terminal}>
          <View class="h-8 justify-center px-2.5">
            <Text class="text-sm text-muted-foreground">Loading…</Text>
          </View>
        </If>
        <Each of={choices() ?? []} key={(c) => c.uri}>
          {(choice) => <Entry icon="queue" label={choice().name} onSelect={() => void addToPlaylist(choice().uri, props.song.uri)} />}
        </Each>
      </>
    </Submenu>
  );
}

/** A song's menu items. */
export function SongMenuItems(props: { song: MenuSong; context?: MenuContext }) {
  const playing = () => player().trackUri === props.song.uri;
  const liked = () => playing() && player().liked;
  const disliked = () => playing() && player().disliked;
  // Only a playlist's own rows (an id that is no index) can be taken out.
  const removable = () => !!props.context?.editable && !!props.song.uid && !props.song.uid.includes(":");
  return (
    <>
      <Entry icon="playNext" label="Play next" disabled={!ready()} onSelect={() => void addToQueue(props.song.uri, true)} />
      <Entry icon="queue" label="Add to queue" disabled={!ready()} onSelect={() => void addToQueue(props.song.uri, false)} />
      <Entry icon="radio" label="Start radio" disabled={!ready()} onSelect={() => void startRadio(props.song.uri)} />
      <Separator />
      <Entry
        icon={liked() ? "heartFilled" : "heart"}
        label={liked() ? "Remove from Liked Songs" : "Add to Liked Songs"}
        onSelect={() => void rate(props.song.uri, liked() ? "none" : "like")}
      />
      <Entry
        icon={disliked() ? "thumbDownFilled" : "thumbDown"}
        label={disliked() ? "Remove dislike" : "Dislike"}
        onSelect={() => void rate(props.song.uri, disliked() ? "none" : "dislike")}
      />
      <AddToPlaylist song={props.song} />
      <If when={removable()}>
        <Entry
          icon="trash"
          label="Remove from this playlist"
          onSelect={() => void removeFromPlaylist(props.context!.uri, props.song.uri, props.song.uid!)}
        />
      </If>
      <If when={!!props.song.albumUri}>
        <Separator />
        <Entry icon="disc" label="Go to album" onSelect={() => open({ name: "collection", uri: props.song.albumUri! })} />
      </If>
    </>
  );
}

/** A collection's (or a mix's) menu items; `saved` is whether it is in the
 * library, when known. */
export function ItemMenuItems(props: { item: Pick<Item, "uri" | "kind" | "name">; saved?: boolean | null }) {
  const kind = () => props.item.kind || kindOf(props.item.uri);
  const queueable = () => ["album", "playlist", "collection", "mix", "track"].includes(kind());
  const radio = () => ["album", "playlist", "artist", "track"].includes(kind());
  const savable = () => (kind() === "album" || kind() === "playlist") && props.saved !== null;
  return (
    <>
      <If when={queueable()}>
        <Entry icon="playNext" label="Play next" disabled={!ready()} onSelect={() => void addToQueue(props.item.uri, true)} />
        <Entry icon="queue" label="Add to queue" disabled={!ready()} onSelect={() => void addToQueue(props.item.uri, false)} />
      </If>
      <If when={radio()}>
        <Entry icon="radio" label="Start radio" disabled={!ready()} onSelect={() => void startRadio(props.item.uri)} />
      </If>
      <If when={savable()}>
        <Separator />
        <Entry
          icon={props.saved ? "bookmarkFilled" : "bookmark"}
          label={props.saved ? "Remove from library" : "Save to library"}
          onSelect={() => void setSaved(props.item.uri, !props.saved)}
        />
      </If>
    </>
  );
}

/** The "…" button that opens a menu (`children`), named after what it is
 * for. */
function MoreButton(props: { label: string; size?: number; children: JSX.Element; class?: string }) {
  const isOpen = signal(false);
  return (
    <Menu
      open={isOpen()}
      onOpenChange={(e) => isOpen.set(e.open)}
      placement="bottom"
      align="end"
      offset={4}
      popupClass={popupSurface}
      popupStyle={{ ...menuPopupStyle("bottom", "end"), width: MENU_WIDTH }}
      popupStartingStyle={menuPopupHidden("bottom", "end")}
      popupEndingStyle={menuPopupLeaving("bottom", "end")}
      trigger={
        <Button
          accessibilityLabel={props.label}
          selected={isOpen()}
          tooltip={<Hint label="More" />}
          class={
            terminal
              ? "px-1 focus:bg-muted"
              : `size-8 items-center justify-center rounded-full ${LAYER} hover:bg-muted active:scale-90 selected:bg-muted ${focusRing} ${props.class ?? ""}`
          }
        >
          <If when={!terminal} else={<Text class="text-foreground">[…]</Text>}>
            <Icon name="dots" size={props.size ?? 18} color="muted-foreground" />
          </If>
        </Button>
      }
    >
      {props.children}
    </Menu>
  );
}

/** A song's "…" button. */
export function SongMenuButton(props: { song: MenuSong; context?: MenuContext; class?: string }) {
  return (
    <MoreButton label={`More for ${props.song.name}`} class={props.class}>
      <SongMenuItems song={props.song} context={props.context} />
    </MoreButton>
  );
}

/** A collection's "…" button. */
export function ItemMenuButton(props: { item: Pick<Item, "uri" | "kind" | "name">; saved?: boolean | null; size?: number }) {
  return (
    <MoreButton label={`More for ${props.item.name}`} size={props.size}>
      <ItemMenuItems item={props.item} saved={props.saved} />
    </MoreButton>
  );
}

const contextPopup = {
  popupClass: popupSurface,
  popupStyle: { width: MENU_WIDTH },
};

/** `children` (a song's row) with the song's menu on the secondary button. */
export function SongContextMenu(props: { song: MenuSong | undefined; context?: MenuContext; children: JSX.Element }) {
  return (
    <ContextMenu {...contextPopup} disabled={!props.song} trigger={props.children}>
      <If when={props.song}>{(song) => <SongMenuItems song={song()} context={props.context} />}</If>
    </ContextMenu>
  );
}

/** `children` (a card) with its item's menu on the secondary button. */
export function ItemContextMenu(props: { item: Item | undefined; children: JSX.Element }) {
  const menuable = () => !!props.item && ["album", "playlist", "collection", "mix", "track", "artist"].includes(props.item.kind);
  return (
    <ContextMenu {...contextPopup} disabled={!menuable()} trigger={props.children}>
      <If when={props.item}>
        {(item) => (
          <If when={item().kind === "track"} else={<ItemMenuItems item={item()} />}>
            <SongMenuItems song={{ uri: item().uri, name: item().name }} />
          </If>
        )}
      </If>
    </ContextMenu>
  );
}
