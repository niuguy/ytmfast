// A page of the main stack. Its content sits on the app's own background:
// NSH's Linux stack fills each page with libadwaita's grey, not the theme's
// (nsh-platform-linux navigation.rs `window_color`), so the page paints
// over it. On the desktops the header is drawn inside the page, over an
// optional `backdrop` that reaches the top; phones and terminals take the
// stack's header.

import { type JSX, View } from "nsh";
import { NavPage } from "nsh/base";
import { AccountAction, PageHeader } from "./header";
import { layout } from "./layout";
import { terminal } from "./ui/controls";
import { pageAnimation } from "../nav";

export function AppPage(props: {
  title: string;
  testID: string;
  /** Whether the page is the one shown, on top of the stack (tracked): its
   * header is the window's header region then (Ctrl+Up). */
  shown: () => boolean;
  backdrop?: JSX.Element;
  children: JSX.Element;
}) {
  const inside = () => layout() === "desktop" && !terminal;
  return (
    <NavPage
      title={props.title}
      header={inside() ? undefined : <PageHeader title={props.title} shown={props.shown} />}
      headerRight={<AccountAction />}
      testID={props.testID}
      animation={pageAnimation()}
    >
      <View class={terminal ? "flex-1" : inside() ? "absolute inset-0 bg-sidebar" : "flex-1 bg-sidebar"}>
        <If when={inside()}>
          {props.backdrop}
          <PageHeader title={props.title} shown={props.shown} />
        </If>
        {props.children}
      </View>
    </NavPage>
  );
}
