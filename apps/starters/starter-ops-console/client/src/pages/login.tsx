import { useNavigate } from 'react-router-dom';
import { LoginForm, type LoginCredentials } from '@teamsuzie/ui';

interface DemoCredentials {
  email: string;
  password: string;
}

interface Props {
  onAuthenticated: () => Promise<void>;
  title: string;
  demo?: DemoCredentials;
}

export function LoginPage({ onAuthenticated, title, demo }: Props) {
  const navigate = useNavigate();

  async function handleSubmit(credentials: LoginCredentials) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message || 'Login failed');
    }
    await onAuthenticated();
    navigate('/', { replace: true });
  }

  return <LoginForm title={title} onSubmit={handleSubmit} demo={demo} />;
}
