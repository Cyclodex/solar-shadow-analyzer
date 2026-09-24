import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { Header } from './Header';

describe('Header', () => {
  beforeEach(() => {
    resetStores();
  });

  it('summarises the site with the coordinate label in the UI language', () => {
    render(<Header />);
    expect(screen.getByText('47.100° N, 7.450° O')).toBeInTheDocument();
    act(() => useUiStore.getState().setLang('en'));
    expect(screen.getByText('47.100° N, 7.450° E')).toBeInTheDocument();
    act(() => useConfigStore.getState().patch('location', { name: 'Mein Balkon' }));
    expect(screen.getByText('Mein Balkon')).toBeInTheDocument();
  });
});
