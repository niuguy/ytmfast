// Small pictures ask Google's image hosts for small images; anything else is
// left alone.
import { expect, test } from "nsh/test";
import { imageFor } from "./images";

test("small covers take the small variant", () => {
  expect(imageFor("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", 36)).toBe("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj");
  expect(imageFor("https://yt3.googleusercontent.com/abc=w226-h226-l90-rj", 30)).toBe("https://yt3.googleusercontent.com/abc=w120-h120-l90-rj");
  expect(imageFor("https://yt3.ggpht.com/abc=w544-h544", 30)).toBe("https://yt3.ggpht.com/abc=w120-h120");
  // Already small: unchanged.
  expect(imageFor("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", 30)).toBe("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj");
});

test("large or unknown pictures keep their URL", () => {
  expect(imageFor("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", 96)).toBe("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj");
  expect(imageFor("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", undefined)).toBe("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj");
  expect(imageFor("https://i.ytimg.com/vi/x/hqdefault.jpg", 30)).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
  expect(imageFor("https://example.com/x.png", 30)).toBe("https://example.com/x.png");
  expect(imageFor("", 30)).toBe("");
});
