import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AuthPage from "./pages/Auth";
import WorkspacePages from "./pages/WorkspacePages";
import { useAuth } from "./_core/hooks/useAuth";
import { PageState } from "./components/AppShell";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/login" });
  if (loading) return <PageState kind="loading" title="Abrindo seu workspace" description="Validando sua sessão segura." />;
  if (!user) return <PageState kind="loading" title="Redirecionando" description="Você será levado para o login do ProdutivaAI." />;
  return <>{children}</>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Home} />
    <Route path="/login">{() => <AuthPage mode="login" />}</Route>
    <Route path="/register">{() => <AuthPage mode="register" />}</Route>
    <Route path="/dashboard">{() => <Protected><WorkspacePages page="dashboard" /></Protected>}</Route>
    <Route path="/chat">{() => <Protected><WorkspacePages page="chat" /></Protected>}</Route>
    <Route path="/projects/:id">{params => <Protected><WorkspacePages page="project" projectId={Number(params.id)} /></Protected>}</Route>
    <Route path="/projects">{() => <Protected><WorkspacePages page="projects" /></Protected>}</Route>
    <Route path="/tasks">{() => <Protected><WorkspacePages page="tasks" /></Protected>}</Route>
    <Route path="/search">{() => <Protected><WorkspacePages page="search" /></Protected>}</Route>
    <Route path="/settings">{() => <Protected><WorkspacePages page="settings" /></Protected>}</Route>
    <Route path="/billing">{() => <Protected><WorkspacePages page="billing" /></Protected>}</Route>
    <Route path="/404">{() => <PageState kind="error" title="Página não encontrada" description="O endereço que você tentou acessar não existe." action={<a href="/dashboard" className="button button-dark">Voltar ao workspace</a>} />}</Route>
    <Route>{() => <Redirect to="/404" />}</Route>
  </Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster position="bottom-right" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
