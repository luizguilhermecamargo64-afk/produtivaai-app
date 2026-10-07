import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, LockKeyhole, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const MAINFRAME_VIDEO = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_041744_63efcd78-bf7d-4039-99e2-2461e8a61903.mp4";
const TYPEWRITER_TEXT = "Glad you stopped in. Good taste tends to find us. Now, what are we building?";

function useTypewriter(text: string, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let index = 0;
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        index += 1;
        setDisplayed(text.slice(0, index));
        if (index >= text.length) {
          if (timer) window.clearInterval(timer);
          setDone(true);
        }
      }, speed);
    }, startDelay);
    return () => {
      window.clearTimeout(start);
      if (timer) window.clearInterval(timer);
    };
  }, [text, speed, startDelay]);
  return { displayed, done };
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pillsVisible, setPillsVisible] = useState(false);
  const { displayed, done } = useTypewriter(TYPEWRITER_TEXT);
  const isRegister = mode === "register";
  const loginMutation = trpc.auth.login.useMutation();
  const registerMutation = trpc.auth.register.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!loading && user) navigate("/dashboard");
  }, [loading, user, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPillsVisible(true), 400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let previousX: number | null = null;
    let targetTime = 0;
    let seekQueued = false;
    const seek = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (video.seeking) {
        seekQueued = true;
        return;
      }
      const next = Math.max(0, Math.min(video.duration, targetTime));
      if (Math.abs(video.currentTime - next) > 0.01) video.currentTime = next;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (previousX === null) {
        previousX = event.clientX;
        return;
      }
      const delta = event.clientX - previousX;
      previousX = event.clientX;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      targetTime = Math.max(0, Math.min(video.duration, (video.currentTime || 0) + (delta / Math.max(window.innerWidth, 1)) * 0.8 * video.duration));
      seek();
    };
    const onSeeked = () => {
      if (seekQueued) {
        seekQueued = false;
        seek();
      }
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    video.addEventListener("seeked", onSeeked);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      video.removeEventListener("seeked", onSeeked);
    };
  }, []);

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText("hello@mainframe.co");
      toast.success("E-mail copiado.");
    } catch {
      toast.error("Não foi possível copiar o e-mail.");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      if (isRegister) {
        if (password !== confirmPassword) {
          const message = "As senhas não são iguais.";
          setErrorMessage(message);
          toast.error(message);
          return;
        }
        const result = await registerMutation.mutateAsync({ name, email, password, confirmPassword });
        if (result.success) {
          await utils.auth.me.invalidate();
          toast.success("Conta criada com sucesso!");
          navigate("/dashboard");
        }
        return;
      }
      const result = await loginMutation.mutateAsync({ email, password });
      if (result.success) {
        await utils.auth.me.invalidate();
        toast.success("Login realizado com sucesso!");
        navigate("/dashboard");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
      setErrorMessage(message);
      toast.error(message);
    }
  }

  const submitting = loginMutation.isPending || registerMutation.isPending;
  const pillClass = `mainframe-pill ${pillsVisible ? "mainframe-pill-visible" : ""}`;

  return (
    <div className="auth-page auth-mainframe">
      <video ref={videoRef} className="auth-mainframe-video" src={MAINFRAME_VIDEO} muted playsInline preload="auto" aria-hidden="true" />
      <div className="auth-mainframe-shade" />
      <section className="auth-aside auth-mainframe-aside">
        <Link href="/" className="back-link"><ArrowLeft size={16} /> voltar para a home</Link>
        <div className="mainframe-nav"><strong>Mainframe<sup>®</sup></strong><span aria-hidden="true">✳︎</span></div>
        <div className="mainframe-copy">
          <p className="mainframe-intro">Hey there, meet A.R.I.A,<br />Mainframe&apos;s Adaptive Response Interface Agent</p>
          <p className="mainframe-typewriter">{displayed}{!done && <span className="mainframe-cursor" aria-hidden="true" />}</p>
          <div className="mainframe-pills" aria-label="Mainframe actions">
            <button type="button" className={pillClass}>Pitch us an idea</button>
            <button type="button" className={pillClass}>Come work here</button>
            <button type="button" className={pillClass}>Send a brief hello</button>
            <button type="button" className={pillClass}>See how we operate</button>
            <button type="button" className={`${pillClass} mainframe-pill-outline`} onClick={copyEmail}>Reach us: <u>hello@mainframe.co</u><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1" /><path d="M16 8V5H5v11h3" /></svg></button>
          </div>
        </div>
        <div className="mainframe-product-mark"><span className="brand-mark"><i /><b /></span><span>Produtiva<span>AI</span></span></div>
      </section>
      <div className="auth-card-wrap auth-mainframe-card-wrap">
        <form className="auth-card auth-mainframe-card" onSubmit={handleSubmit}>
          <div className="auth-card-mark"><LockKeyhole size={19} /></div>
          <p className="eyebrow">{isRegister ? "PRIMEIRO PASSO" : "BEM-VINDO DE VOLTA"}</p>
          <h2>{isRegister ? "Crie sua conta." : "Entre para continuar."}</h2>
          <p className="auth-description">{isRegister ? "Crie sua conta diretamente no ProdutivaAI." : "Acesse suas conversas, projetos e tarefas."}</p>
          {errorMessage && <p role="alert" style={{ color: "#b42318", marginBottom: 16 }}>{errorMessage}</p>}
          {isRegister && <div className="form-field"><label className="form-label" htmlFor="auth-name">Nome</label><input id="auth-name" className="input" type="text" value={name} onChange={event => setName(event.target.value)} placeholder="Seu nome" autoComplete="name" required minLength={2} /></div>}
          <div className="form-field"><label className="form-label" htmlFor="auth-email">E-mail</label><input id="auth-email" className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="voce@email.com" autoComplete="email" required /></div>
          <div className="form-field"><label className="form-label" htmlFor="auth-password">Senha</label><input id="auth-password" className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Sua senha" autoComplete={isRegister ? "new-password" : "current-password"} required minLength={8} /></div>
          {isRegister && <div className="form-field"><label className="form-label" htmlFor="auth-confirm-password">Confirmar senha</label><input id="auth-confirm-password" className="input" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Digite a senha novamente" autoComplete="new-password" required minLength={8} /></div>}
          <button type="submit" disabled={submitting} className="button button-dark button-full auth-login-button">{submitting ? <><Loader2 size={17} className="animate-spin" /> Processando...</> : isRegister ? "Criar minha conta" : "Entrar"}</button>
          <div className="auth-divider"><span>acesso seguro</span></div>
          <p className="auth-legal">Sua conta é criada e armazenada diretamente no ProdutivaAI. Sua senha não é armazenada em texto puro.</p>
          <p className="auth-switch">{isRegister ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}<Link href={isRegister ? "/login" : "/register"}>{isRegister ? "Entrar" : "Criar agora"}</Link></p>
        </form>
      </div>
    </div>
  );
}
