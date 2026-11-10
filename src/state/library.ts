// What the user does to the queue and the library, beyond playing: play
// next and add to the queue, radio, likes and dislikes, saving albums and
// playlists, subscribing to artists, and editing playlists. Each asks the
// backend, says how it went in a toast, and has the pages that show it load
// again (`refreshData`).

import { signal } from "nsh";
import type { Queue, Rating } from "../backend/types";
import { backend } from "./engine";
import { notify, report } from "./feedback";
import { closeNewPlaylist } from "./overlays";
import { player } from "./player";
import { askToSignIn, ready, refreshData, signedIn } from "./session";

/** The queue as last read (tracked): the queue panel shows it, and every
 * change to the queue answers it anew. */
const queueNow = signal<Queue | null>(null);
export const queue = () => queueNow();

/** Reads the queue again. */
export async function loadQueue(): Promise<void> {
  if (!ready()) return;
  try {
    queueNow.set(await backend.queue());
  } catch (error) {
    console.warn("ytmfast: the queue didn't load:", String(error));
  }
}

/** Whether the account is signed in; asks to sign in when it isn't. */
function needAccount(): boolean {
  if (signedIn() === true) return true;
  askToSignIn();
  return false;
}

/** Puts a song, album, playlist or mix after the one playing (`next`), or
 * at the end of the queue. */
export async function addToQueue(uri: string, next: boolean): Promise<void> {
  if (!ready()) return;
  try {
    queueNow.set(await backend.queueAdd(uri, next));
    notify(next ? "playsNext" : "addedToQueue");
  } catch (error) {
    report("queueFailed", error);
  }
}

/** Takes the queue's entry `id` out of it. */
export async function removeFromQueue(id: string): Promise<void> {
  try {
    queueNow.set(await backend.queueRemove(id));
  } catch (error) {
    report("queueFailed", error);
  }
}

/** Plays the queue's entry `id`. */
export async function jumpInQueue(id: string): Promise<void> {
  try {
    queueNow.set(await backend.queueJump(id));
  } catch (error) {
    report("queueFailed", error);
  }
}

/** Plays the radio of a song, album, playlist or artist. */
export async function startRadio(uri: string): Promise<void> {
  if (!ready()) return;
  try {
    await backend.startRadio(uri);
  } catch (error) {
    report("radioFailed", error);
  }
}

/** Rates a song; the one playing goes through the player, so its controls
 * follow at once. */
export async function rate(trackUri: string, rating: Rating): Promise<void> {
  if (!needAccount()) return;
  try {
    const p = player();
    if (p.trackUri === trackUri && rating === "dislike") await backend.setDisliked(true);
    else if (p.trackUri === trackUri && rating === "like") await backend.setLiked(true);
    else if (p.trackUri === trackUri && rating === "none") {
      if (p.disliked) await backend.setDisliked(false);
      if (p.liked) await backend.setLiked(false);
    } else await backend.rate(trackUri, rating);
    if (rating === "like") notify("liked");
    if (rating === "dislike") notify("disliked");
    refreshData();
  } catch (error) {
    report("libraryFailed", error);
  }
}

/** Saves an album or playlist to the library, or takes it out. */
export async function setSaved(uri: string, on: boolean): Promise<void> {
  if (!needAccount()) return;
  try {
    await backend.setSaved(uri, on);
    notify(on ? "savedToLibrary" : "removedFromLibrary");
    refreshData();
  } catch (error) {
    report("libraryFailed", error);
  }
}

/** Subscribes to an artist, or unsubscribes. */
export async function setSubscribed(artistUri: string, on: boolean): Promise<void> {
  if (!needAccount()) return;
  try {
    await backend.setSubscribed(artistUri, on);
    notify(on ? "subscribed" : "unsubscribed");
    refreshData();
  } catch (error) {
    report("libraryFailed", error);
  }
}

/** Adds a song to one of the account's playlists. */
export async function addToPlaylist(playlistUri: string, trackUri: string): Promise<void> {
  if (!needAccount()) return;
  try {
    await backend.addToPlaylist(playlistUri, trackUri);
    notify("addedToPlaylist");
    refreshData();
  } catch (error) {
    report("libraryFailed", error);
  }
}

/** Makes a private playlist named `name`, with `trackUri` in it when given;
 * answers its URI, or null when it failed. */
export async function createPlaylist(name: string, trackUri: string | null): Promise<string | null> {
  if (!needAccount()) return null;
  try {
    const uri = await backend.createPlaylist(name, trackUri);
    closeNewPlaylist();
    notify("playlistMade");
    refreshData();
    return uri;
  } catch (error) {
    report("libraryFailed", error);
    return null;
  }
}

/** Takes a song's row (its `uid`) out of one of the account's playlists. */
export async function removeFromPlaylist(playlistUri: string, trackUri: string, uid: string): Promise<void> {
  if (!needAccount()) return;
  try {
    await backend.removeFromPlaylist(playlistUri, trackUri, uid);
    notify("removedFromPlaylist");
    refreshData();
  } catch (error) {
    report("libraryFailed", error);
  }
}
