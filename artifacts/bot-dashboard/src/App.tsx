import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Bot, Check, ChevronRight,
  CircleAlert, Clock3, Cpu, Fingerprint, Gauge, KeyRound, LoaderCircle,
  LockKeyhole, LogOut, RefreshCw, ShieldCheck, Signal, SignalZero, Terminal,
  X,
} from 'lucide-react';
import {
  getGetBotDashboardSessionQueryKey,
  getGetManagedBotStatusQueryKey,
  useGetBotDashboardSession,
  useGetManagedBotStatus,
  useLoginBotDashboard,
  useLogoutBotDashboard,
  useStartManagedBot,
  useStopManagedBot,
} from '@workspace/api-client-react';
import type { ManagedBotStatus } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 0 } },
});

function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function timeAgo(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatUptime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return days > 0
    ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
    : `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`;
}

function StatusPill({ state, small = false }: { state: string; small?: boolean }) {
  const color = state === 'running'
    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : state === 'starting' || state === 'stopping'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : state === 'error'
        ? 'bg-rose-50 text-rose-800 border-rose-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';
  const dot = state === 'running' ? 'bg-emerald-500' : state === 'error' ? 'bg-rose-500' : state === 'starting' || state === 'stopping' ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <span data-testid="status-bot-state" className={`inline-flex items-center gap-2 rounded-full border font-semibold capitalize ${small ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'} ${color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot} ${state === 'running' ? 'live-pulse' : ''}`} />
      {state}
    </span>
  );
}

function LoadingFrame({ label = 'Checking secure session' }: { label?: string }) {
  return (
    <main className="ops-grid flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#20352f] text-[#9ee2c3]"><Bot size={20} /></div>
          <div><p className="text-sm font-extrabold tracking-tight">MENDIVE</p><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Bot operations</p></div>
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full w-2/3 animate-pulse rounded-full bg-primary/70" /></div>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" size={15} />{label}</p>
      </div>
    </main>
  );
}

function LoginPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const login = useLoginBotDashboard();
  const { data: session, isLoading: sessionLoading } = useGetBotDashboardSession();

  useEffect(() => {
    if (session?.authenticated) setLocation('/');
  }, [session, setLocation]);
  if (sessionLoading) return <LoadingFrame />;
  if (session?.authenticated) return <LoadingFrame label="Opening operations console" />;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim() || login.isPending) return;
    login.mutate({ data: { password } }, {
      onSuccess: (result) => {
        setPassword('');
        queryClient.setQueryData(getGetBotDashboardSessionQueryKey(), result);
        void queryClient.invalidateQueries({ queryKey: getGetBotDashboardSessionQueryKey() });
        setLocation('/');
      },
    });
  }

  return (
    <main className="ops-grid relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-12">
      <div className="pointer-events-none absolute -right-40 -top-48 h-[520px] w-[520px] rounded-full border border-[#d8e4dc] opacity-60" />
      <div className="pointer-events-none absolute -right-24 -top-32 h-[380px] w-[380px] rounded-full border border-[#d8e4dc] opacity-60" />
      <section className="enter relative z-10 w-full max-w-[432px]">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#20352f] text-[#9ee2c3] shadow-sm"><Bot size={22} strokeWidth={1.8} /></div>
            <div><div className="text-[15px] font-extrabold tracking-[.11em] text-[#20352f]">MENDIVE</div><div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Bot operations</div></div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><LockKeyhole size={12} /> Private</span>
        </div>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_18px_55px_-32px_rgba(25,43,39,.28)] sm:p-9">
          <div className="mb-7">
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-[#e6f3ed] text-[#286c52]"><Fingerprint size={20} /></div>
            <p className="font-mono text-[10px] uppercase tracking-[.19em] text-primary">Restricted access</p>
            <h1 className="mt-2 text-[27px] font-extrabold tracking-[-.045em] text-foreground">Sign in to console</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your dashboard password to manage the Mendive Discord bot.</p>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <input type="hidden" name="username" autoComplete="username" value="dashboard" readOnly />
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-foreground">Dashboard password</span>
              <span className="relative block">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <input data-testid="input-dashboard-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="h-12 w-full rounded-lg border border-input bg-background pl-10 pr-[76px] text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" />
                <button data-testid="button-toggle-password-visibility" type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 px-1 py-1 text-[11px] font-bold text-muted-foreground transition hover:text-foreground">{showPassword ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {login.isError && <div role="alert" data-testid="status-login-error" className="flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><CircleAlert size={16} className="mt-0.5 shrink-0" />{errorText(login.error, 'Unable to sign in. Check your password and try again.')}</div>}
            <button data-testid="button-login" type="submit" disabled={!password.trim() || login.isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#244b3d] px-4 text-sm font-bold text-white transition hover:bg-[#1d3d32] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50">
              {login.isPending ? <><LoaderCircle size={16} className="animate-spin" />Verifying access</> : <>Continue <ChevronRight size={16} /></>}
            </button>
          </form>
          <div className="mt-7 flex items-center gap-2 border-t border-border pt-5 text-[11px] leading-5 text-muted-foreground"><ShieldCheck size={14} className="shrink-0 text-primary" />Session is protected by a same-origin secure cookie.</div>
        </div>
        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground/75">Mendive · private control plane</p>
      </section>
    </main>
  );
}

