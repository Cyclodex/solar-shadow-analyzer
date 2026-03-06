import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigPanel } from './ConfigPanel';
import { DEFAULT_CONFIG } from '../constants';
import type { Config } from '../types';

const noop = () => {};

describe('ConfigPanel', () => {
  it('renders the Einstellungen title', () => {
    render(<ConfigPanel config={DEFAULT_CONFIG} onChange={noop} onReset={noop} />);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('renders the Reset button', () => {
    render(<ConfigPanel config={DEFAULT_CONFIG} onChange={noop} onReset={noop} />);
    expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
  });

  it('displays the current latitude value', () => {
    render(<ConfigPanel config={DEFAULT_CONFIG} onChange={noop} onReset={noop} />);
    expect(screen.getByText(`${DEFAULT_CONFIG.latitude}°`)).toBeInTheDocument();
  });

  it('displays the correct value when config changes', () => {
    const customConfig: Config = { ...DEFAULT_CONFIG, latitude: 52.5 };
    render(<ConfigPanel config={customConfig} onChange={noop} onReset={noop} />);
    expect(screen.getByText('52.5°')).toBeInTheDocument();
  });

  it('renders all section labels', () => {
    render(<ConfigPanel config={DEFAULT_CONFIG} onChange={noop} onReset={noop} />);
    expect(screen.getByText('Standort')).toBeInTheDocument();
    expect(screen.getByText('Balkon')).toBeInTheDocument();
    expect(screen.getByText('Panels')).toBeInTheDocument();
  });
});
