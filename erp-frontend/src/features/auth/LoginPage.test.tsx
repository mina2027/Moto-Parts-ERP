import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session } from '@/types';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import LoginPage from './LoginPage';

vi.mock('@/services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));

const session: Session = {
  user: {
    id: 'user-1', username: 'user', fullName: { ar: 'User' }, email: '', phone: '',
    role: 'cashier', branchId: 'branch-1', status: 'active', avatarColor: '',
    lastLogin: null, createdAt: '2026-01-01T00:00:00Z',
  },
  permissions: [], token: 'token', expiresAt: '2027-01-01T00:00:00Z',
};

beforeEach(() => {
  useAuthStore.setState({ session: null, status: 'idle' });
  useUiStore.setState({ locale: 'en' });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  useAuthStore.setState({ session: null, status: 'idle' });
  localStorage.clear();
});

function mount() {
  render(<MemoryRouter initialEntries={['/login']}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<span>Signed in</span>} />
  </Routes></MemoryRouter>);
}

describe('login form loading indicator', () => {
  it('shows an enabled login button before submitting even if the store has stale loading status', () => {
    useAuthStore.setState({ status: 'loading' });
    mount();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByLabelText(/Username/)).toHaveValue('');
    expect(screen.getByLabelText(/Password/)).toHaveValue('');
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('does not attempt login or stay loading when the fields are empty', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getAllByText('This field is required')).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('shows loading only while submitting, recovers from failure, and permits a successful retry', async () => {
    let rejectLogin!: (reason: Error) => void;
    vi.mocked(authService.login).mockReturnValueOnce(new Promise((_resolve, reject) => { rejectLogin = reject; }));
    mount();
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'user' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authService.login).toHaveBeenCalledWith('user', 'password'));
    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
    rejectLogin(new Error('Invalid credentials'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    vi.mocked(authService.login).mockResolvedValueOnce(session);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(authService.login).toHaveBeenCalledTimes(2);
  });
});