function StatCard({ label, value, note, icon, tone = 'dark' }: { label: string; value: string; note: string; icon: ReactNode; tone?: 'dark' | 'mint' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between"><p className="text-[11px] font-bold uppercase tracking-[.11em] text-muted-foreground">{label}</p><span className={`grid h-8 w-8 place-items-center rounded-lg ${tone === 'mint' ? 'bg-[#e6f3ed] text-[#286c52]' : 'bg-secondary text-foreground/70'}`}>{icon}</span></div>
      <div className="mt-4 font-mono text-[23px] font-medium tracking-[-.05em] text-foreground">{value}</div>
      <div className="mt-1.5 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const session = useGetBotDashboardSession();
  const status = useGetManagedBotStatus({
    query: {
      enabled: !!session.data?.authenticated,
      queryKey: getGetManagedBotStatusQueryKey(),
      refetchInterval: 3500,
      refetchOnWindowFocus: true,
    },
  });
  const logout = useLogoutBotDashboard();
  const startBot = useStartManagedBot();
  const stopBot = useStopManagedBot();

  useEffect(() => {
    if (!session.isLoading && !session.data?.authenticated) setLocation('/login');
  }, [session.data?.authenticated, session.isLoading, setLocation]);
  if (session.isLoading) return <LoadingFrame />;
  if (!session.data?.authenticated) return <LoadingFrame label="Redirecting to sign in" />;

  const bot = status.data as ManagedBotStatus | undefined;
  const actionError = startBot.error || stopBot.error;
  const actionPending = startBot.isPending || stopBot.isPending;
  const canStart = bot?.state === 'stopped' || bot?.state === 'error';
  const canStop = bot?.state === 'running';
  const hasStatus = Boolean(bot);

  function updateStatus(result: ManagedBotStatus) {
    queryClient.setQueryData(getGetManagedBotStatusQueryKey(), result);
    void queryClient.invalidateQueries({ queryKey: getGetManagedBotStatusQueryKey() });
  }

  function start() {
    if (!canStart || actionPending) return;
    startBot.mutate(undefined, { onSuccess: updateStatus });
  }
  function stop() {
    if (!canStop || actionPending) return;
    stopBot.mutate(undefined, { onSuccess: updateStatus });
  }
  function signOut() {
    logout.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetBotDashboardSessionQueryKey(), result);
        queryClient.removeQueries({ queryKey: getGetManagedBotStatusQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetBotDashboardSessionQueryKey() });
        setLocation('/login');
      },
    });
  }

  return (
    <div className="min-h-[100dvh] bg-[#f0f3f0] text-foreground">
      <div className="flex min-h-[100dvh]">
        <aside className="hidden w-[248px] shrink-0 flex-col bg-[#202f2b] text-[#dce7e1] md:flex">
          <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#9ee2c3] text-[#20352f]"><Bot size={19} /></div>
            <div><p className="text-[13px] font-extrabold tracking-[.13em] text-white">MENDIVE</p><p className="mt-0.5 font-mono text-[9px] uppercase tracking-[.16em] text-[#91a69b]">Operations</p></div>
          </div>
          <div className="px-4 pt-8">
            <p className="mb-3 px-3 font-mono text-[9px] uppercase tracking-[.2em] text-[#81968b]">Control plane</p>
            <div className="flex h-10 items-center gap-3 rounded-md border border-white/[.07] bg-white/[.08] px-3 text-sm font-semibold text-white"><Activity size={16} className="text-[#9ee2c3]" />Overview</div>
          </div>
          <div className="mt-auto px-6 pb-6">
            <div className="mb-4 border-t border-white/10 pt-4">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.1em] text-[#91a69b]"><span className="h-1.5 w-1.5 rounded-full bg-[#9ee2c3]" />Local control</div>
              <p className="mt-2 text-xs leading-5 text-[#b6c6be]">Private access · session protected</p>
            </div>
            <button data-testid="button-logout" onClick={signOut} disabled={logout.isPending} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-[#bdcbc4] transition hover:bg-white/[.07] hover:text-white disabled:opacity-50">{logout.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <LogOut size={15} />}Sign out</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="flex h-[68px] items-center justify-between border-b border-[#dce3de] bg-[#f8faf8] px-5 sm:px-8 lg:px-11">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="md:hidden grid h-8 w-8 place-items-center rounded-lg bg-[#20352f] text-[#9ee2c3]"><Bot size={17} /></span><span className="hidden sm:inline">Control plane</span><ChevronRight size={13} className="hidden sm:block" /><span className="font-semibold text-foreground">Overview</span></div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-[#dce3de] bg-white px-3 py-1.5 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#38936e]" /><span className="font-mono text-[10px] uppercase tracking-[.09em] text-muted-foreground">Session secure</span></div>
              <button data-testid="button-refresh-status" onClick={() => { void status.refetch(); }} disabled={status.isFetching} aria-label="Refresh bot status" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3de] bg-white text-muted-foreground transition hover:border-primary/40 hover:text-primary disabled:opacity-50"><RefreshCw size={15} className={status.isFetching ? 'animate-spin' : ''} /></button>
              <button data-testid="button-logout-mobile" onClick={signOut} disabled={logout.isPending} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3de] bg-white text-muted-foreground transition hover:text-rose-700 md:hidden"><LogOut size={15} /></button>
            </div>
          </header>
          <div className="ops-grid mx-auto max-w-[1280px] px-5 py-8 sm:px-8 sm:py-10 lg:px-11">
            <section className="enter flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary"><span className="h-px w-5 bg-primary" />Live system view</div>
                <h1 className="text-[30px] font-extrabold tracking-[-.055em] sm:text-[36px]">Bot overview</h1>
                <p className="mt-2 text-sm text-muted-foreground">Inspect the process and Discord gateway connection.</p>
              </div>
              <div className="flex items-center gap-2.5">
                <button data-testid="button-start-bot" onClick={start} disabled={!canStart || actionPending || !hasStatus} className="flex h-10 items-center gap-2 rounded-lg bg-[#285c47] px-4 text-xs font-bold text-white transition hover:bg-[#214a3a] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#c7d4cd] disabled:text-[#6b7b72]">
                  {startBot.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUpRight size={15} />}Start bot
                </button>
                <button data-testid="button-stop-bot" onClick={stop} disabled={!canStop || actionPending || !hasStatus} className="flex h-10 items-center gap-2 rounded-lg border border-[#d5ded8] bg-white px-4 text-xs font-bold text-[#36463e] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 active:translate-y-px disabled:cursor-not-allowed disabled:bg-[#f0f3f0] disabled:text-[#9aa69f]">
                  {stopBot.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}Stop bot
                </button>
              </div>
            </section>

            {logout.isError && <div role="alert" data-testid="status-logout-error" className="enter mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-xs text-rose-900">{errorText(logout.error, 'Unable to end the dashboard session. Try again.')}</div>}
            {(actionError || status.isError) && <div role="alert" data-testid={actionError ? 'status-action-error' : 'status-load-error'} className="enter mt-6 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-900">
              <div className="flex gap-2.5"><CircleAlert size={17} className="mt-0.5 shrink-0" /><div><p className="font-bold">{actionError ? 'Control action failed' : 'Status unavailable'}</p><p className="mt-0.5 text-xs leading-5">{errorText(actionError || status.error, 'The bot status could not be loaded. Retry in a moment.')}</p></div></div>
              {status.isError && <button data-testid="button-retry-status" onClick={() => { void status.refetch(); }} className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100">Retry</button>}
            </div>}

            {status.isLoading && <section className="enter mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading bot status">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-[132px] animate-pulse rounded-xl border border-border bg-card p-5"><div className="h-3 w-24 rounded bg-secondary" /><div className="mt-7 h-6 w-32 rounded bg-secondary" /><div className="mt-3 h-2.5 w-40 rounded bg-secondary" /></div>)}
            </section>}

            {status.isError && !bot && <section className="enter mt-8 rounded-xl border border-dashed border-[#cbd7cf] bg-[#fbfcfb] px-6 py-12 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#edf1ed] text-muted-foreground"><Activity size={21} /></div><h2 className="mt-4 text-base font-bold">No live status yet</h2><p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">The control service did not return a bot snapshot. Retry to reconnect to its status endpoint.</p><button data-testid="button-retry-status-empty" onClick={() => { void status.refetch(); }} className="mt-5 inline-flex items-center gap-2 rounded-md border border-border bg-white px-3.5 py-2 text-xs font-bold hover:border-primary/40 hover:text-primary"><RefreshCw size={13} />Try again</button>
            </section>}

            {bot && <>
              <section className="enter enter-delay mt-8 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Bot process" value={bot.processId ? `PID ${bot.processId}` : '—'} note={bot.processId ? 'Managed process identifier' : 'No active process'} icon={<Cpu size={16} />} />
                <StatCard label="Gateway" value={bot.gatewayConnected ? 'Connected' : 'Offline'} note={bot.gatewayConnected ? 'Discord session established' : 'No active gateway session'} icon={bot.gatewayConnected ? <Signal size={16} /> : <SignalZero size={16} />} tone={bot.gatewayConnected ? 'mint' : 'dark'} />
                <StatCard label="Uptime" value={bot.state === 'running' ? formatUptime(bot.uptimeSeconds) : '—'} note={bot.state === 'running' ? 'Since current process start' : 'Available while process runs'} icon={<Clock3 size={16} />} />
                <StatCard label="Last exit code" value={bot.lastExitCode === null ? '—' : String(bot.lastExitCode)} note={bot.lastExitCode === null ? 'No previous exit recorded' : bot.lastExitCode === 0 ? 'Process exited cleanly' : 'Process exited with an error'} icon={<Terminal size={16} />} />
              </section>

              <section className="enter enter-later mt-5 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
                <article className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-start justify-between border-b border-border px-5 py-5 sm:px-6">
                    <div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Managed process</p><h2 className="mt-1.5 text-base font-extrabold tracking-tight">Runtime state</h2></div>
                    <StatusPill state={bot.state} />
                  </div>
                  <div className="grid gap-px bg-border sm:grid-cols-2">
                    <div className="bg-card px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Started at</p><p className="mt-2 text-sm font-semibold">{timeAgo(bot.startedAt)}</p></div>
                    <div className="bg-card px-5 py-4 sm:px-6"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Process ID</p><p className="mt-2 font-mono text-sm">{bot.processId ?? '—'}</p></div>
                  </div>
                  {bot.state === 'error' && bot.lastError && <div className="border-t border-rose-100 bg-rose-50/70 px-5 py-4 sm:px-6"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-rose-800"><CircleAlert size={13} />Latest process error</p><p data-testid="text-last-error" className="mt-2 break-words text-sm leading-6 text-rose-900">{bot.lastError}</p></div>}
                  <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground sm:px-6"><RefreshCw size={12} className={status.isFetching ? 'animate-spin' : ''} />Auto-refresh every 3.5 seconds</div>
                </article>
                <article className="rounded-xl border border-border bg-card p-5 sm:p-6">
                  <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-muted-foreground">Discord gateway</p><h2 className="mt-1.5 text-base font-extrabold tracking-tight">Connection health</h2></div><div className={`grid h-9 w-9 place-items-center rounded-lg ${bot.gatewayConnected ? 'bg-[#e6f3ed] text-[#286c52]' : 'bg-secondary text-muted-foreground'}`}>{bot.gatewayConnected ? <Signal size={17} /> : <SignalZero size={17} />}</div></div>
                  <div className="mt-7 flex items-center gap-3">
                    <div className={`grid h-11 w-11 place-items-center rounded-full ${bot.gatewayConnected ? 'bg-[#e6f3ed] text-[#286c52]' : 'bg-secondary text-muted-foreground'}`}>{bot.gatewayConnected ? <Check size={20} /> : <ArrowDownToLine size={19} />}</div>
                    <div><p data-testid="status-gateway" className="text-sm font-bold">{bot.gatewayConnected ? 'Connection established' : 'Not connected'}</p><p className="mt-1 text-xs text-muted-foreground">{bot.gatewayConnected ? 'Bot can receive Discord events.' : 'Gateway unavailable until the bot is running.'}</p></div>
                  </div>
                  <div className="mt-6 border-t border-border pt-4">
                    <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Process state</span><StatusPill state={bot.state} small /></div>
                    <div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">Latest exit</span><span className="font-mono font-medium">{bot.lastExitCode === null ? 'None' : `Code ${bot.lastExitCode}`}</span></div>
                  </div>
                </article>
              </section>
            </>}

            <footer className="mt-9 flex flex-col gap-2 border-t border-[#d9e1db] pt-4 text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono uppercase tracking-[.11em]">Mendive control plane <span className="mx-1.5 text-[#a5b2aa]">/</span> private instance</span>
              <span className="flex items-center gap-1.5"><Gauge size={12} />{status.dataUpdatedAt ? `Last checked ${new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(status.dataUpdatedAt)}` : 'Waiting for status'}</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/login" component={LoginPage} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
