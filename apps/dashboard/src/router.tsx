import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppLayout, PagePending } from "./layout/AppLayout";
import { NotFound } from "./pages/NotFound";
import { SignIn } from "./pages/SignIn";

const root = createRootRoute({
  component: AppLayout,
  notFoundComponent: NotFound,
});

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/sign-in",
  // `?error` (any value) means the Worker's callback failed.
  validateSearch: (s: Record<string, unknown>): { error?: string } =>
    "error" in s ? { error: String(s.error ?? "") } : {},
  component: function SignInRoute() {
    const { error } = signIn.useSearch();
    return <SignIn failed={error !== undefined} />;
  },
});

const routeTree = root.addChildren([
  // Each page is its own chunk, loaded when its route is first shown.
  createRoute({
    getParentRoute: () => root,
    path: "/",
    component: lazyRouteComponent(
      () => import("./machines/Machines"),
      "Machines",
    ),
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/agents",
    component: lazyRouteComponent(() => import("./agents/Agents"), "Agents"),
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: lazyRouteComponent(
      () => import("./settings/Settings"),
      "Settings",
    ),
  }),
  signIn,
  createRoute({ getParentRoute: () => root, path: "*", component: NotFound }),
]);

export const createAppRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree,
    history,
    // A cold navigation shows Loading at once, never an empty page.
    defaultPendingComponent: PagePending,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
