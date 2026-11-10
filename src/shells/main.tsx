// The main content every shell shows: the navigation stack of pages, or,
// while the session has failed, one page-level state with Retry.

import { View } from "nsh";
import { NavStack } from "nsh/base";
import { ErrorState } from "../components/ui/feedback";
import { nav, type Route } from "../nav";
import { CollectionPage } from "../pages/collection";
import { HomePage } from "../pages/home";
import { SearchPage } from "../pages/search";
import { health, retry } from "../state/session";

function page(route: Route) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage />;
    case "collection":
      return <CollectionPage uri={route.uri} />;
    default:
      return <HomePage />;
  }
}

/** Why the session failed, for the user: one sentence they can act on. */
function unavailableDetail(): string | undefined {
  const error = health().error;
  if (error?.code === "E_PROFILE_IN_USE") {
    return "YTMFast's browser profile is in use by another process. Quit the other YTMFast and retry.";
  }
  return undefined;
}

export function MainStack(props: { class?: string }) {
  return (
    <View class={`min-h-0 flex-1 ${props.class ?? ""}`}>
      <If
        when={health().status !== "failed"}
        else={<ErrorState message="YouTube Music isn't available" detail={unavailableDetail()} onRetry={retry} />}
      >
        <NavStack state={nav} class="flex-1" testID="main">
          {(route) => page(route)}
        </NavStack>
      </If>
    </View>
  );
}
