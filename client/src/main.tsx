import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const LOGIN_PATHS = new Set(["/login", "/register"]);
const AUTH_MUTATIONS = new Set([
  "auth.login",
  "auth.register",
  "auth.logout",
]);

function isUnauthorized(error: unknown) {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return false;
  }

  const data = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "UNAUTHORIZED"
  );
}

function redirectToLoginIfUnauthorized(error: unknown) {
  if (
    !isUnauthorized(error) ||
    typeof window === "undefined" ||
    LOGIN_PATHS.has(window.location.pathname)
  ) {
    return;
  }

  window.location.assign("/login");
}

const queryClient = new QueryClient();

// Captura erros de queries protegidas sem interromper o fluxo da tela de login.
queryClient.getQueryCache().subscribe(event => {
  if (event.type !== "updated" || event.query.state.status !== "error") {
    return;
  }

  redirectToLoginIfUnauthorized(event.query.state.error);
});

// Captura erros de mutations protegidas, mas não trata falhas de login/cadastro
// como sessão expirada — nesses casos, a própria tela exibe a mensagem ao usuário.
queryClient.getMutationCache().subscribe(event => {
  if (event.type !== "updated" || event.mutation.state.status !== "error") {
    return;
  }

  const mutationKey = event.mutation.options.mutationKey;
  const procedureName = Array.isArray(mutationKey)
    ? mutationKey.filter(part => typeof part === "string").join(".")
    : "";

  if (AUTH_MUTATIONS.has(procedureName)) {
    return;
  }

  redirectToLoginIfUnauthorized(event.mutation.state.error);
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>,
);
