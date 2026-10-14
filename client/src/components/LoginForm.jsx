import { githubLoginUrl } from '../api.js';

export default function LoginForm({ pending = false, error = null }) {

  return (
    <main className="signin-shell">
      <section className="signin-card" aria-labelledby="signin-title">
        <p className="eyebrow">Unified Command Center</p>
        <h1 id="signin-title">Sign in to your workspace</h1>
        <p className="signin-description">Sign in with GitHub. Your entries stay in your private workspace.</p>
        <div className="signin-form">
          {error && <p className="signin-error" role="alert">{error}</p>}
          {pending?<p>Checking your session…</p>:<a className="signin-button" href={githubLoginUrl()}>Continue with GitHub</a>}
        </div>
      </section>
    </main>
  );
}
