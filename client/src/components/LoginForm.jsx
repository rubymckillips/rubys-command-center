import { useState } from 'react';

export default function LoginForm({ onSubmit, pending = false, error = null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      await onSubmit({ username, password });
    } finally {
      setPassword('');
    }
  }

  return (
    <main className="signin-shell">
      <section className="signin-card" aria-labelledby="signin-title">
        <p className="eyebrow">Unified Command Center</p>
        <h1 id="signin-title">Sign in to your workspace</h1>
        <p className="signin-description">Enter the workspace username and password to continue.</p>
        <form className="signin-form" onSubmit={handleSubmit}>
          <label htmlFor="signin-username">Username</label>
          <input id="signin-username" name="username" autoComplete="username" value={username}
            onChange={(event) => setUsername(event.target.value)} required disabled={pending} />
          <label htmlFor="signin-password">Password</label>
          <input id="signin-password" name="password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required disabled={pending} />
          {error && <p className="signin-error" role="alert">{error}</p>}
          <button className="signin-button" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
