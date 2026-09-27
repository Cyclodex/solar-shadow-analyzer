import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConfigStore } from '../state/configStore';
import { useUiStore } from '../state/uiStore';
import { resetStores } from '../test/utils';
import { LocationSection } from '../controls/LocationSection';
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

  it('the location opens «Standort» and focuses the address search', async () => {
    render(
      <>
        <Header />
        <LocationSection />
      </>,
    );
    expect(screen.queryByRole('combobox', { name: /Adresse oder Ort/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '47.100° N, 7.450° O: Adresse oder Ort suchen' }));
    expect(useUiStore.getState().openSections.location).toBe(true);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-address-search'));
  });
});
