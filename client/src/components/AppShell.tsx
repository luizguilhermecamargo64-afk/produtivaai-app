import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BookOpen, BriefcaseBusiness, CreditCard, FolderKanban, Home, LayoutDashboard, ListTodo, LogOut, Menu, MessageSquare, Search, Settings2, Sparkles, X } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/chat", label: "Conversas", icon: MessageSquare },
  { href: "/projects", label: "Projetos", icon: FolderKanban },
  { href: "/tasks", label: "Tarefas", icon: ListTodo },
  { href: "/search", label: "Busca", icon: Search },
];

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className={cn("brand-lockup", compact && "brand-lockup-compact")}><span className="brand-mark" aria-hidden="true"><i /><b /></span>{!compact && <span className="brand-name">Produtiva<span>AI</span></span>}</div>;
}

export function AppShell({ children, eyebrow, title, actions }: { children: React.ReactNode; eyebrow?: string; title: string; actions?: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const handleLogout = async () => {
    try { await logout(); toast.success("Sessão encerrada."); } catch { toast.error("Não foi possível encerrar a sessão."); }
    utils.auth.me.setData(undefined, null);
  };
  return <div className="app-shell">
    <aside className={cn("app-rail", open && "app-rail-open")}>
      <div className="rail-top"><Link href="/dashboard" onClick={() => setOpen(false)}><BrandMark /></Link><button className="icon-button mobile-only" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      <nav className="rail-nav" aria-label="Navegação principal">
        <p className="rail-label">Workspace</p>
        {navItems.map(item => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn("rail-link", location === item.href && "rail-link-active")}><Icon size={18} /><span>{item.label}</span></Link>; })}
        <p className="rail-label rail-label-spaced">Conta</p>
        <Link href="/billing" onClick={() => setOpen(false)} className={cn("rail-link", location === "/billing" && "rail-link-active")}><CreditCard size={18} /><span>Plano e uso</span></Link>
        <Link href="/settings" onClick={() => setOpen(false)} className={cn("rail-link", location === "/settings" && "rail-link-active")}><Settings2 size={18} /><span>Configurações</span></Link>
      </nav>
      <div className="rail-bottom">
        <div className="rail-tip"><Sparkles size={16} /><span>Clareza para a próxima coisa importante.</span></div>
        {user ? <div className="user-card"><div className="avatar">{(user.name || user.email || "P").slice(0, 1).toUpperCase()}</div><div className="user-copy"><strong>{user.name || "Sua conta"}</strong><small>{user.email || "Conta local"}</small></div><button className="icon-button" onClick={handleLogout} aria-label="Sair"><LogOut size={16} /></button></div> : <Link href="/login" className="button button-dark button-full">Entrar</Link>}
      </div>
    </aside>
    {open && <button className="mobile-scrim" onClick={() => setOpen(false)} aria-label="Fechar menu" />}
    <main className="app-main">
      <header className="app-header"><button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={22} /></button><div><p className="eyebrow">{eyebrow || "PRODUTIVAAI / WORKSPACE"}</p><h1>{title}</h1></div><div className="header-actions">{actions}</div></header>
      <div className="app-content">{children}</div>
    </main>
  </div>;
}

export function PageState({ kind, title, description, action }: { kind: "loading" | "empty" | "error"; title: string; description: string; action?: React.ReactNode }) {
  return <div className={cn("page-state", `page-state-${kind}`)}><div className="state-orb">{kind === "loading" ? <div className="spinner" /> : kind === "error" ? <X size={22} /> : <Sparkles size={22} />}</div><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export const WorkspaceIcon = Home;
export const StudyIcon = BookOpen;
export const WorkIcon = BriefcaseBusiness;
