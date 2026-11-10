// `alpha` takes the colour forms `token()` may give and always makes them
// translucent: a colour it cannot read must not come back opaque by surprise.
import { expect, test } from "nsh/test";
import { alpha } from "./tint";

test("alpha makes any colour form translucent", () => {
  expect(alpha("#ffffff", 0.16)).toBe("#ffffff29");
  expect(alpha("#fff", 0.5)).toBe("#ffffff80");
  expect(alpha("#ffffff80", 0.5)).toBe("#ffffff40");
  expect(alpha("rgb(243, 245, 246)", 0.16)).toBe("#f3f5f629");
  expect(alpha("rgba(255,255,255,0.5)", 1)).toBe("#ffffff80");
  expect(alpha("transparent", 0.5)).toBe("transparent");
});
