// Small pictures ask Spotify for small images; anything else is left alone.
import { expect, test } from "nsh/test";
import { imageFor } from "./images";

test("small covers take the small variant", () => {
  expect(imageFor("https://i.scdn.co/image/ab67616d00001e02abc", 36)).toBe("https://i.scdn.co/image/ab67616d00004851abc");
  expect(imageFor("https://i.scdn.co/image/ab67616d0000b273abc", 30)).toBe("https://i.scdn.co/image/ab67616d00004851abc");
  expect(imageFor("https://i.scdn.co/image/ab6761610000e5ebabc", 30)).toBe("https://i.scdn.co/image/ab6761610000f178abc");
  expect(imageFor("https://mosaic.scdn.co/300/aaa/bbb", 30)).toBe("https://mosaic.scdn.co/60/aaa/bbb");
});

test("large or unknown pictures keep their URL", () => {
  expect(imageFor("https://i.scdn.co/image/ab67616d00001e02abc", 96)).toBe("https://i.scdn.co/image/ab67616d00001e02abc");
  expect(imageFor("https://i.scdn.co/image/ab67616d00001e02abc", undefined)).toBe("https://i.scdn.co/image/ab67616d00001e02abc");
  expect(imageFor("https://example.com/x.png", 30)).toBe("https://example.com/x.png");
  expect(imageFor("", 30)).toBe("");
});
