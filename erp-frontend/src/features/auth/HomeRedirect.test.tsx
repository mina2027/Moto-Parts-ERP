import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Permission, Session } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { HomeRedirect } from './HomeRedirect';

afterEach(() => { cleanup(); useAuthStore.setState({ session: null }); });
describe('home route permissions', () => {
  it.each([
    [['reports.view', 'sales.create'], '/dashboard'],
    [['sales.create', 'inventory.view'], '/pos'],
    [['inventory.view'], '/inventory'],
    [[], '/alerts'],
  ] as [Permission[], string][])('chooses an accessible destination for %s', async (permissions, destination) => {
    useAuthStore.setState({ session: { permissions } as Session });
    render(<MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<HomeRedirect />} /><Route path={destination} element={<span>Destination: {destination}</span>} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(`Destination: ${destination}`)).toBeInTheDocument());
  });
});
