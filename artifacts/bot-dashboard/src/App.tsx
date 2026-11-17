import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bot, Check, ChevronRight, CircleAlert,
  Clock3, Code2, Copy, Cpu, Fingerprint, Gauge, HardDrive, KeyRound, LoaderCircle, LockKeyhole,
  Download, LogOut, MemoryStick, RefreshCw, Router as RouterIcon, Server, ShieldCheck, Signal, SignalZero, Terminal,
  Users, X,
} from 'lucide-react';
import {
  getGetBotConnectionQueryKey, getGetBotDashboardSessionQueryKey, getGetBotLogsQueryKey,
  getGetBotUsageQueryKey, getGetManagedBotStatusQueryKey, useGetBotConnection,
  useGetBotDashboardSession, useGetBotLogs, useGetBotUsage, useGetManagedBotStatus,
  useLoginBotDashboard, useLogoutBotDashboard, useStartManagedBot, useStopManagedBot,
} from '@workspace/api-client-react';
import type { ManagedBotStatus, ProfilerSnapshot } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      staleTime: 5 * 60 * 1000,
      // An installed iPhone app may be suspended for a long time. Refetching
      // active queries on resume also wakes the autoscaled API service.
      refetchOnWindowFocus: 'always',
    },
  },
});

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}
function stamp(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return days ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m` : `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`;
}
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024, index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(1)} ${units[index]}`;
}
function StatusPill({ state, small = false }: { state: string; small?: boolean }) {
  const palette = state === 'running' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : state === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' : ['starting', 'stopping'].includes(state) ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-stone-100 text-stone-600 border-stone-200';
  const dot = state === 'running' ? 'bg-emerald-500' : state === 'error' ? 'bg-rose-500' : ['starting', 'stopping'].includes(state) ? 'bg-amber-500' : 'bg-stone-400';
  return <span data-testid="status-bot-state" className={`inline-flex items-center gap-2 rounded-full border font-semibold capitalize ${small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${palette}`}><i className={`h-1.5 w-1.5 rounded-full ${dot} ${state === 'running' ? 'live-pulse' : ''}`} />{state}</span>;
}
function LoadingFrame({ label = 'Checking secure session' }: { label?: string }) {
  return <main className="ops-grid flex min-h-[100dvh] items-center justify-center p-6"><div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm"><Brand /><div className="mb-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full w-2/3 animate-pulse rounded-full bg-primary/70" /></div><p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" size={15} />{label}</p></div></main>;
}
function Brand() {
  return <div className="mb-7 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#20352f] text-[#e1c875]"><Bot size={20} /></div><div><p className="text-sm font-extrabold tracking-[.1em]">MENDIVE</p><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Bot operations</p></div></div>;
}
type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};
function InstallAppControl({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
  });
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);

  useEffect(() => {
    const isStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setOpen(false);
    };

    setInstalled(isStandalone());
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  async function openOrInstall() {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const result = await installPrompt.userChoice;
        setInstallPrompt(null);
        if (result.outcome === 'accepted') {
          setInstalled(true);
          return;
        }
      } catch (error) {
        console.warn('The browser install prompt was unavailable.', error);
      }
    }
    setOpen(true);
  }

  if (installed) return null;

  return <>
    <button
      type="button"
      data-testid="button-install-app"
      onClick={() => void openOrInstall()}
      aria-label={installed ? 'View app installation help' : 'Install Mendive dashboard app'}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d5ded8] bg-white font-semibold text-[#36463e] transition hover:border-primary/40 hover:text-primary ${compact ? 'h-9 px-2.5 text-[11px] sm:px-3 sm:text-xs' : 'h-10 w-full px-4 text-xs'}`}
    >
      <Download size={15} />
      <span>{installed ? 'App installed' : compact ? <><span className="sm:hidden">App</span><span className="hidden sm:inline">Install app</span></> : 'Install app'}</span>
    </button>
    {open && <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[#17241f]/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-app-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.17em] text-primary">Quick access</p>
            <h2 id="install-app-title" className="mt-1.5 text-xl font-extrabold tracking-tight">Add Mendive to your iPhone</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close installation instructions"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
          ><X size={16} /></button>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Use Safari to add this website as an app-style icon. It opens the same secure dashboard in its own window.</p>
        <ol className="mt-5 space-y-3.5">
          {[
            'Open the published dashboard address in Safari on your iPhone. If it opened inside another app, choose Open in Safari first.',
            'Tap Safari’s Share button (the square with an upward arrow).',
            'Choose “Add to Home Screen.” If “Open as Web App” appears, leave it enabled.',
            'Tap “Add,” then open Mendive from the new Home Screen icon and sign in.',
          ].map((step, index) => <li key={step} className="flex items-start gap-3 text-sm leading-5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e8eddf] font-mono text-[11px] font-bold text-[#315744]">{index + 1}</span>
            <span className="pt-0.5">{step}</span>
          </li>)}
        </ol>
        <p className="mt-5 rounded-lg border border-border bg-secondary/50 px-3.5 py-3 text-xs leading-5 text-muted-foreground">Use the published address for a lasting Home Screen app. Replit preview links can stop when the workspace stops. This is an app-style website, not an App Store download, and live bot controls require internet.</p>
      </section>
    </div>}
  </>;
}
function LoginPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLoginBotDashboard();
  const session = useGetBotDashboardSession();
  useEffect(() => { if (session.data?.authenticated) setLocation('/'); }, [session.data?.authenticated, setLocation]);
  if (session.isLoading) return <LoadingFrame />;
  if (session.data?.authenticated) return <LoadingFrame label="Opening operations console" />;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || login.isPending) return;
    login.mutate({ data: { password } }, { onSuccess: (result) => {
      setPassword('');
      queryClient.setQueryData(getGetBotDashboardSessionQueryKey(), result);
      void queryClient.invalidateQueries({ queryKey: getGetBotDashboardSessionQueryKey() });
      setLocation('/');
    } });
  }
  return <main className="ops-grid relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-12">
    <div className="pointer-events-none absolute -right-36 -top-44 h-[500px] w-[500px] rounded-full border border-[#d7dfd5]" />
    <section className="enter relative z-10 w-full max-w-[430px]">
      <div className="mb-7 flex items-center justify-between"><Brand /><span className="mb-7 flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><LockKeyhole size={12} />Private</span></div>
      <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_18px_55px_-32px_rgba(25,43,39,.28)] sm:p-9">
        <div className="mb-7"><div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#f2edda] text-[#76652d]"><Fingerprint size={20} /></div><p className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">Restricted access</p><h1 className="mt-2 font-display text-[28px] font-bold tracking-[-.045em]">Sign in to console</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Use your dashboard password to manage the Mendive Discord bot.</p></div>
        <form onSubmit={submit} className="space-y-5"><input type="hidden" name="username" autoComplete="username" value="dashboard" readOnly />
          <label className="block"><span className="mb-2 block text-xs font-bold">Dashboard password</span><span className="relative block"><KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><input data-testid="input-dashboard-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className="h-12 w-full rounded-lg border border-input bg-background pl-10 pr-[76px] text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" /><button data-testid="button-toggle-password-visibility" type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 px-1 py-1 text-[11px] font-bold text-muted-foreground hover:text-foreground">{showPassword ? 'Hide' : 'Show'}</button></span></label>
          {login.isError && <div role="alert" data-testid="status-login-error" className="flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{errorText(login.error, 'Unable to sign in. Check your password and try again.')}</div>}
          <button data-testid="button-login" type="submit" disabled={!password.trim() || login.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#244b3d] px-4 text-sm font-bold text-white transition hover:bg-[#1d3d32] disabled:cursor-not-allowed disabled:opacity-50">{login.isPending ? <><LoaderCircle size={16} className="animate-spin" />Verifying access</> : <>Continue <ChevronRight size={16} /></>}</button>
        </form><div className="mt-7 flex items-center gap-2 border-t border-border pt-5 text-[11px] leading-5 text-muted-foreground"><ShieldCheck size={14} className="shrink-0 text-primary" />Session is protected by a same-origin secure cookie.</div>
      </div><div className="mt-4"><InstallAppControl /></div><p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground/75">Mendive · private control plane</p>
    </section>
  </main>;
}

type PageKey = 'status' | 'logs' | 'connection' | 'usage';
const navItems: { label: string; path: string; key: PageKey; icon: ReactNode }[] = [
  { label: 'Status', path: '/', key: 'status', icon: <Activity size={16} /> },
  { label: 'Logs', path: '/logs', key: 'logs', icon: <Terminal size={16} /> },
  { label: 'Connection', path: '/connection', key: 'connection', icon: <RouterIcon size={16} /> },
  { label: 'Usage', path: '/usage', key: 'usage', icon: <Gauge size={16} /> },
];
function Shell({ children, page, onRefresh, refreshing }: { children: ReactNode; page: PageKey; onRefresh: () => void; refreshing: boolean }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const logout = useLogoutBotDashboard();
  function signOut() {
    logout.mutate(undefined, { onSuccess: (result) => {
      queryClient.setQueryData(getGetBotDashboardSessionQueryKey(), result);
      queryClient.removeQueries({ queryKey: getGetManagedBotStatusQueryKey() });
      queryClient.removeQueries({ queryKey: getGetBotLogsQueryKey() });
      queryClient.removeQueries({ queryKey: getGetBotConnectionQueryKey() });
      queryClient.removeQueries({ queryKey: getGetBotUsageQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetBotDashboardSessionQueryKey() });
      setLocation('/login');
    } });
  }
  const title = navItems.find((item) => item.key === page)?.label ?? 'Status';
  return <div className="min-h-[100dvh] bg-[#f0f2ec] text-foreground"><div className="flex min-h-[100dvh]">
    <aside className="hidden w-[238px] shrink-0 flex-col bg-[#20302a] text-[#dce7e1] md:flex">
      <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#e1c875] text-[#20352f]"><Bot size={19} /></div><div><p className="text-[13px] font-extrabold tracking-[.13em] text-white">MENDIVE</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[.16em] text-[#91a69b]">Operations</p></div></div>
      <div className="px-4 pt-8"><p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[.2em] text-[#81968b]">Control plane</p><nav className="space-y-1">{navItems.map((item) => <Link key={item.key} href={item.path} data-testid={`link-nav-${item.key}`} className={`flex h-10 items-center gap-3 rounded-md border px-3 text-sm transition ${page === item.key ? 'border-white/[.07] bg-white/[.09] font-semibold text-white' : 'border-transparent text-[#b7c7be] hover:bg-white/[.05] hover:text-white'}`}><span className={page === item.key ? 'text-[#e1c875]' : ''}>{item.icon}</span>{item.label}</Link>)}</nav></div>
      <div className="mt-auto px-6 pb-6"><div className="mb-4 border-t border-white/10 pt-4"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.1em] text-[#91a69b]"><span className="h-1.5 w-1.5 rounded-full bg-[#9bd0aa]" />Local control</div><p className="mt-2 text-xs leading-5 text-[#b6c6be]">Private access · session protected</p></div><button data-testid="button-logout" onClick={signOut} disabled={logout.isPending} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-[#bdcbc4] transition hover:bg-white/[.07] hover:text-white disabled:opacity-50">{logout.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <LogOut size={15} />}Sign out</button></div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="flex min-h-[68px] items-center justify-between border-b border-[#dce3de] bg-[#f8f9f5] px-4 sm:px-8 lg:px-11">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#20352f] text-[#e1c875] md:hidden"><Bot size={17} /></span><span className="hidden sm:inline">Control plane</span><ChevronRight size={13} className="hidden sm:block" /><span className="font-semibold text-foreground">{title}</span></div>
        <nav className="flex gap-2 overflow-x-auto md:hidden">{navItems.map((item) => <Link key={item.key} href={item.path} data-testid={`mobile-nav-${item.key}`} className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[11px] font-semibold ${page === item.key ? 'bg-[#20352f] text-[#e1c875]' : 'text-muted-foreground'}`}>{item.label}</Link>)}</nav>
         <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-[#dce3de] bg-white px-3 py-1.5 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#38936e]" /><span className="font-mono text-[10px] uppercase tracking-[.09em] text-muted-foreground">Session secure</span></div><InstallAppControl compact /><button data-testid="button-refresh-page" onClick={onRefresh} disabled={refreshing} aria-label="Refresh current view" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3de] bg-white text-muted-foreground transition hover:text-primary disabled:opacity-50"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></button><button data-testid="button-logout-mobile" onClick={signOut} disabled={logout.isPending} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3de] bg-white text-muted-foreground hover:text-rose-700 md:hidden"><LogOut size={15} /></button></div>
      </header>
      <div className="ops-grid mx-auto max-w-[1280px] px-4 py-7 sm:px-8 sm:py-9 lg:px-11">{children}<footer className="mt-9 flex flex-col gap-2 border-t border-[#d9e1db] pt-4 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span className="font-mono uppercase tracking-[.11em]">Mendive control plane <span className="mx-1.5 text-[#a5b2aa]">/</span> private instance</span><span className="flex items-center gap-1.5"><ShieldCheck size={12} />Authenticated operator view</span></footer></div>
    </main>
  </div></div>;
}
function Heading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <section className="enter flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary"><span className="h-px w-5 bg-primary" />{eyebrow}</div><h1 className="font-display text-[32px] font-bold tracking-[-.055em] sm:text-[38px]">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{detail}</p></div>{action}</section>;
}
function StatCard({ label, value, note, icon, tone = false }: { label: string; value: string; note: string; icon: ReactNode; tone?: boolean }) {
  return <div className="rounded-xl border border-border bg-card p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between"><p className="text-[11px] font-bold uppercase tracking-[.11em] text-muted-foreground">{label}</p><span className={`grid h-8 w-8 place-items-center rounded-lg ${tone ? 'bg-[#f2edda] text-[#76652d]' : 'bg-secondary text-foreground/70'}`}>{icon}</span></div><div className="mt-4 font-mono text-[23px] font-medium tracking-[-.05em]">{value}</div><div className="mt-1.5 text-xs text-muted-foreground">{note}</div></div>;
}
function ErrorNotice({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-900"><div className="flex gap-2.5"><CircleAlert size={17} className="mt-0.5 shrink-0" /><div><p className="font-bold">Could not load this view</p><p className="mt-0.5 text-xs leading-5">{message}</p></div></div><button onClick={retry} className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100">Retry</button></div>;
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-[#cbd7cf] bg-[#fbfcf9] px-6 py-12 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#edf1e9] text-muted-foreground"><Activity size={21} /></div><h2 className="mt-4 text-base font-bold">{title}</h2><p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p></div>;
}
function PageFrame({ page, refresh, isFetching, children }: { page: PageKey; refresh: () => void; isFetching: boolean; children: ReactNode }) {
  const session = useGetBotDashboardSession();
  const [, setLocation] = useLocation();
  useEffect(() => { if (!session.isLoading && !session.data?.authenticated) setLocation('/login'); }, [session.data?.authenticated, session.isLoading, setLocation]);
  if (session.isLoading) return <LoadingFrame />;
  if (!session.data?.authenticated) return <LoadingFrame label="Redirecting to sign in" />;
  return <Shell page={page} onRefresh={refresh} refreshing={isFetching}>{children}</Shell>;
}

function StatusPage() {
  const queryClient = useQueryClient();
  const status = useGetManagedBotStatus({ query: { queryKey: getGetManagedBotStatusQueryKey(), refetchInterval: 3500, refetchOnWindowFocus: true } });
  const startBot = useStartManagedBot(), stopBot = useStopManagedBot();
  const bot = status.data as ManagedBotStatus | undefined;
  const pending = startBot.isPending || stopBot.isPending;
  const canStart = bot?.state === 'stopped' || bot?.state === 'error';
  const canStop = bot?.state === 'running' || bot?.state === 'starting';
  function updateStatus(result: ManagedBotStatus) {
    queryClient.setQueryData(getGetManagedBotStatusQueryKey(), result);
    void queryClient.invalidateQueries({ queryKey: getGetManagedBotStatusQueryKey() });
  }
  const actionError = startBot.error || stopBot.error;
  return <PageFrame page="status" refresh={() => { void status.refetch(); }} isFetching={status.isFetching}>
    <Heading eyebrow="Live system view" title="Bot status" detail="A clear read on the managed process and Discord gateway." action={<div className="flex gap-2.5"><button data-testid="button-start-bot" onClick={() => startBot.mutate(undefined, { onSuccess: updateStatus })} disabled={!canStart || pending || !bot} className="flex h-10 items-center gap-2 rounded-lg bg-[#285c47] px-4 text-xs font-bold text-white transition hover:bg-[#214a3a] disabled:cursor-not-allowed disabled:bg-[#c7d4cd] disabled:text-[#6b7b72]">{startBot.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUpRight size={15} />}Start bot</button><button data-testid="button-stop-bot" onClick={() => stopBot.mutate(undefined, { onSuccess: updateStatus })} disabled={!canStop || pending || !bot} className="flex h-10 items-center gap-2 rounded-lg border border-[#d5ded8] bg-white px-4 text-xs font-bold text-[#36463e] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:cursor-not-allowed disabled:bg-[#f0f3f0] disabled:text-[#9aa69f]">{stopBot.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}Stop bot</button></div>} />
    {(actionError || status.isError) && <ErrorNotice message={errorText(actionError || status.error, 'The status endpoint could not be reached.')} retry={() => { void status.refetch(); }} />}
    {status.isLoading && <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((n) => <div key={n} className="h-[132px] animate-pulse rounded-xl border border-border bg-card p-5"><div className="h-3 w-24 rounded bg-secondary" /><div className="mt-7 h-6 w-32 rounded bg-secondary" /><div className="mt-3 h-2.5 w-40 rounded bg-secondary" /></div>)}</div>}
    {status.isError && !bot && <div className="mt-8"><EmptyState title="No live status yet" detail="The control service did not return a process snapshot. Retry to reconnect to its status endpoint." /></div>}
    {bot && <div className="enter enter-delay mt-8">
      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bot process" value={bot.processId ? `PID ${bot.processId}` : '—'} note={bot.processId ? 'Managed process identifier' : 'No active process'} icon={<Cpu size={16} />} />
        <StatCard label="Gateway" value={bot.gatewayConnected ? 'Connected' : 'Offline'} note={bot.gatewayConnected ? 'Discord session established' : 'No active gateway session'} icon={bot.gatewayConnected ? <Signal size={16} /> : <SignalZero size={16} />} tone={bot.gatewayConnected} />
        <StatCard label="Uptime" value={bot.state === 'running' ? formatUptime(bot.uptimeSeconds) : '—'} note={bot.state === 'running' ? 'Since current process start' : 'Available while process runs'} icon={<Clock3 size={16} />} />
        <StatCard label="Last exit code" value={bot.lastExitCode === null ? '—' : String(bot.lastExitCode)} note={bot.lastExitCode === null ? 'No previous exit recorded' : bot.lastExitCode === 0 ? 'Process exited cleanly' : 'Process exited with an error'} icon={<Terminal size={16} />} />
      </section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <article className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between border-b border-border px-5 py-5 sm:px-6"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Managed process</p><h2 className="mt-1.5 text-base font-extrabold">Runtime state</h2></div><StatusPill state={bot.state} /></div>
          <div className="grid gap-px bg-border sm:grid-cols-2"><div className="bg-card px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Started at</p><p className="mt-2 text-sm font-semibold">{stamp(bot.startedAt)}</p></div><div className="bg-card px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Process ID</p><p className="mt-2 font-mono text-sm">{bot.processId ?? '—'}</p></div></div>
          {bot.lastError && <div className="border-t border-rose-100 bg-rose-50/70 px-5 py-4 sm:px-6"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-rose-800"><CircleAlert size={13} />Last process error</p><p data-testid="text-last-error" className="mt-2 break-words text-sm leading-6 text-rose-900">{bot.lastError}</p></div>}
          <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground"><RefreshCw size={12} className={status.isFetching ? 'animate-spin' : ''} />Auto-refresh every 3.5 seconds</div>
        </article>
        <article className="rounded-xl border border-border bg-card p-5 sm:p-6"><div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Discord gateway</p><h2 className="mt-1.5 text-base font-extrabold">Connection health</h2></div><div className={`grid h-9 w-9 place-items-center rounded-lg ${bot.gatewayConnected ? 'bg-[#e6f3ed] text-[#286c52]' : 'bg-secondary text-muted-foreground'}`}>{bot.gatewayConnected ? <Signal size={17} /> : <SignalZero size={17} />}</div></div><div className="mt-7 flex items-center gap-3"><div className={`grid h-11 w-11 place-items-center rounded-full ${bot.gatewayConnected ? 'bg-[#e6f3ed] text-[#286c52]' : 'bg-secondary text-muted-foreground'}`}>{bot.gatewayConnected ? <Check size={20} /> : <ArrowDownToLine size={19} />}</div><div><p data-testid="status-gateway" className="text-sm font-bold">{bot.gatewayConnected ? 'Connection established' : 'Not connected'}</p><p className="mt-1 text-xs text-muted-foreground">{bot.gatewayConnected ? 'Bot can receive Discord events.' : 'Gateway unavailable until the bot is running.'}</p></div></div><div className="mt-6 border-t border-border pt-4"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Process state</span><StatusPill state={bot.state} small /></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">Latest exit</span><span className="font-mono font-medium">{bot.lastExitCode === null ? 'None' : `Code ${bot.lastExitCode}`}</span></div></div></article>
      </section>
    </div>}
  </PageFrame>;
}

function LogsPage() {
  const logs = useGetBotLogs({ query: { queryKey: getGetBotLogsQueryKey() } });
  const entries = logs.data?.entries ?? [];
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const visibleEntries = levelFilter === 'all' ? entries : entries.filter((entry) => entry.level === levelFilter);
  return <PageFrame page="logs" refresh={() => { void logs.refetch(); }} isFetching={logs.isFetching}>
    <Heading eyebrow="Process output" title="Recent logs" detail="Sanitized stdout and stderr from the managed bot process." action={<button onClick={() => { void logs.refetch(); }} disabled={logs.isFetching} className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-xs font-bold hover:border-primary/40 disabled:opacity-50"><RefreshCw size={14} className={logs.isFetching ? 'animate-spin' : ''} />Refresh logs</button>} />
    {logs.isError && <ErrorNotice message={errorText(logs.error, 'Recent process logs could not be loaded.')} retry={() => { void logs.refetch(); }} />}
    {logs.isLoading && <div className="mt-8 space-y-2 rounded-xl border border-border bg-card p-5">{[1,2,3,4,5,6].map((n) => <div key={n} className="h-7 animate-pulse rounded bg-secondary/70" />)}</div>}
    {!logs.isLoading && !logs.isError && !entries.length && <div className="mt-8"><EmptyState title="No recent entries" detail="There are no process log lines available yet. New output will appear here when the bot runs." /></div>}
    {!logs.isLoading && entries.length > 0 && <section className="enter mt-8 overflow-hidden rounded-xl border border-[#32453c] bg-[#1f2d28] text-[#dae5dc]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4"><div className="flex items-center gap-2"><Terminal size={15} className="text-[#d8c16e]" /><span className="text-xs font-bold text-white">Process stream</span><span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px]">{visibleEntries.length}{levelFilter === 'all' ? '' : ` / ${entries.length}`} lines</span></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-[10px] text-[#b6c6bb]"><span>Level</span><select data-testid="select-log-level" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value as typeof levelFilter)} className="rounded-md border border-white/15 bg-[#2b3b34] px-2 py-1.5 text-[10px] text-white outline-none focus:ring-2 focus:ring-[#d8c16e]/50"><option value="all">All levels</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option></select></label><span className="hidden font-mono text-[10px] uppercase tracking-[.12em] text-[#9fb0a4] sm:inline">Redacted output</span></div></div>
      {visibleEntries.length ? <div className="log-scroll max-h-[620px] overflow-auto p-2 sm:p-4">{visibleEntries.map((entry, index) => <div key={`${entry.timestamp}-${index}`} data-testid={`log-entry-${index}`} className="grid gap-2 border-b border-white/[.055] px-3 py-3 text-xs last:border-0 sm:grid-cols-[145px_62px_62px_minmax(0,1fr)] sm:items-start"><time className="font-mono text-[10px] leading-5 text-[#9fb0a4]">{new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(entry.timestamp))}</time><span className={`w-fit rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${entry.level === 'error' ? 'bg-rose-400/15 text-rose-300' : entry.level === 'warn' ? 'bg-amber-300/15 text-amber-200' : 'bg-white/[.08] text-[#c2d0c5]'}`}>{entry.level}</span><span className="font-mono text-[10px] uppercase text-[#9fb0a4]">{entry.source}</span><p className="break-words font-mono text-[11px] leading-5 text-[#e0e8df]">{entry.message}</p></div>)}</div> : <p className="px-5 py-8 text-center text-xs text-[#b6c6bb]">No log entries match this level.</p>}
    </section>}
    <p className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck size={13} />Log output is sanitized by the control service before it reaches this console.</p>
  </PageFrame>;
}

function ConnectionPage() {
  const connection = useGetBotConnection({ query: { queryKey: getGetBotConnectionQueryKey() } });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const data = connection.data;
  async function copyAddress() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.minecraft.address);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState('idle'), 1600);
  }
  return <PageFrame page="connection" refresh={() => { void connection.refetch(); }} isFetching={connection.isFetching}>
    <Heading eyebrow="Network details" title="Connection" detail="Discord gateway session and Minecraft server command details." action={<span className="rounded-full border border-[#e5d9a9] bg-[#f7f1d9] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] text-[#705f2a]">Minecraft · on-demand</span>} />
    {connection.isError && <ErrorNotice message={errorText(connection.error, 'Connection details could not be loaded.')} retry={() => { void connection.refetch(); }} />}
    {connection.isLoading && <div className="mt-8 grid gap-5 lg:grid-cols-2">{[1,2].map((n) => <div key={n} className="h-72 animate-pulse rounded-xl border border-border bg-card p-6" />)}</div>}
    {!connection.isLoading && !connection.isError && data && <div className="enter enter-delay mt-8 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <article className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-5 sm:px-6"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Discord gateway</p><h2 className="mt-1 text-lg font-bold">Session details</h2></div><span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${data.discord.gatewayConnected ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}><span className={`h-1.5 w-1.5 rounded-full ${data.discord.gatewayConnected ? 'bg-emerald-500' : 'bg-stone-400'}`} />{data.discord.gatewayConnected ? 'Connected' : 'Offline'}</span></div>
        <div className="grid gap-px bg-border sm:grid-cols-2"><ConnectionDatum label="Bot identity" value={data.discord.botUsername ?? 'Not available'} /><ConnectionDatum label="Gateway latency" value={data.discord.latencyMs === null ? '—' : `${data.discord.latencyMs} ms`} /><ConnectionDatum label="Connected since" value={stamp(data.discord.connectedAt)} /><ConnectionDatum label="Shards" value={data.discord.shards.length ? data.discord.shards.join(', ') : 'None reported'} /></div>
        <div className="flex items-start gap-3 border-t border-border bg-[#f8f8f2] px-5 py-4 sm:px-6"><Signal size={16} className="mt-0.5 text-primary" /><p className="text-xs leading-5 text-muted-foreground">Gateway details describe the bot session. Minecraft status checks are never initiated by this dashboard.</p></div>
      </article>
      <article className="relative overflow-hidden rounded-xl border border-[#34483e] bg-[#22332d] p-5 text-[#e3ebe5] sm:p-6">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full border border-white/[.08]" /><div className="absolute -right-8 -top-8 h-40 w-40 rounded-full border border-white/[.08]" />
        <div className="relative"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.15em] text-[#cbbd78]"><Server size={14} />Minecraft endpoint</div><h2 className="mt-3 font-display text-2xl font-bold">Server details</h2><p className="mt-1 text-xs leading-5 text-[#b6c7bc]">Connection information only. No automatic probing.</p>
           <div className="mt-6 rounded-lg border border-white/10 bg-black/10 p-4"><div className="flex items-center justify-between gap-3"><p className="font-mono text-[9px] uppercase tracking-[.14em] text-[#9eb0a3]">Address</p><button data-testid="button-copy-address" onClick={() => { void copyAddress(); }} className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-[#dfe8df] transition hover:bg-white/[.08]">{copyState === 'copied' ? <Check size={12} /> : <Copy size={12} />}{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy address'}</button></div><p className="mt-2 break-all font-mono text-sm font-medium text-white">{data.minecraft.address}</p><p className="mt-1 text-[11px] text-[#aebeb2]">{data.minecraft.host}:{data.minecraft.port}</p></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><CommandTile label="Status command" value={data.minecraft.statusCommand} /><CommandTile label="Connection command" value={data.minecraft.connectionCommand} /></div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#e1c875]/10 p-3 text-xs leading-5 text-[#e4dba9]"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{data.minecraft.note || `Status mode: ${data.minecraft.statusMode}. Run ${data.minecraft.statusCommand} in Discord to request a live server check.`}</span></div>
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[.13em] text-[#9eb0a3]">Status mode · {data.minecraft.statusMode}</p>
        </div>
      </article>
    </div>}
    {!connection.isLoading && !connection.isError && !data && <div className="mt-8"><EmptyState title="Connection details unavailable" detail="The endpoint returned no connection snapshot." /></div>}
  </PageFrame>;
}
function ConnectionDatum({ label, value }: { label: string; value: string }) {
  return <div className="bg-card px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 break-words text-sm font-semibold">{value}</p></div>;
}
function CommandTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[.04] p-3"><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#9eb0a3]">{label}</p><code className="mt-2 block break-all font-mono text-xs text-[#f0e5ac]">{value}</code></div>;
}

function UsagePage() {
  const usage = useGetBotUsage({ query: { queryKey: getGetBotUsageQueryKey() } });
  const result = usage.data;
  const current = result?.current ?? null;
  const history = result?.history ?? [];
  return <PageFrame page="usage" refresh={() => { void usage.refetch(); }} isFetching={usage.isFetching}>
    <Heading eyebrow="Runtime profiler" title="Usage & performance" detail="Samples are recorded every 10 seconds. Refresh to fetch the latest snapshot and retained history." action={<span className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">30 min retention</span>} />
    {usage.isError && <ErrorNotice message={errorText(usage.error, 'Profiler readings could not be loaded.')} retry={() => { void usage.refetch(); }} />}
    {usage.isLoading && <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((n) => <div key={n} className="h-32 animate-pulse rounded-xl border border-border bg-card p-5" />)}</div>}
    {!usage.isLoading && !usage.isError && !current && <div className="mt-8"><EmptyState title="No profiler sample yet" detail="The bot has not published a profiler snapshot. Start the process and refresh after the next sampling interval." /></div>}
    {current && <div className="enter enter-delay mt-8">
      <section className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <UsageMetric label="CPU" value={`${current.cpuPercent.toFixed(1)}%`} detail={`Threshold ${current.thresholds.cpuPercent}%`} percent={current.thresholds.cpuPercent ? current.cpuPercent / current.thresholds.cpuPercent * 100 : 0} pressure={current.pressure.cpu} icon={<Cpu size={16} />} />
        <UsageMetric label="Heap in use" value={bytes(current.memory.heapUsed)} detail={`${(current.memory.heapUtilization * 100).toFixed(1)}% of ${bytes(current.memory.heapLimit)} V8 limit`} percent={current.memory.heapUtilization * 100} pressure={current.pressure.memory} icon={<MemoryStick size={16} />} />
        <UsageMetric label="Event loop max" value={`${current.eventLoop.maxMs.toFixed(1)} ms`} detail={`Mean ${current.eventLoop.meanMs.toFixed(1)} ms · threshold ${current.thresholds.eventLoopLagMs} ms`} percent={current.thresholds.eventLoopLagMs ? current.eventLoop.maxMs / current.thresholds.eventLoopLagMs * 100 : 0} pressure={current.pressure.eventLoop} icon={<Activity size={16} />} />
        <UsageMetric label="Gateway latency" value={current.gatewayLatencyMs === null ? '—' : `${current.gatewayLatencyMs} ms`} detail={`Cooldown multiplier ${current.cooldownMultiplier.toFixed(2)}×`} percent={null} pressure={false} icon={<Signal size={16} />} />
      </section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <article className="rounded-xl border border-border bg-card p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Memory footprint</p><h2 className="mt-1.5 text-base font-extrabold">Process allocation</h2><p className="mt-1 text-[11px] text-muted-foreground">Node grows the heap as needed; the limit is not reserved upfront.</p></div><span className="font-mono text-[10px] text-muted-foreground">Sampled {stamp(current.sampledAt)}</span></div>
          <div className="mt-7"><div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">Heap used / V8 limit</span><span className="font-mono">{bytes(current.memory.heapUsed)} / {bytes(current.memory.heapLimit)}</span></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`metric-line h-full rounded-full ${current.pressure.memory ? 'bg-rose-500' : ''}`} style={{ width: `${Math.min(100, Math.max(0, current.memory.heapUtilization * 100))}%` }} /></div></div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-lg bg-[#f5f4eb] p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">Resident set</p><p className="mt-2 font-mono text-lg font-medium">{bytes(current.memory.rss)}</p></div><div className="rounded-lg bg-[#f5f4eb] p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">Current heap capacity</p><p className="mt-2 font-mono text-lg font-medium">{bytes(current.memory.heapTotal)}</p></div><div className="rounded-lg bg-[#f5f4eb] p-4"><p className="text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">Heap headroom</p><p className="mt-2 font-mono text-lg font-medium">{bytes(Math.max(0, current.memory.heapLimit - current.memory.heapUsed))}</p></div></div>
          <div className="mt-5 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="text-xs font-bold">Pressure thresholds</h3><span className="font-mono text-[10px] text-muted-foreground">Current snapshot</span></div><div className="mt-3 flex flex-wrap gap-2">{[['CPU', current.pressure.cpu], ['Memory', current.pressure.memory], ['Event loop', current.pressure.eventLoop]].map(([label, on]) => <span key={String(label)} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${on ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{label}: {on ? 'pressure' : 'normal'}</span>)}</div></div>
        </article>
        <article className="rounded-xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Cache inventory</p><h2 className="mt-1.5 text-base font-extrabold">In-memory counts</h2></div><HardDrive size={17} className="text-primary" /></div><div className="mt-5 divide-y divide-border">{Object.entries(current.cache).map(([label, value]) => <div key={label} className="flex items-center justify-between py-3 text-xs"><span className="capitalize text-muted-foreground">{label.replace(/([A-Z])/g, ' $1')}</span><span className="font-mono font-medium">{value.toLocaleString()}</span></div>)}</div></article>
      </section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
        <article className="rounded-xl border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Optimizer modules</p><h2 className="mt-1.5 text-base font-extrabold">Mod state</h2></div><Code2 size={17} className="text-primary" /></div><div className="mt-5 space-y-3"><ModRow name="Cache pruner" active={current.mods.cachePruner} detail="Reclaims stale cached data" /><ModRow name="Adaptive cooldown" active={current.mods.adaptiveCooldown} detail={`Multiplier currently ${current.cooldownMultiplier.toFixed(2)}×`} /></div></article>
        <article className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Recent samples</p><h2 className="mt-1 text-base font-extrabold">Profiler history</h2></div><span className="font-mono text-[10px] text-muted-foreground">{history.length} samples</span></div>{history.length ? <div className="divide-y divide-border">{[...history].reverse().slice(0, 8).map((sample, index) => <HistoryRow key={`${sample.sampledAt}-${index}`} sample={sample} />)}</div> : <p className="px-5 py-8 text-center text-xs text-muted-foreground">No historical samples are available yet.</p>}</article>
      </section>
    </div>}
  </PageFrame>;
}
function UsageMetric({ label, value, detail, percent, pressure, icon }: { label: string; value: string; detail: string; percent: number | null; pressure: boolean; icon: ReactNode }) {
  return <div className={`rounded-xl border bg-card p-5 ${pressure ? 'border-rose-200' : 'border-border'}`}><div className="flex items-start justify-between"><p className="text-[11px] font-bold uppercase tracking-[.11em] text-muted-foreground">{label}</p><span className={`grid h-8 w-8 place-items-center rounded-lg ${pressure ? 'bg-rose-50 text-rose-700' : 'bg-[#f2edda] text-[#76652d]'}`}>{icon}</span></div><div className="mt-4 font-mono text-[25px] font-medium tracking-[-.05em]">{value}</div><p className="mt-1 min-h-8 text-[11px] leading-4 text-muted-foreground">{detail}</p>{percent !== null && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${pressure ? 'bg-rose-500' : 'metric-line'}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>}</div>;
}
function ModRow({ name, active, detail }: { name: string; active: boolean; detail: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div><p className="text-xs font-bold">{name}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${active ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{active ? 'Enabled' : 'Disabled'}</span></div>;
}
function HistoryRow({ sample }: { sample: ProfilerSnapshot }) {
  return <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-3 text-xs sm:px-6"><div><p className="font-semibold">{new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(sample.sampledAt))}</p><p className="mt-1 text-[10px] text-muted-foreground">{stamp(sample.sampledAt)}</p></div><span className="font-mono">{sample.cpuPercent.toFixed(1)}% CPU</span><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${sample.pressure.cpu || sample.pressure.memory || sample.pressure.eventLoop ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{sample.pressure.cpu || sample.pressure.memory || sample.pressure.eventLoop ? 'Pressure' : 'Normal'}</span></div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={StatusPage} />
    <Route path="/logs" component={LogsPage} />
    <Route path="/connection" component={ConnectionPage} />
    <Route path="/usage" component={UsagePage} />
    <Route path="/login" component={LoginPage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
