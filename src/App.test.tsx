import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

describe('App (ShadowAnalysis)', () => {
  it('renders the main heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Verschattungsanalyse/i })).toBeInTheDocument();
  });

  it('shows the Einstellungen config panel', () => {
    render(<App />);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('shows the Jahresübersicht table heading', () => {
    render(<App />);
    expect(screen.getByText(/Jahresübersicht/i)).toBeInTheDocument();
  });

  it('shows season selection buttons', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Wintersonnenwende' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tagundnachtgleiche' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sommersonnenwende' })).toBeInTheDocument();
  });

  it('resets config when Reset button is clicked', () => {
    render(<App />);
    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);
    // After reset, default latitude 47.1° should be visible
    expect(screen.getByText('47.1°')).toBeInTheDocument();
  });

  it('shows the Kritischer Profilwinkel label', () => {
    render(<App />);
    expect(screen.getByText(/Kritischer Profilwinkel/i)).toBeInTheDocument();
  });

  it('shows the Jahres-Verschattung info card', () => {
    render(<App />);
    expect(screen.getByText(/Jahres-Verschattung/i)).toBeInTheDocument();
  });
});
