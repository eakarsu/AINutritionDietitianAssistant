import { useEffect, useRef, useState } from 'react';
import NativeWorkflowStudio from './NativeWorkflowStudio';
import nativeWorkflowConfig from './nativeWorkflowConfig.json';
import WorkflowSidebar from './WorkflowSidebar';
import './App.css';

const FEATURES = [
  "Review client nutrition profile",
  "Plan meals and nutrient targets",
  "Record dietitian follow-up"
];
const PRODUCT_NAME = 'AI Nutrition & Dietitian Assistant';
const configuredApiBase = process.env.REACT_APP_API_URL || '';
const API_BASE = typeof window === 'undefined' ? configuredApiBase : configuredApiBase.replace(/127\.0\.0\.1|localhost/, window.location.hostname);

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed with HTTP ${response.status}`);
  return body;
}

function authenticatedNativeRequest(path, options = {}) { return api(path, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` } }); }

export default function App() {
  const demoLoginLock = useRef(false);
  const [demoLoginBusy, setDemoLoginBusy] = useState(false);

  const [service, setService] = useState({ status: 'loading', detail: 'Checking the API boundary…' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const checkService = async () => {
    setService({ status: 'loading', detail: 'Checking the API boundary…' });
    try {
      const response = await fetch(`${API_BASE}/api/health`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
      setService({ status: 'ready', detail: 'Backend API is reachable.' });
    } catch (error) {
      setService({ status: 'error', detail: error.message || 'Backend API is unavailable.' });
    }
  };

  useEffect(() => { checkService(); }, []);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token) return;
    api('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((body) => setUser(body.user || body)).catch(() => localStorage.removeItem('authToken'));
  }, []);

  const login = async (credentials) => {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
    localStorage.setItem('authToken', result.token);
    const identity = await api('/api/auth/me', { headers: { Authorization: `Bearer ${result.token}` } });
    setUser(identity.user || identity);
  };

  const handleLogin = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await login({ email, password }); }
    catch (requestError) { localStorage.removeItem('authToken'); setError(requestError.message); }
    finally { setBusy(false); }
  };

  const handleDemoLogin = async () => {
    if (demoLoginLock.current) return;
    demoLoginLock.current = true; setDemoLoginBusy(true); setError('');
    try {
      const credentials = await api('/api/auth/demo-credentials');
      setEmail(credentials.email); setPassword(credentials.password);
      await login(credentials);
    } catch (requestError) {
      localStorage.removeItem('authToken'); setError(requestError.message);
    } finally {
      demoLoginLock.current = false; setDemoLoginBusy(false);
    }
  };

  if (!user) return <main className="login-shell"><form className="login-card" onSubmit={handleLogin}>
    <p className="eyebrow">{PRODUCT_NAME}</p><h1>Sign in to your workspace</h1><p className="lede">Use the provisioned local account to continue.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label>
    <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
    <button className="demo-button" type="button" onClick={handleDemoLogin} disabled={demoLoginBusy || busy}>{demoLoginBusy ? 'Logging in…' : 'Log in as Demo'}</button>
    <button className="primary-button" type="submit" disabled={busy || demoLoginBusy}>{busy || demoLoginBusy ? 'Please wait…' : 'Sign In'}</button>
  </form></main>;

  return (
    <div className="codex-nav-shell"><WorkflowSidebar title="NutritionDietitianAssistant" features={FEATURES} /><main className="shell">
      <section className="hero" id="overview">
        <p className="eyebrow">Restored application boundary</p>
        <h1>AI Nutrition & Dietitian Assistant</h1>
        <p className="lede">This checked-in UI exposes the primary workflow boundary without presenting generated screens as completed execution.</p>
        <div className={`service service--${service.status}`} role={service.status === 'error' ? 'alert' : 'status'}>
          <span>{service.status === 'loading' ? 'Loading' : service.status === 'ready' ? 'Connected' : 'Unavailable'}</span>
          <p>{service.detail}</p>
          {service.status === 'error' && <button type="button" onClick={checkService}>Retry connection</button>}
        </div>
      </section>
      <section aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">Primary workflow</h2>
        <div className="workflow">
          {FEATURES.map((feature, index) => (
            <article key={feature} id={`step-${index + 1}`}>
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <h3>{feature}</h3>
              <p>Backend integration and validation remain required before this step can execute in production.</p>
            </article>
          ))}
        </div>
      </section>
    <NativeWorkflowStudio config={nativeWorkflowConfig} request={authenticatedNativeRequest} /></main></div>
  );
}
